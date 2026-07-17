#include "platform_native.h"

/* 非 Windows 平台的占位适配器：能力声明保留，具体宿主由对应平台实现提供。 */
PlatformNativeResult platform_native_composition_host_create(
    const PlatformNativeCompositionHostConfig*,
    PlatformNativeCompositionHost**
) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_attach_surface(PlatformNativeCompositionHost*, void*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_present(PlatformNativeCompositionHost*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

void* platform_native_composition_host_get_render_event_func(void) {
    return nullptr;
}

PlatformNativeResult platform_native_composition_host_has_presented(PlatformNativeCompositionHost*, int*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_set_bounds(PlatformNativeCompositionHost*, const PlatformNativeCompositionRect*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_get_bounds(PlatformNativeCompositionHost*, PlatformNativeCompositionRect*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_dock(PlatformNativeCompositionHost*, int, int, int) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_set_input_hull(PlatformNativeCompositionHost*, const PlatformNativeCompositionRect*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_take_placement_dirty(PlatformNativeCompositionHost*, int*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

PlatformNativeResult platform_native_composition_host_get_pointer_normalized(PlatformNativeCompositionHost*, float*, float*) {
    return PLATFORM_NATIVE_ERROR_COMPOSITION_UNAVAILABLE;
}

void platform_native_composition_host_get_last_error(PlatformNativeCompositionHost*, char* out_message, size_t out_message_max_length) {
    if (out_message != nullptr && out_message_max_length > 0) out_message[0] = '\0';
}

void platform_native_composition_host_destroy(PlatformNativeCompositionHost*) {
}
