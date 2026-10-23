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

# ---------------------------------------------------------------------------
# Nitro Modules v1: nitro-core (libNitroModules) and this app's Hybrid Objects
# plus the NativeScript host (libnsnitromodules).
# ---------------------------------------------------------------------------
get_filename_component(PROJECT_ROOT "${ANDROID_JSI_CPP_DIR}/../../../../../.." ABSOLUTE)
set(NITRO_NATIVE "${PROJECT_ROOT}/node_modules/nitro-core/native")
set(NITROGEN_DIR "${PROJECT_ROOT}/nitrogen/generated")
set(APP_NITRO_DIR "${PROJECT_ROOT}/nitro")

find_package(fbjni REQUIRED CONFIG)

file(GLOB NITRO_CORE_SOURCES CONFIGURE_DEPENDS
  "${NITRO_NATIVE}/cpp/src/*.cpp"
  "${NITRO_NATIVE}/android/src/main/cpp/src/*.cpp")
# Generated code includes nitro-core's Android headers as <NitroModules/...>, the layout nitro-core
# publishes through prefab, so flatten them into one staged directory.
set(NITRO_STAGED_HEADERS "${CMAKE_CURRENT_BINARY_DIR}/nitro-core-headers")
file(GLOB_RECURSE NITRO_ANDROID_HEADERS CONFIGURE_DEPENDS "${NITRO_NATIVE}/android/src/main/cpp/*.hpp")
foreach(HEADER IN LISTS NITRO_ANDROID_HEADERS)
  file(COPY "${HEADER}" DESTINATION "${NITRO_STAGED_HEADERS}/NitroModules")
endforeach()
set(NITRO_CORE_INCLUDES
  "${NITRO_NATIVE}/cpp/include"
  "${NITRO_STAGED_HEADERS}"
  "${NITRO_STAGED_HEADERS}/NitroModules")

add_library(NitroModules SHARED ${NITRO_CORE_SOURCES} "${APP_NITRO_DIR}/android/cpp/NitroCoreOnLoad.cpp")
target_compile_features(NitroModules PUBLIC cxx_std_20)
target_compile_options(NitroModules PRIVATE -O2 -frtti -fexceptions)
target_include_directories(NitroModules PUBLIC ${NITRO_CORE_INCLUDES})
target_link_libraries(NitroModules PUBLIC nativescript-jsi fbjni::fbjni android ${android-log-lib})

file(GLOB NSNITRO_MODULE_SOURCES CONFIGURE_DEPENDS
  "${NITROGEN_DIR}/shared/c++/*.cpp"
  "${NITROGEN_DIR}/android/c++/*.cpp"
  "${APP_NITRO_DIR}/cpp/*.cpp")
add_library(nsnitromodules SHARED
  ${NSNITRO_MODULE_SOURCES}
  "${NITROGEN_DIR}/android/nsnitromodulesOnLoad.cpp"
  "${APP_NITRO_DIR}/host/NativeScriptNitro.cpp"
  "${APP_NITRO_DIR}/android/cpp/NSNitroOnLoad.cpp")
target_compile_features(nsnitromodules PUBLIC cxx_std_20)
target_compile_options(nsnitromodules PRIVATE -O2 -frtti -fexceptions)
target_include_directories(nsnitromodules PRIVATE
  "${NITROGEN_DIR}/shared/c++/include"
  "${NITROGEN_DIR}/android/c++/include"
  "${NITROGEN_DIR}/android/include"
  "${APP_NITRO_DIR}/cpp"
  "${ANDROID_JSI_CPP_DIR}/v8runtime")
target_link_libraries(nsnitromodules NitroModules nativescript-jsi fbjni::fbjni ${android-log-lib})
