#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <d3d11.h>
#include <dcomp.h>
#include <dxgi1_2.h>

#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

#include "platform_native.h"

struct PlatformNativeCompositionHost {
    HWND window = nullptr;
    RECT input_hull{0, 0, 0, 0};
    bool has_input_hull = false;
    bool always_on_top = true;
    bool placement_dirty = false;
    bool dragging = false;
    POINT drag_origin{};
    POINT window_origin{};

    ID3D11Device* device = nullptr;
    ID3D11DeviceContext* context = nullptr;
    ID3D11Texture2D* source_texture = nullptr;
    IDXGISwapChain1* swap_chain = nullptr;
    IDCompositionDevice* composition_device = nullptr;
    IDCompositionTarget* composition_target = nullptr;
    IDCompositionVisual* composition_visual = nullptr;
    int source_width = 0;
    int source_height = 0;
    std::atomic<unsigned long long> presented_frames{0};
    std::string last_error;
};

namespace {

constexpr wchar_t kWindowClassName[] = L"PlatformNativeCompositionHost";
constexpr int kMinimumVisibleGrip = 96;
ATOM window_class = 0;

bool contains_input_hull(const PlatformNativeCompositionHost* host, POINT point) {
    if (host == nullptr || !host->has_input_hull) return false;
    return PtInRect(&host->input_hull, point) != 0;
}

void release_graphics(PlatformNativeCompositionHost* host) {
    if (host == nullptr) return;
    if (host->composition_visual) { host->composition_visual->Release(); host->composition_visual = nullptr; }
    if (host->composition_target) { host->composition_target->Release(); host->composition_target = nullptr; }
    if (host->composition_device) { host->composition_device->Release(); host->composition_device = nullptr; }
    if (host->swap_chain) { host->swap_chain->Release(); host->swap_chain = nullptr; }
    if (host->source_texture) { host->source_texture->Release(); host->source_texture = nullptr; }
    host->source_width = 0;
    host->source_height = 0;
    if (host->context) { host->context->Release(); host->context = nullptr; }
    if (host->device) { host->device->Release(); host->device = nullptr; }
}

HRESULT update_visual_scale(PlatformNativeCompositionHost* host, int width, int height) {
    if (host == nullptr || host->composition_visual == nullptr || host->source_width <= 0 || host->source_height <= 0) {
        return E_INVALIDARG;
    }
    const float scale_x = static_cast<float>(std::max(1, width)) / static_cast<float>(host->source_width);
    const float scale_y = static_cast<float>(std::max(1, height)) / static_cast<float>(host->source_height);
    // DirectComposition 的基础 Visual 不提供独立缩放属性；通过二维矩阵把高分辨率源纹理
    // 映射到实际宿主窗口，避免把 Unity 渲染分辨率与桌面占位尺寸混在一起。
    const D2D_MATRIX_3X2_F transform{ scale_x, 0.0f, 0.0f, scale_y, 0.0f, 0.0f };
    return host->composition_visual->SetTransform(transform);
}

void set_error(PlatformNativeCompositionHost* host, const char* stage, HRESULT result) {
    if (host == nullptr) return;
    char message[160]{};
    std::snprintf(message, sizeof(message), "%s (HRESULT=0x%08X)", stage, static_cast<unsigned int>(result));
    host->last_error = message;
}

LRESULT CALLBACK composition_window_proc(HWND hwnd, UINT message, WPARAM w_param, LPARAM l_param) {
    auto* host = reinterpret_cast<PlatformNativeCompositionHost*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    switch (message) {
        case WM_NCHITTEST: {
            if (host == nullptr) return HTTRANSPARENT;
            POINT point{ GET_X_LPARAM(l_param), GET_Y_LPARAM(l_param) };
            ScreenToClient(hwnd, &point);
            return contains_input_hull(host, point) ? HTCAPTION : HTTRANSPARENT;
        }
        case WM_ENTERSIZEMOVE:
            if (host) host->dragging = true;
            break;
        case WM_EXITSIZEMOVE:
            if (host) { host->dragging = false; host->placement_dirty = true; }
            break;
        case WM_MOVE:
            if (host && host->dragging) host->placement_dirty = true;
            break;
        case WM_SIZE:
            if (host && host->composition_visual && host->composition_device && w_param != SIZE_MINIMIZED) {
                const int width = std::max(1, static_cast<int>(LOWORD(l_param)));
                const int height = std::max(1, static_cast<int>(HIWORD(l_param)));
                if (SUCCEEDED(update_visual_scale(host, width, height))) {
                    host->composition_device->Commit();
                }
            }
            return 0;
        case WM_ERASEBKGND:
            // Composition visual 是窗口的唯一画面源；禁止系统在 resize 间隙擦出普通 HWND 背景。
            return 1;
        case WM_PAINT:
            ValidateRect(hwnd, nullptr);
            return 0;
        case WM_CLOSE:
            /* 身体窗口不独立终止应用，统一交给 Kernel 的退出编排。 */
            return 0;
        default:
            break;
    }
    return DefWindowProcW(hwnd, message, w_param, l_param);
}

bool ensure_window_class() {
    if (window_class != 0) return true;
    WNDCLASSEXW descriptor{};
    descriptor.cbSize = sizeof(descriptor);
    descriptor.hInstance = GetModuleHandleW(nullptr);
    descriptor.lpfnWndProc = composition_window_proc;
    descriptor.lpszClassName = kWindowClassName;
    descriptor.hCursor = LoadCursor(nullptr, IDC_ARROW);
    window_class = RegisterClassExW(&descriptor);
    return window_class != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
}

void clamp_to_work_area(PlatformNativeCompositionHost* host, int& x, int& y) {
    RECT work_area{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work_area, 0);
    RECT bounds{};
    GetWindowRect(host->window, &bounds);
    const int width = std::max(1, static_cast<int>(bounds.right - bounds.left));
    const int height = std::max(1, static_cast<int>(bounds.bottom - bounds.top));
    const int work_left = static_cast<int>(work_area.left);
    const int work_right = static_cast<int>(work_area.right);
    const int work_top = static_cast<int>(work_area.top);
    const int work_bottom = static_cast<int>(work_area.bottom);
    x = std::max(work_left - width + kMinimumVisibleGrip, std::min(work_right - kMinimumVisibleGrip, x));
    y = std::max(work_top - height + kMinimumVisibleGrip, std::min(work_bottom - kMinimumVisibleGrip, y));
}

} // namespace

