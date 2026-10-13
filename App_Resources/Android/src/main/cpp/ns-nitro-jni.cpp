#include <jni.h>
#include <android/log.h>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>

#include "JSIRuntime.h"
#include "jsi/jsi.h"
#include "v8.h"

using namespace facebook;

// ============================================================================
// Minimal Node-API (N-API) ABI Declarations Resolved from libNativeScript.so
// ============================================================================
typedef struct napi_env__* napi_env;
typedef struct napi_value__* napi_value;
typedef struct napi_callback_info__* napi_callback_info;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);

typedef enum {
  napi_ok = 0,
} napi_status;

typedef enum {
  napi_default = 0,
} napi_property_attributes;

extern "C" {
napi_env NativeScriptNapiEnv(void);
napi_status napi_get_global(napi_env env, napi_value* result);
napi_status napi_create_object(napi_env env, napi_value* result);
napi_status napi_set_named_property(napi_env env,
                                    napi_value object,
                                    const char* utf8name,
                                    napi_value value);
napi_status napi_create_function(napi_env env,
                                 const char* utf8name,
                                 size_t length,
                                 napi_callback cb,
                                 void* data,
                                 napi_value* result);
napi_status napi_get_cb_info(napi_env env,
                             napi_callback_info cbinfo,
                             size_t* argc,
                             napi_value* argv,
                             napi_value* this_arg,
                             void** data);
napi_status napi_get_value_double(napi_env env,
                                  napi_value value,
                                  double* result);
napi_status napi_get_value_int32(napi_env env,
                                 napi_value value,
                                 int32_t* result);
napi_status napi_create_double(napi_env env, double value, napi_value* result);
napi_status napi_get_value_string_utf8(napi_env env,
                                       napi_value value,
                                       char* buf,
                                       size_t bufsize,
                                       size_t* result);
napi_status napi_create_string_utf8(napi_env env,
                                    const char* str,
                                    size_t length,
                                    napi_value* result);
napi_status napi_get_arraybuffer_info(napi_env env,
                                      napi_value arraybuffer,
                                      void** data,
                                      size_t* byte_length);
}

