#include <NSNitroModules/private/nsnitromodulesOnLoad.hpp>
#include <fbjni/fbjni.h>
#include <jni.h>

#include "../../host/NativeScriptNitro.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] { margelo::nitro::nsnitro::registerAllNatives(); });
}

extern "C" JNIEXPORT jboolean JNICALL Java_org_nativescript_nsnitro_NitroModulesHost_nativeInstall(JNIEnv*, jclass) {
  return nsnitro::installNitro() ? JNI_TRUE : JNI_FALSE;
}
