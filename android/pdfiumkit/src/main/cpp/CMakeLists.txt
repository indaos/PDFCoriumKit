cmake_minimum_required(VERSION 3.18)
project(pdfiumkit)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Ensure we link against NDK's shared libc++ to satisfy symbols expected
# by libpdfium.a built with recent libc++.
if(ANDROID)
    set(CMAKE_ANDROID_STL_TYPE c++_static)
endif()

if(NOT DEFINED PDFIUM_HEADERS_DIR)
    message(WARNING "PDFIUM_HEADERS_DIR not provided; defaulting relative to project")
    get_filename_component(PROJ_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../../../../../" ABSOLUTE)
    set(PDFIUM_HEADERS_DIR "${PROJ_ROOT}/src-android/pdfium/public")
endif()

if(NOT DEFINED PDFIUM_LIB_DIR)
    message(WARNING "PDFIUM_LIB_DIR not provided; defaulting relative to project")
    get_filename_component(PROJ_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../../../../../" ABSOLUTE)
    set(PDFIUM_LIB_DIR "${PROJ_ROOT}/out/android/release/lib")
endif()

message(STATUS "Using PDFIUM headers: ${PDFIUM_HEADERS_DIR}")
message(STATUS "Using PDFIUM libs:    ${PDFIUM_LIB_DIR}")

add_library(pdfium STATIC IMPORTED GLOBAL)
set_target_properties(pdfium PROPERTIES
    IMPORTED_LOCATION "${PDFIUM_LIB_DIR}/${ANDROID_ABI}/libpdfium.a"
)

add_library(pdfiumkit SHARED
    pdfiumkit_jni.cpp
)

target_include_directories(pdfiumkit PRIVATE
    ${PDFIUM_HEADERS_DIR}
)

target_link_libraries(pdfiumkit
    pdfium
    android
    log
    jnigraphics
)
