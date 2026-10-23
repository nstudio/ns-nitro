#include <NitroOnLoad.hpp>
#include <fbjni/fbjni.h>
#include <jni.h>

// nitro-core ships registerNatives() but leaves JNI_OnLoad of libNitroModules to the host.
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] { margelo::nitro::registerNatives(); });
}
