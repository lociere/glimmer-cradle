/**
 * Platform native C ABI。
 *
 * native/ 是 Kernel、Engine 与平台适配器共用的性能底座；它不拥有高层编排。
 */

#ifndef PLATFORM_NATIVE_H
#define PLATFORM_NATIVE_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>

#if defined(_WIN32)
#  if defined(PLATFORM_NATIVE_BUILD)
#    define PLATFORM_NATIVE_API __declspec(dllexport)
#  else
#    define PLATFORM_NATIVE_API __declspec(dllimport)
#  endif
#else
#  define PLATFORM_NATIVE_API
#endif

typedef enum PlatformNativeResult {
    PLATFORM_NATIVE_SUCCESS = 0,
    PLATFORM_NATIVE_ERROR_UNKNOWN = -1,
    PLATFORM_NATIVE_ERROR_INVALID_PARAM = -2,
    PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE = -3,
    PLATFORM_NATIVE_ERROR_COMPOSITION_SURFACE = -4,
} PlatformNativeResult;

/*
 * Composition Host 是 Avatar 身体呈现的跨平台边界。Unity 只提供已渲染的 GPU 纹理；
 * 平台实现负责透明合成、窗口位置和命中策略。所有坐标均为物理像素。
 */
typedef struct PlatformNativeCompositionHost PlatformNativeCompositionHost;

typedef struct PlatformNativeCompositionHostConfig {
    int width;
    int height;
    int always_on_top;
} PlatformNativeCompositionHostConfig;

typedef struct PlatformNativeCompositionRect {
    int x;
    int y;
    int width;
    int height;
} PlatformNativeCompositionRect;

PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_create(
    const PlatformNativeCompositionHostConfig* config,
    PlatformNativeCompositionHost** out_host
);

PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_attach_surface(
    PlatformNativeCompositionHost* host,
    void* native_texture
);

PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_present(PlatformNativeCompositionHost* host);

/*
 * Unity 必须通过 GL.IssuePluginEventAndData 在渲染线程提交帧。返回值是 Unity
 * 原生插件回调地址，event data 直接传 PlatformNativeCompositionHost 指针。
 */
PLATFORM_NATIVE_API void* platform_native_composition_host_get_render_event_func(void);

/* 只有至少一帧成功进入平台合成器后，Avatar 呈现才属于 ready。 */
PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_has_presented(
    PlatformNativeCompositionHost* host,
    int* out_presented
);

PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_set_bounds(
    PlatformNativeCompositionHost* host,
    const PlatformNativeCompositionRect* bounds
);

PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_get_bounds(
    PlatformNativeCompositionHost* host,
    PlatformNativeCompositionRect* out_bounds
);

/* 按目标显示器工作区停靠；visible_height 可小于窗口高度，以形成自然的半身驻留。 */
PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_dock(
    PlatformNativeCompositionHost* host,
    int visible_height,
    int right_inset,
    int bottom_inset
);

/* 命中区域相对 Host 窗口，透明区域会继续传递给桌面。 */
PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_set_input_hull(
    PlatformNativeCompositionHost* host,
    const PlatformNativeCompositionRect* hull
);

PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_take_placement_dirty(
    PlatformNativeCompositionHost* host,
    int* out_dirty
);

/* 返回以 Host 中心和尺寸归一化的全局指针坐标；窗口外坐标可超出 [-1, 1]，由行为层限幅。 */
PLATFORM_NATIVE_API PlatformNativeResult platform_native_composition_host_get_pointer_normalized(
    PlatformNativeCompositionHost* host,
    float* out_x,
    float* out_y
);

/* 读取最近一次平台适配器失败原因，供宿主记录和诊断展示。 */
PLATFORM_NATIVE_API void platform_native_composition_host_get_last_error(
    PlatformNativeCompositionHost* host,
    char* out_message,
    size_t out_message_max_length
);

PLATFORM_NATIVE_API void platform_native_composition_host_destroy(PlatformNativeCompositionHost* host);

#ifdef __cplusplus
}
#endif

#endif