namespace {

JavaVM* g_javaVm = nullptr;
jclass g_bridgeClass = nullptr;
jmethodID g_addNumbersMethod = nullptr;
jmethodID g_formatRecordMethod = nullptr;
jmethodID g_processDspMethod = nullptr;

// ============================================================================
// Pure C Functions Shared by Both JSI HostFunctions and N-API C Wrappers
// ============================================================================
extern "C" double ns_c_add(double a, double b) {
  return a + b;
}

extern "C" double ns_c_dsp(void* rawData,
                           size_t byteLen,
                           float gain,
                           float drive) {
  if (!rawData || byteLen < sizeof(float)) return 0.0;
  float* samples = static_cast<float*>(rawData);
  size_t count = byteLen / sizeof(float);
  float peak = 0.0f;
  float z1 = 0.0f;
  const float alpha = 0.85f;

  for (size_t i = 0; i < count; ++i) {
    float x = samples[i] * gain;
    float xDrive = x * drive;
    float x2 = xDrive * xDrive;
    float saturated = xDrive * (27.0f + x2) / (27.0f + 9.0f * x2);
    float filtered = (1.0f - alpha) * saturated + alpha * z1;
    z1 = filtered;
    samples[i] = filtered;
    float absVal = std::fabs(filtered);
    if (absVal > peak) peak = absVal;
  }
  return static_cast<double>(peak);
}

extern "C" int ns_c_format(const char* label,
                           double score,
                           int32_t index,
                           char* outBuf,
                           size_t outCap) {
  return std::snprintf(outBuf, outCap, "[DirectC#%d] %s => %d",
                       static_cast<int>(index), label ? label : "",
                       static_cast<int>(score * 100.0));
}

// ============================================================================
// N-API C Function Callbacks (Android N-API C Wrapper Pathway)
// ============================================================================
napi_value NapiAddNumbers(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  double a = 0.0, b = 0.0;
  if (argc >= 2) {
    napi_get_value_double(env, argv[0], &a);
    napi_get_value_double(env, argv[1], &b);
  }
  napi_value result = nullptr;
  napi_create_double(env, ns_c_add(a, b), &result);
  return result;
}

napi_value NapiDspZeroCopy(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  void* data = nullptr;
  size_t byteLen = 0;
  double gain = 1.0, drive = 1.0;
  if (argc >= 3) {
    napi_get_arraybuffer_info(env, argv[0], &data, &byteLen);
    napi_get_value_double(env, argv[1], &gain);
    napi_get_value_double(env, argv[2], &drive);
  }
  double peak = ns_c_dsp(data, byteLen, static_cast<float>(gain),
                         static_cast<float>(drive));
  napi_value result = nullptr;
  napi_create_double(env, peak, &result);
  return result;
}

napi_value NapiFormatRecord(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  char label[128] = {0};
  size_t labelLen = 0;
  double score = 0.0;
  int32_t index = 0;
  if (argc >= 3) {
    napi_get_value_string_utf8(env, argv[0], label, sizeof(label), &labelLen);
    napi_get_value_double(env, argv[1], &score);
    napi_get_value_int32(env, argv[2], &index);
  }
  char outBuf[256];
  int len = ns_c_format(label, score, index, outBuf, sizeof(outBuf));
  napi_value result = nullptr;
  napi_create_string_utf8(env, outBuf, len > 0 ? static_cast<size_t>(len) : 0,
                          &result);
  return result;
}

void InstallNapiBenchmarks() {
  napi_env env = NativeScriptNapiEnv();
  if (!env) {
    __android_log_print(ANDROID_LOG_WARN, "NSNitroJNI",
                        "NativeScriptNapiEnv() returned null");
    return;
  }

  napi_value global = nullptr;
  if (napi_get_global(env, &global) != napi_ok || !global) return;

  napi_value napiBenchObj = nullptr;
  if (napi_create_object(env, &napiBenchObj) != napi_ok || !napiBenchObj) return;

  napi_value addFn = nullptr;
  napi_create_function(env, "addNumbers", 10, NapiAddNumbers, nullptr, &addFn);
  napi_set_named_property(env, napiBenchObj, "addNumbers", addFn);

  napi_value dspFn = nullptr;
  napi_create_function(env, "processAudioDSPZeroCopy", 23, NapiDspZeroCopy,
                       nullptr, &dspFn);
  napi_set_named_property(env, napiBenchObj, "processAudioDSPZeroCopy", dspFn);

  napi_value fmtFn = nullptr;
  napi_create_function(env, "formatRecord", 12, NapiFormatRecord, nullptr,
                       &fmtFn);
  napi_set_named_property(env, napiBenchObj, "formatRecord", fmtFn);

  napi_set_named_property(env, global, "__NS_NAPI_BENCH__", napiBenchObj);
}

JNIEnv* GetCurrentJniEnv() {
  if (!g_javaVm) return nullptr;
  JNIEnv* env = nullptr;
  if (g_javaVm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) ==
      JNI_OK) {
    return env;
  }
  return nullptr;
}

