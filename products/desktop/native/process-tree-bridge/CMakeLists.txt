cmake_minimum_required(VERSION 3.20)
project(DesktopProcessTreeBridge LANGUAGES CXX)

add_executable(desktop_process_tree_bridge DesktopProcessTreeBridge.cpp)
target_compile_features(desktop_process_tree_bridge PRIVATE cxx_std_17)
target_compile_options(desktop_process_tree_bridge PRIVATE /O2 /utf-8)
set_target_properties(desktop_process_tree_bridge PROPERTIES
    OUTPUT_NAME "DesktopProcessTreeBridge"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
