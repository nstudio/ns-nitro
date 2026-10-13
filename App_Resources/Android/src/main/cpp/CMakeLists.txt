cmake_minimum_required(VERSION 3.22.1)
project(nsnitro LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Resolve @nativescript/android-jsi from node_modules
set(ANDROID_JSI_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../../node_modules/@nativescript/android-jsi/platforms/android/cpp")
if(NOT EXISTS "${ANDROID_JSI_CPP_DIR}/CMakeLists.txt")
  set(ANDROID_JSI_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../node_modules/@nativescript/android-jsi/platforms/android/cpp")
endif()

add_subdirectory(
  "${ANDROID_JSI_CPP_DIR}"
  "${CMAKE_CURRENT_BINARY_DIR}/nativescript-jsi"
)

add_library(
  nsnitro
  SHARED
  ns-nitro-jni.cpp
)

target_include_directories(
  nsnitro
  PRIVATE
  "${ANDROID_JSI_CPP_DIR}"
  "${ANDROID_JSI_CPP_DIR}/v8runtime"
  "${ANDROID_JSI_CPP_DIR}/include"
)

target_compile_options(
  nsnitro
  PRIVATE
  -O2
  -fexceptions
  -frtti
  -fvisibility=default
)

find_library(android-log-lib log)

# V8 and N-API symbols are exported by libNativeScript.so which is already
# loaded in the Android process by the NativeScript runtime.
string(REGEX REPLACE "(^| )-Wl,--no-undefined( |$)" " " CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS}")
target_link_options(
  nsnitro
  PRIVATE
  "-Wl,--unresolved-symbols=ignore-all"
  "-Wl,--allow-shlib-undefined"
)

target_link_libraries(
  nsnitro
  nativescript-jsi
  ${android-log-lib}
)
