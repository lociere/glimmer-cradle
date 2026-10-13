cmake_minimum_required(VERSION 3.20)
project(DesktopProcessTreeBridge LANGUAGES CXX)
# Desktop supplies the packaging projection; Platform owns the generic Job mechanism.
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../../../../core/platform/native" "${CMAKE_CURRENT_BINARY_DIR}/platform-process-tree")
