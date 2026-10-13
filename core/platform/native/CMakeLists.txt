cmake_minimum_required(VERSION 3.20)
project(PlatformProcessTreeBridge LANGUAGES CXX)
if(NOT WIN32)
    message(FATAL_ERROR "Windows Job Object bridge requires a Windows toolchain")
endif()
add_executable(platform_process_tree_bridge ../src/adapters/windows/process-tree-bridge.cpp)
target_compile_features(platform_process_tree_bridge PRIVATE cxx_std_17)
target_compile_options(platform_process_tree_bridge PRIVATE /O2 /utf-8)
set_target_properties(platform_process_tree_bridge PROPERTIES
    OUTPUT_NAME "PlatformProcessTreeBridge"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

# Isolated fault executable is never copied into runtime component artifacts.
add_executable(platform_process_tree_bridge_test ../src/adapters/windows/process-tree-bridge.cpp)
target_compile_features(platform_process_tree_bridge_test PRIVATE cxx_std_17)
target_compile_options(platform_process_tree_bridge_test PRIVATE /O2 /utf-8)
target_compile_definitions(platform_process_tree_bridge_test PRIVATE PLATFORM_PROCESS_TREE_TEST_FAULTS)
set_target_properties(platform_process_tree_bridge_test PROPERTIES
    OUTPUT_NAME "PlatformProcessTreeBridgeTest"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