namespace {

void __stdcall composition_render_event(int event_id, void* data) {
    if (event_id != 1 || data == nullptr) return;
    platform_native_composition_host_present(static_cast<PlatformNativeCompositionHost*>(data));
}

} // namespace

PlatformNativeResult platform_native_composition_host_create(
    const PlatformNativeCompositionHostConfig* config,
    PlatformNativeCompositionHost** out_host
) {
    if (config == nullptr || out_host == nullptr || config->width <= 0 || config->height <= 0) {
        return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    }
    if (!ensure_window_class()) return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;

    auto host = std::make_unique<PlatformNativeCompositionHost>();
    // DirectComposition 视觉树是唯一呈现源。NOREDIRECTIONBITMAP 阻止 DWM 在尺寸变化时
    // 为普通 HWND 临时分配黑色重定向表面。
    const DWORD ex_style = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_NOREDIRECTIONBITMAP;
    const DWORD style = WS_POPUP;
    host->window = CreateWindowExW(
        ex_style,
        kWindowClassName,
        L"Glimmer Cradle Avatar",
        style,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        config->width,
        config->height,
        nullptr,
        nullptr,
        GetModuleHandleW(nullptr),
        nullptr
    );
    if (host->window == nullptr) return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
    SetWindowLongPtrW(host->window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(host.get()));
    SetWindowPos(
        host->window,
        config->always_on_top ? HWND_TOPMOST : HWND_NOTOPMOST,
        0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED
    );
    host->always_on_top = config->always_on_top != 0;
    *out_host = host.release();
    return PLATFORM_NATIVE_SUCCESS;
}