void InstallJsiAndNitroJniBenchmarks() {
  jsi::Runtime* rtPtr = NativeScriptJSIRuntime();
  if (!rtPtr) {
    __android_log_print(ANDROID_LOG_WARN, "NSNitroJNI",
                        "NativeScriptJSIRuntime() returned null");
    return;
  }
  jsi::Runtime& rt = *rtPtr;
  jsi::Object benchObj(rt);

  // 1. Direct JSI C++ HostFunction -> C Function (ns_c_add)
  benchObj.setProperty(
      rt, "jsiAddNumbers",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "jsiAddNumbers"), 2,
          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 2) return jsi::Value(0.0);
            return jsi::Value(ns_c_add(args[0].asNumber(), args[1].asNumber()));
          }));

  // 2. Direct JSI Zero-Copy ArrayBuffer -> C Function (ns_c_dsp)
  benchObj.setProperty(
      rt, "jsiDspZeroCopy",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "jsiDspZeroCopy"), 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) return jsi::Value(0.0);
            jsi::ArrayBuffer ab =
                args[0].asObject(runtime).getArrayBuffer(runtime);
            float gain = static_cast<float>(args[1].asNumber());
            float drive = static_cast<float>(args[2].asNumber());
            return jsi::Value(
                ns_c_dsp(ab.data(runtime), ab.size(runtime), gain, drive));
          }));

  // 3. Direct JSI UTF-8 String -> C Function (ns_c_format)
  benchObj.setProperty(
      rt, "jsiFormatRecord",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "jsiFormatRecord"), 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) return jsi::String::createFromAscii(runtime, "");
            std::string label = args[0].asString(runtime).utf8(runtime);
            double score = args[1].asNumber();
            int32_t idx = static_cast<int32_t>(args[2].asNumber());
            char outBuf[256];
            int len =
                ns_c_format(label.c_str(), score, idx, outBuf, sizeof(outBuf));
            return jsi::String::createFromUtf8(
                runtime, reinterpret_cast<const uint8_t*>(outBuf),
                len > 0 ? static_cast<size_t>(len) : 0);
          }));

  // 4. Nitro JNI Call: JSI HostFunction -> C++ -> JNIEnv -> Java addNumbers
  benchObj.setProperty(
      rt, "nitroJniAddNumbers",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "nitroJniAddNumbers"), 2,
          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 2) return jsi::Value(0.0);
            JNIEnv* env = GetCurrentJniEnv();
            if (!env || !g_bridgeClass || !g_addNumbersMethod) {
              return jsi::Value(args[0].asNumber() + args[1].asNumber());
            }
            jdouble res = env->CallStaticDoubleMethod(
                g_bridgeClass, g_addNumbersMethod,
                static_cast<jdouble>(args[0].asNumber()),
                static_cast<jdouble>(args[1].asNumber()));
            return jsi::Value(static_cast<double>(res));
          }));

  // 5. Nitro JNI Call: JSI HostFunction -> C++ -> JNIEnv -> Java formatRecord
  benchObj.setProperty(
      rt, "nitroJniFormatRecord",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "nitroJniFormatRecord"), 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) return jsi::String::createFromAscii(runtime, "");
            JNIEnv* env = GetCurrentJniEnv();
            std::string label = args[0].asString(runtime).utf8(runtime);
            double score = args[1].asNumber();
            int32_t idx = static_cast<int32_t>(args[2].asNumber());
            if (!env || !g_bridgeClass || !g_formatRecordMethod) {
              return jsi::String::createFromAscii(runtime, "");
            }
            jstring jLabel = env->NewStringUTF(label.c_str());
            jstring jResult = static_cast<jstring>(env->CallStaticObjectMethod(
                g_bridgeClass, g_formatRecordMethod, jLabel,
                static_cast<jdouble>(score), static_cast<jint>(idx)));
            env->DeleteLocalRef(jLabel);
            if (!jResult) {
              return jsi::String::createFromAscii(runtime, "");
            }
            const char* utfChars = env->GetStringUTFChars(jResult, nullptr);
            std::string outStr(utfChars ? utfChars : "");
            if (utfChars) {
              env->ReleaseStringUTFChars(jResult, utfChars);
            }
            env->DeleteLocalRef(jResult);
            return jsi::String::createFromUtf8(runtime, outStr);
          }));

  // 6. Nitro JNI Call: JSI HostFunction -> C++ -> NewDirectByteBuffer -> Java
  benchObj.setProperty(
      rt, "nitroJniDspByteBuffer",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "nitroJniDspByteBuffer"), 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) return jsi::Value(0.0);
            JNIEnv* env = GetCurrentJniEnv();
            jsi::ArrayBuffer ab =
                args[0].asObject(runtime).getArrayBuffer(runtime);
            float gain = static_cast<float>(args[1].asNumber());
            float drive = static_cast<float>(args[2].asNumber());
            if (!env || !g_bridgeClass || !g_processDspMethod) {
              return jsi::Value(0.0);
            }
            uint8_t* dataPtr = ab.data(runtime);
            size_t byteLen = ab.size(runtime);
            jobject directBuf =
                env->NewDirectByteBuffer(dataPtr, static_cast<jlong>(byteLen));
            jdouble peak = env->CallStaticDoubleMethod(
                g_bridgeClass, g_processDspMethod, directBuf,
                static_cast<jint>(byteLen / sizeof(float)),
                static_cast<jfloat>(gain), static_cast<jfloat>(drive));
            env->DeleteLocalRef(directBuf);
            return jsi::Value(static_cast<double>(peak));
          }));

  rt.global().setProperty(rt, "__NS_NITRO_JNI_BENCH__", benchObj);
}

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_org_nativescript_nsnitro_NitroAndroidBridge_nativeInstall(
    JNIEnv* env,
    jclass /*clazz*/,
    jclass bridgeClass) {
  env->GetJavaVM(&g_javaVm);
  if (g_bridgeClass) {
    env->DeleteGlobalRef(g_bridgeClass);
  }
  g_bridgeClass = static_cast<jclass>(env->NewGlobalRef(bridgeClass));
  g_addNumbersMethod =
      env->GetStaticMethodID(g_bridgeClass, "addNumbers", "(DD)D");
  g_formatRecordMethod = env->GetStaticMethodID(
      g_bridgeClass, "formatRecord", "(Ljava/lang/String;DI)Ljava/lang/String;");
  g_processDspMethod = env->GetStaticMethodID(
      g_bridgeClass, "processDspByteBuffer", "(Ljava/nio/ByteBuffer;IFF)D");

  InstallNapiBenchmarks();
  InstallJsiAndNitroJniBenchmarks();
  return JNI_TRUE;
}
