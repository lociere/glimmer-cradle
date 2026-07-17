cmake_minimum_required(VERSION 3.20)
project(PlatformNative LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

add_library(platform_native SHARED)

target_include_directories(platform_native PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_definitions(platform_native PRIVATE PLATFORM_NATIVE_BUILD)

if(WIN32)
    set_target_properties(platform_native PROPERTIES PREFIX "")
    target_compile_options(platform_native PRIVATE /O2 /utf-8)
    target_sources(platform_native PRIVATE src/composition/composition_host_windows.cpp)
    target_link_libraries(platform_native PRIVATE d3d11 dxgi dcomp user32)

    add_executable(unity_avatar_host_launcher
        src/avatar/unity_avatar_host_launcher_windows.cpp
    )
    target_compile_options(unity_avatar_host_launcher PRIVATE /O2 /utf-8)
    target_link_libraries(unity_avatar_host_launcher PRIVATE user32)
    set_target_properties(unity_avatar_host_launcher PROPERTIES
        OUTPUT_NAME "UnityAvatarHostLauncher"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    )
else()
    target_compile_options(platform_native PRIVATE -O2 -pthread)
    target_sources(platform_native PRIVATE src/composition/composition_host_stub.cpp)
endif()

set_target_properties(platform_native PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

# native/ 只承载 C/C++ 性能底座。FunASR、CosyVoice 等 Python/PyTorch
# 官方能力引擎位于 engines/audio/，需要加速时再通过稳定 ABI 调用这里。