PlatformNativeResult platform_native_composition_host_attach_surface(
    PlatformNativeCompositionHost* host,
    void* native_texture
) {
    if (host == nullptr || native_texture == nullptr) return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    release_graphics(host);
    host->presented_frames.store(0, std::memory_order_release);

    auto* source = reinterpret_cast<ID3D11Texture2D*>(native_texture);
    source->AddRef();
    host->source_texture = source;
    source->GetDevice(&host->device);
    if (host->device == nullptr) {
        release_graphics(host);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }
    host->device->GetImmediateContext(&host->context);

    D3D11_TEXTURE2D_DESC source_description{};
    source->GetDesc(&source_description);
    host->source_width = static_cast<int>(source_description.Width);
    host->source_height = static_cast<int>(source_description.Height);
    IDXGIDevice* dxgi_device = nullptr;
    IDXGIAdapter* adapter = nullptr;
    IDXGIFactory2* factory = nullptr;
    const HRESULT factory_result = host->device->QueryInterface(IID_PPV_ARGS(&dxgi_device));
    if (FAILED(factory_result) || FAILED(dxgi_device->GetAdapter(&adapter)) || FAILED(adapter->GetParent(IID_PPV_ARGS(&factory)))) {
        set_error(host, "无法从 Unity D3D11 device 获取 DXGI factory", FAILED(factory_result) ? factory_result : E_FAIL);
        if (factory) factory->Release();
        if (adapter) adapter->Release();
        if (dxgi_device) dxgi_device->Release();
        release_graphics(host);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }

    DXGI_FORMAT composition_format = source_description.Format;
    if (composition_format == DXGI_FORMAT_R8G8B8A8_TYPELESS) {
        composition_format = DXGI_FORMAT_R8G8B8A8_UNORM;
    } else if (composition_format == DXGI_FORMAT_B8G8R8A8_TYPELESS) {
        composition_format = DXGI_FORMAT_B8G8R8A8_UNORM;
    }

    DXGI_SWAP_CHAIN_DESC1 swap_chain_description{};
    swap_chain_description.Width = source_description.Width;
    swap_chain_description.Height = source_description.Height;
    swap_chain_description.Format = composition_format;
    swap_chain_description.Stereo = FALSE;
    swap_chain_description.SampleDesc.Count = 1;
    swap_chain_description.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    swap_chain_description.BufferCount = 2;
    swap_chain_description.Scaling = DXGI_SCALING_STRETCH;
    swap_chain_description.SwapEffect = DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL;
    swap_chain_description.AlphaMode = DXGI_ALPHA_MODE_PREMULTIPLIED;

    const HRESULT swap_chain_result = factory->CreateSwapChainForComposition(
        host->device,
        &swap_chain_description,
        nullptr,
        &host->swap_chain
    );
    factory->Release();
    adapter->Release();
    if (FAILED(swap_chain_result)) {
        char stage[180]{};
        std::snprintf(
            stage,
            sizeof(stage),
            "CreateSwapChainForComposition 失败 format=%u size=%ux%u sample=%u bind=0x%X",
            static_cast<unsigned int>(source_description.Format),
            source_description.Width,
            source_description.Height,
            source_description.SampleDesc.Count,
            source_description.BindFlags
        );
        set_error(host, stage, swap_chain_result);
        dxgi_device->Release();
        release_graphics(host);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }

    const HRESULT composition_device_result = DCompositionCreateDevice(dxgi_device, IID_PPV_ARGS(&host->composition_device));
    if (FAILED(composition_device_result)) {
        set_error(host, "DCompositionCreateDevice 失败", composition_device_result);
        dxgi_device->Release();
        release_graphics(host);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }
    const HRESULT composition_target_result = host->composition_device->CreateTargetForHwnd(host->window, TRUE, &host->composition_target);
    if (FAILED(composition_target_result)) {
        set_error(host, "CreateTargetForHwnd 失败", composition_target_result);
        dxgi_device->Release();
        release_graphics(host);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }
    const HRESULT visual_result = host->composition_device->CreateVisual(&host->composition_visual);
    if (FAILED(visual_result)) {
        set_error(host, "CreateVisual 失败", visual_result);
        dxgi_device->Release();
        release_graphics(host);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }
    const HRESULT content_result = host->composition_visual->SetContent(host->swap_chain);
    const HRESULT interpolation_result = host->composition_visual->SetBitmapInterpolationMode(
        DCOMPOSITION_BITMAP_INTERPOLATION_MODE_LINEAR
    );
    RECT client_bounds{};
    GetClientRect(host->window, &client_bounds);
    const HRESULT scale_result = update_visual_scale(
        host,
        client_bounds.right - client_bounds.left,
        client_bounds.bottom - client_bounds.top
    );
    const HRESULT root_result = host->composition_target->SetRoot(host->composition_visual);
    const HRESULT commit_result = host->composition_device->Commit();
    if (FAILED(content_result) || FAILED(interpolation_result) || FAILED(scale_result) || FAILED(root_result) || FAILED(commit_result)) {
        const HRESULT failure = FAILED(content_result) ? content_result : FAILED(interpolation_result) ? interpolation_result : FAILED(scale_result) ? scale_result : FAILED(root_result) ? root_result : commit_result;
        const char* stage = FAILED(content_result) ? "CompositionVisual.SetContent 失败" : FAILED(interpolation_result) ? "CompositionVisual.SetBitmapInterpolationMode 失败" : FAILED(scale_result) ? "CompositionVisual.SetTransform 失败" : FAILED(root_result) ? "CompositionTarget.SetRoot 失败" : "CompositionDevice.Commit 失败";
        set_error(host, stage, failure);
        dxgi_device->Release();
        release_graphics(host);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }

    dxgi_device->Release();

    ShowWindow(host->window, SW_SHOWNOACTIVATE);
    UpdateWindow(host->window);
    return PLATFORM_NATIVE_SUCCESS;
}

PlatformNativeResult platform_native_composition_host_present(PlatformNativeCompositionHost* host) {
    if (host == nullptr || host->source_texture == nullptr || host->context == nullptr || host->swap_chain == nullptr) {
        return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    }
    ID3D11Texture2D* target = nullptr;
    const HRESULT buffer_result = host->swap_chain->GetBuffer(0, IID_PPV_ARGS(&target));
    if (FAILED(buffer_result) || target == nullptr) {
        set_error(host, "SwapChain.GetBuffer 失败", buffer_result);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }
    host->context->CopyResource(target, host->source_texture);
    target->Release();
    const HRESULT present_result = host->swap_chain->Present(1, 0);
    const HRESULT commit_result = host->composition_device->Commit();
    if (FAILED(present_result) || FAILED(commit_result)) {
        set_error(host, FAILED(present_result) ? "SwapChain.Present 失败" : "CompositionDevice.Commit 失败", FAILED(present_result) ? present_result : commit_result);
        return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
    }
    host->presented_frames.fetch_add(1, std::memory_order_release);
    return PLATFORM_NATIVE_SUCCESS;
}

void* platform_native_composition_host_get_render_event_func(void) {
    return reinterpret_cast<void*>(&composition_render_event);
}

PlatformNativeResult platform_native_composition_host_has_presented(
    PlatformNativeCompositionHost* host,
    int* out_presented
) {
    if (host == nullptr || out_presented == nullptr) return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    *out_presented = host->presented_frames.load(std::memory_order_acquire) > 0 ? 1 : 0;
    return PLATFORM_NATIVE_SUCCESS;
}

void platform_native_composition_host_get_last_error(
    PlatformNativeCompositionHost* host,
    char* out_message,
    size_t out_message_max_length
) {
    if (out_message == nullptr || out_message_max_length == 0) return;
    out_message[0] = '\0';
    if (host == nullptr || host->last_error.empty()) return;
    std::strncpy(out_message, host->last_error.c_str(), out_message_max_length - 1);
    out_message[out_message_max_length - 1] = '\0';
}

PlatformNativeResult platform_native_composition_host_set_bounds(PlatformNativeCompositionHost* host, const PlatformNativeCompositionRect* bounds) {
    if (host == nullptr || bounds == nullptr || bounds->width <= 0 || bounds->height <= 0) return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    int x = bounds->x;
    int y = bounds->y;
    clamp_to_work_area(host, x, y);
    SetWindowPos(
        host->window,
        host->always_on_top ? HWND_TOPMOST : HWND_NOTOPMOST,
        x,
        y,
        bounds->width,
        bounds->height,
        SWP_NOACTIVATE
    );
    if (host->composition_visual != nullptr) {
        const HRESULT scale_result = update_visual_scale(host, bounds->width, bounds->height);
        const HRESULT commit_result = host->composition_device->Commit();
        if (FAILED(scale_result) || FAILED(commit_result)) {
            set_error(host, FAILED(scale_result) ? "CompositionVisual.SetTransform 失败" : "CompositionDevice.Commit 失败", FAILED(scale_result) ? scale_result : commit_result);
            return PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE;
        }
    }
    return PLATFORM_NATIVE_SUCCESS;
}

PlatformNativeResult platform_native_composition_host_get_bounds(PlatformNativeCompositionHost* host, PlatformNativeCompositionRect* out_bounds) {
    if (host == nullptr || out_bounds == nullptr) return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    RECT bounds{};
    if (!GetWindowRect(host->window, &bounds)) return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
    out_bounds->x = bounds.left;
    out_bounds->y = bounds.top;
    out_bounds->width = bounds.right - bounds.left;
    out_bounds->height = bounds.bottom - bounds.top;
    return PLATFORM_NATIVE_SUCCESS;
}

PlatformNativeResult platform_native_composition_host_dock(
    PlatformNativeCompositionHost* host,
    int visible_height,
    int right_inset,
    int bottom_inset
) {
    if (host == nullptr || host->window == nullptr || visible_height <= 0) {
        return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    }
    RECT bounds{};
    if (!GetWindowRect(host->window, &bounds)) return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
    const int width = std::max(1, static_cast<int>(bounds.right - bounds.left));
    const int height = std::max(1, static_cast<int>(bounds.bottom - bounds.top));
    const HMONITOR monitor = MonitorFromWindow(host->window, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO monitor_info{};
    monitor_info.cbSize = sizeof(monitor_info);
    if (!GetMonitorInfoW(monitor, &monitor_info)) return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
    const int clamped_visible_height = std::max(kMinimumVisibleGrip, std::min(height, visible_height));
    const int x = monitor_info.rcWork.right - width - std::max(0, right_inset);
    const int y = monitor_info.rcWork.bottom - clamped_visible_height - std::max(0, bottom_inset);
    SetWindowPos(
        host->window,
        host->always_on_top ? HWND_TOPMOST : HWND_NOTOPMOST,
        x,
        y,
        width,
        height,
        SWP_NOACTIVATE
    );
    host->placement_dirty = true;
    return PLATFORM_NATIVE_SUCCESS;
}

PlatformNativeResult platform_native_composition_host_set_input_hull(PlatformNativeCompositionHost* host, const PlatformNativeCompositionRect* hull) {
    if (host == nullptr || hull == nullptr) return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    host->input_hull.left = hull->x;
    host->input_hull.top = hull->y;
    host->input_hull.right = hull->x + std::max(0, hull->width);
    host->input_hull.bottom = hull->y + std::max(0, hull->height);
    host->has_input_hull = hull->width > 0 && hull->height > 0;
    return PLATFORM_NATIVE_SUCCESS;
}

PlatformNativeResult platform_native_composition_host_take_placement_dirty(PlatformNativeCompositionHost* host, int* out_dirty) {
    if (host == nullptr || out_dirty == nullptr) return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    *out_dirty = host->placement_dirty ? 1 : 0;
    host->placement_dirty = false;
    return PLATFORM_NATIVE_SUCCESS;
}

PlatformNativeResult platform_native_composition_host_get_pointer_normalized(PlatformNativeCompositionHost* host, float* out_x, float* out_y) {
    if (host == nullptr || out_x == nullptr || out_y == nullptr) return PLATFORM_NATIVE_ERROR_INVALID_PARAM;
    POINT pointer{};
    RECT bounds{};
    if (!GetCursorPos(&pointer) || !GetWindowRect(host->window, &bounds)) return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
    const float width = static_cast<float>(std::max(1, static_cast<int>(bounds.right - bounds.left)));
    const float height = static_cast<float>(std::max(1, static_cast<int>(bounds.bottom - bounds.top)));
    // 以身体表面尺寸归一化，但不在平台层截断；行为导演需要据此判断窗口外的全局指针移动。
    *out_x = ((pointer.x - bounds.left) / width - 0.5f) * 2.0f;
    *out_y = (0.5f - (pointer.y - bounds.top) / height) * 2.0f;
    return PLATFORM_NATIVE_SUCCESS;
}

void platform_native_composition_host_destroy(PlatformNativeCompositionHost* host) {
    if (host == nullptr) return;
    release_graphics(host);
    if (host->window != nullptr) {
        SetWindowLongPtrW(host->window, GWLP_USERDATA, 0);
        DestroyWindow(host->window);
    }
    delete host;
}
