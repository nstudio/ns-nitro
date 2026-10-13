#import "NSNitroBridge.h"
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <functional>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#import <JSIRuntime.h>
#include <jsi/jsi.h>
#include <NativeScript/runtime/EventLoop.h>
#include <NativeScript/runtime/Runtime.h>
#include "v8.h"

#include <NitroModules/HybridObjectRegistry.hpp>
#include "specs/HybridDeviceSecureEnclave.hpp"

using namespace facebook;

// ============================================================================
// Pure Swift 6 C-ABI Declarations (from NSNitroSwiftEngine.swift)
// ============================================================================
extern "C" {
double nitro_swift_add_numbers(double a, double b);
void nitro_swift_sha256(const uint8_t* dataPtr, intptr_t length, char* outHexPtr);
void nitro_swift_hmac_sha256(const uint8_t* dataPtr, intptr_t dataLen,
                             const uint8_t* keyPtr, intptr_t keyLen,
                             char* outHexPtr);
double nitro_swift_simd_nbody_step(float* bufferPtr, intptr_t floatCount,
                                   float dt, intptr_t steps);
double nitro_swift_vdsp_rms(const float* bufferPtr, intptr_t floatCount);
int32_t nitro_swift_format_record(const char* nameUtf8, double score,
                                  intptr_t index, char* outBuf,
                                  intptr_t maxCap);

typedef void (*NitroSwiftAsyncCallback)(void* contextPtr, double result,
                                        double durationMs, int32_t taskCount);
void nitro_swift_async_task_group(int32_t taskCount, int32_t iterationsPerTask,
                                  void* contextPtr,
                                  NitroSwiftAsyncCallback callback);
}

namespace margelo::nitro::nativescript {

// ============================================================================
// Global Lifecycle & Memory Telemetry Counters
// ============================================================================
static std::atomic<int64_t> g_activeHybridObjects{0};
static std::atomic<int64_t> g_disposedHybridObjects{0};
static std::atomic<int64_t> g_activeNativeStates{0};
static std::atomic<int64_t> g_disposedNativeStates{0};
static std::atomic<int64_t> g_totalNativeBytesAllocated{0};
static std::atomic<uint64_t> g_nextInstanceId{1};
static bool g_isInstalled = false;

static std::string pointerToHex(const void* ptr) {
  std::ostringstream oss;
  oss << "0x" << std::hex << reinterpret_cast<uintptr_t>(ptr);
  return oss.str();
}

// ============================================================================
// Zero-Copy C++-Owned MutableBuffer for JSI ArrayBuffer
// ============================================================================
class NitroMutableBuffer final : public jsi::MutableBuffer {
 public:
  explicit NitroMutableBuffer(size_t size) : size_(size), data_(new uint8_t[size]) {
    std::memset(data_, 0, size_);
    g_totalNativeBytesAllocated.fetch_add(static_cast<int64_t>(size_),
                                          std::memory_order_relaxed);
    // Seed with a deterministic harmonic wave so JS immediately sees C++ data
    float* floatView = reinterpret_cast<float*>(data_);
    size_t floatCount = size_ / sizeof(float);
    for (size_t i = 0; i < floatCount; ++i) {
      floatView[i] = std::sin(static_cast<float>(i) * 0.05f);
    }
  }

  ~NitroMutableBuffer() override {
    delete[] data_;
    g_totalNativeBytesAllocated.fetch_sub(static_cast<int64_t>(size_),
                                          std::memory_order_relaxed);
  }

  size_t size() const override { return size_; }
  uint8_t* data() override { return data_; }

 private:
  size_t size_;
  uint8_t* data_;
};

// ============================================================================
// Custom jsi::NativeState for Lifecycle & Prototype Dispatch Verification
// ============================================================================
class NitroComputeNativeState final : public jsi::NativeState {
 public:
  NitroComputeNativeState(std::string tag, size_t simulatedBytes)
      : instanceId_(g_nextInstanceId.fetch_add(1, std::memory_order_relaxed)),
        tag_(std::move(tag)),
        memoryBytes_(simulatedBytes) {
    g_activeNativeStates.fetch_add(1, std::memory_order_relaxed);
    g_totalNativeBytesAllocated.fetch_add(static_cast<int64_t>(memoryBytes_),
                                          std::memory_order_relaxed);
  }

  ~NitroComputeNativeState() override {
    if (!disposed_) {
      dispose();
    }
  }

  void dispose() {
    bool expected = false;
    if (disposed_.compare_exchange_strong(expected, true)) {
      g_activeNativeStates.fetch_sub(1, std::memory_order_relaxed);
      g_disposedNativeStates.fetch_add(1, std::memory_order_relaxed);
      g_totalNativeBytesAllocated.fetch_sub(static_cast<int64_t>(memoryBytes_),
                                            std::memory_order_relaxed);
    }
  }

  inline double addNumbers(double a, double b) noexcept {
    accumulator_ += (a + b);
    callCount_++;
    return a + b;
  }

  inline double multiplyAccumulate(double a, double b, double c) noexcept {
    double res = std::fma(a, b, c);
    accumulator_ = res;
    callCount_++;
    return res;
  }

  uint64_t instanceId() const noexcept { return instanceId_; }
  const std::string& tag() const noexcept { return tag_; }
  size_t memoryBytes() const noexcept { return memoryBytes_; }
  uint64_t callCount() const noexcept { return callCount_; }
  double accumulator() const noexcept { return accumulator_; }
  bool isDisposed() const noexcept { return disposed_.load(); }

 private:
  uint64_t instanceId_;
  std::string tag_;
  size_t memoryBytes_;
  uint64_t callCount_{0};
  double accumulator_{0.0};
  std::atomic<bool> disposed_{false};
};

// ============================================================================
// Base Nitro HybridObject (HostObject with Cached Method Table)
// ============================================================================
class HybridObject : public jsi::HostObject {
 public:
  explicit HybridObject(const char* name, size_t nativeMemorySize = 256)
      : name_(name),
        instanceId_(g_nextInstanceId.fetch_add(1, std::memory_order_relaxed)),
        nativeMemorySize_(nativeMemorySize) {
    g_activeHybridObjects.fetch_add(1, std::memory_order_relaxed);
    g_totalNativeBytesAllocated.fetch_add(
        static_cast<int64_t>(nativeMemorySize_), std::memory_order_relaxed);
  }

  ~HybridObject() override { dispose(); }

  virtual void dispose() {
    bool expected = false;
    if (disposed_.compare_exchange_strong(expected, true)) {
      methodCache_.clear();
      g_activeHybridObjects.fetch_sub(1, std::memory_order_relaxed);
      g_disposedHybridObjects.fetch_add(1, std::memory_order_relaxed);
      g_totalNativeBytesAllocated.fetch_sub(
          static_cast<int64_t>(nativeMemorySize_), std::memory_order_relaxed);
    }
  }

  jsi::Value getOrCreateMethod(jsi::Runtime& rt,
                               const jsi::PropNameID& propName,
                               const std::string& key, unsigned int paramCount,
                               jsi::HostFunctionType&& func) {
    auto it = methodCache_.find(key);
    if (it != methodCache_.end()) {
      return jsi::Value(rt, it->second);
    }
    jsi::Function fn = jsi::Function::createFromHostFunction(
        rt, propName, paramCount, std::move(func));
    auto inserted = methodCache_.emplace(key, std::move(fn));
    return jsi::Value(rt, inserted.first->second);
  }

  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& propName) override {
    std::string name = propName.utf8(rt);
    if (name == "name") {
      return jsi::String::createFromUtf8(rt, name_);
    }
    if (name == "instanceId") {
      return jsi::Value(static_cast<double>(instanceId_));
    }
    if (name == "memorySize") {
      return jsi::Value(static_cast<double>(nativeMemorySize_));
    }
    if (name == "isDisposed") {
      return jsi::Value(disposed_.load());
    }
    if (name == "dispose") {
      return getOrCreateMethod(
          rt, propName, name, 0,
          [this](jsi::Runtime&, const jsi::Value&, const jsi::Value*,
                 size_t) -> jsi::Value {
            this->dispose();
            return jsi::Value::undefined();
          });
    }
    if (name == "toString") {
      return getOrCreateMethod(
          rt, propName, name, 0,
          [this](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value*,
                 size_t) -> jsi::Value {
            std::string desc = "[HybridObject " + name_ + " #" +
                               std::to_string(instanceId_) + "]";
            return jsi::String::createFromUtf8(runtime, desc);
          });
    }
    return jsi::Value::undefined();
  }

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime& rt) override {
    std::vector<jsi::PropNameID> props;
    props.push_back(jsi::PropNameID::forUtf8(rt, "name"));
    props.push_back(jsi::PropNameID::forUtf8(rt, "instanceId"));
    props.push_back(jsi::PropNameID::forUtf8(rt, "memorySize"));
    props.push_back(jsi::PropNameID::forUtf8(rt, "isDisposed"));
    props.push_back(jsi::PropNameID::forUtf8(rt, "dispose"));
    props.push_back(jsi::PropNameID::forUtf8(rt, "toString"));
    return props;
  }

 protected:
  std::string name_;
  uint64_t instanceId_;
  size_t nativeMemorySize_;
  std::atomic<bool> disposed_{false};
  std::unordered_map<std::string, jsi::Function> methodCache_;
};

// ============================================================================
// ANGLE #1: HybridNitroCompute (C++20 JSI HybridObject)
// ============================================================================
class HybridNitroCompute final : public HybridObject {
 public:
  HybridNitroCompute() : HybridObject("NitroCompute", 1024) {}

  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& propName) override {
    std::string name = propName.utf8(rt);

    if (name == "addNumbers") {
      return getOrCreateMethod(
          rt, propName, name, 2,
          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 2) return jsi::Value(0.0);
            return jsi::Value(args[0].asNumber() + args[1].asNumber());
          });
    }

    if (name == "fibonacci") {
      return getOrCreateMethod(
          rt, propName, name, 1,
          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            int n = count > 0 ? static_cast<int>(args[0].asNumber()) : 0;
            if (n <= 1) return jsi::Value(static_cast<double>(n));
            double a = 0.0, b = 1.0;
            for (int i = 2; i <= n; ++i) {
              double next = a + b;
              a = b;
              b = next;
            }
            return jsi::Value(b);
          });
    }

    if (name == "formatRecord") {
      return getOrCreateMethod(
          rt, propName, name, 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) return jsi::String::createFromAscii(runtime, "");
            std::string label = args[0].asString(runtime).utf8(runtime);
            double score = args[1].asNumber();
            int idx = static_cast<int>(args[2].asNumber());
            char buf[256];
            int len = std::snprintf(buf, sizeof(buf), "[NitroC++#%d] %s => %d",
                                    idx, label.c_str(),
                                    static_cast<int>(score * 100.0));
            return jsi::String::createFromUtf8(
                runtime, reinterpret_cast<const uint8_t*>(buf),
                len > 0 ? static_cast<size_t>(len) : 0);
          });
    }

    if (name == "dotProductZeroCopy") {
      return getOrCreateMethod(
          rt, propName, name, 2,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 2) return jsi::Value(0.0);
            jsi::ArrayBuffer bufA =
                args[0].asObject(runtime).getArrayBuffer(runtime);
            jsi::ArrayBuffer bufB =
                args[1].asObject(runtime).getArrayBuffer(runtime);
            size_t lenFloats =
                std::min(bufA.size(runtime), bufB.size(runtime)) / sizeof(float);
            const float* ptrA = reinterpret_cast<const float*>(bufA.data(runtime));
            const float* ptrB = reinterpret_cast<const float*>(bufB.data(runtime));

            double sum0 = 0.0, sum1 = 0.0, sum2 = 0.0, sum3 = 0.0;
            size_t i = 0;
            for (; i + 3 < lenFloats; i += 4) {
              sum0 += static_cast<double>(ptrA[i]) * ptrB[i];
              sum1 += static_cast<double>(ptrA[i + 1]) * ptrB[i + 1];
              sum2 += static_cast<double>(ptrA[i + 2]) * ptrB[i + 2];
              sum3 += static_cast<double>(ptrA[i + 3]) * ptrB[i + 3];
            }
            double total = (sum0 + sum1) + (sum2 + sum3);
            for (; i < lenFloats; ++i) {
              total += static_cast<double>(ptrA[i]) * ptrB[i];
            }
            return jsi::Value(total);
          });
    }

    if (name == "processAudioDSPZeroCopy") {
      return getOrCreateMethod(
          rt, propName, name, 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) {
              throw jsi::JSError(
                  runtime,
                  "processAudioDSPZeroCopy requires (ArrayBuffer, gain, drive)");
            }
            jsi::ArrayBuffer ab =
                args[0].asObject(runtime).getArrayBuffer(runtime);
            float gain = static_cast<float>(args[1].asNumber());
            float drive = static_cast<float>(args[2].asNumber());

            uint8_t* rawBytes = ab.data(runtime);
            size_t byteLen = ab.size(runtime);
            float* samples = reinterpret_cast<float*>(rawBytes);
            size_t numSamples = byteLen / sizeof(float);

            float peak = 0.0f;
            double sumSquares = 0.0;
            float z1 = 0.0f;
            const float alpha = 0.85f;

            // In-place biquad low-pass + analog soft-clipping saturation
            for (size_t i = 0; i < numSamples; ++i) {
              float x = samples[i] * gain;
              // Fast rational soft-clipper: x * (27 + x^2) / (27 + 9*x^2)
              float xDrive = x * drive;
              float x2 = xDrive * xDrive;
              float saturated = xDrive * (27.0f + x2) / (27.0f + 9.0f * x2);
              float filtered = (1.0f - alpha) * saturated + alpha * z1;
              z1 = filtered;
              samples[i] = filtered;

              float absVal = std::fabs(filtered);
              if (absVal > peak) peak = absVal;
              sumSquares += static_cast<double>(filtered) * filtered;
            }

            double rms =
                numSamples > 0 ? std::sqrt(sumSquares / numSamples) : 0.0;

            jsi::Object result(runtime);
            result.setProperty(runtime, "peak", static_cast<double>(peak));
            result.setProperty(runtime, "rms", rms);
            result.setProperty(runtime, "samplesProcessed",
                               static_cast<double>(numSamples));
            result.setProperty(
                runtime, "bufferAddress",
                jsi::String::createFromUtf8(runtime, pointerToHex(rawBytes)));
            return result;
          });
    }

    if (name == "allocateNativeMutableBuffer") {
      return getOrCreateMethod(
          rt, propName, name, 1,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            size_t byteSize =
                count > 0 ? static_cast<size_t>(args[0].asNumber()) : 1024;
            // rnv8::V8Runtime::createArrayBuffer(MutableBuffer) throws
            // std::logic_error("Not implemented"); construct via V8's
            // ArrayBuffer constructor and write directly into its BackingStore.
            NitroMutableBuffer mutableBuf(byteSize);
            jsi::Function abCtor =
                runtime.global().getPropertyAsFunction(runtime, "ArrayBuffer");
            jsi::Object abObj =
                abCtor.callAsConstructor(runtime, static_cast<double>(byteSize))
                    .asObject(runtime);
            jsi::ArrayBuffer ab = abObj.getArrayBuffer(runtime);
            std::memcpy(ab.data(runtime), mutableBuf.data(),
                        mutableBuf.size());
            return abObj;
          });
    }

    if (name == "computePiAsync") {
      return getOrCreateMethod(
          rt, propName, name, 1,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            int64_t iterations =
                count > 0 ? static_cast<int64_t>(args[0].asNumber()) : 2000000;
            if (iterations < 1000) iterations = 1000;

            tns::Runtime* nsRuntime = tns::Runtime::GetCurrentRuntime();
            std::weak_ptr<tns::EventLoop> weakLoop =
                nsRuntime ? nsRuntime->GetEventLoop()
                          : std::weak_ptr<tns::EventLoop>();

            jsi::Function promiseCtor =
                runtime.global().getPropertyAsFunction(runtime, "Promise");
            jsi::Function executor = jsi::Function::createFromHostFunction(
                runtime, jsi::PropNameID::forAscii(runtime, "executor"), 2,
                [iterations, weakLoop](jsi::Runtime& rt, const jsi::Value&,
                                       const jsi::Value* execArgs,
                                       size_t) -> jsi::Value {
                  auto resolvePtr = std::make_shared<jsi::Function>(
                      execArgs[0].asObject(rt).asFunction(rt));
                  jsi::Runtime* rtPtr = &rt;

                  dispatch_async(
                      dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
                        auto t0 = std::chrono::high_resolution_clock::now();
                        double sum = 0.0;
                        for (int64_t k = 0; k < iterations; ++k) {
                          double term =
                              ((k & 1) == 0 ? 1.0 : -1.0) / (2.0 * k + 1.0);
                          sum += term;
                        }
                        double piEstimate = sum * 4.0;
                        auto t1 = std::chrono::high_resolution_clock::now();
                        double durationMs =
                            std::chrono::duration<double, std::milli>(t1 - t0)
                                .count();

                        if (auto loop = weakLoop.lock()) {
                          loop->PostOrdered([rtPtr, resolvePtr, piEstimate,
                                             durationMs, iterations]() {
                            jsi::Object payload(*rtPtr);
                            payload.setProperty(*rtPtr, "pi", piEstimate);
                            payload.setProperty(*rtPtr, "durationMs",
                                                durationMs);
                            payload.setProperty(
                                *rtPtr, "iterations",
                                static_cast<double>(iterations));
                            payload.setProperty(
                                *rtPtr, "dispatcher",
                                jsi::String::createFromAscii(
                                    *rtPtr,
                                    "GCD QOS_USER_INITIATED -> "
                                    "tns::EventLoop::PostOrdered"));
                            resolvePtr->call(*rtPtr, payload);
                          });
                        }
                      });

                  return jsi::Value::undefined();
                });

            return promiseCtor.callAsConstructor(runtime, executor);
          });
    }

    return HybridObject::get(rt, propName);
  }
};

// ============================================================================
// ANGLE #2: HybridSwiftEngine (Pure Swift 6 CryptoKit + SIMD4 + TaskGroup)
// ============================================================================
class HybridSwiftEngine final : public HybridObject {
 public:
  HybridSwiftEngine() : HybridObject("SwiftEngine", 2048) {}

  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& propName) override {
    std::string name = propName.utf8(rt);

    if (name == "addNumbers") {
      return getOrCreateMethod(
          rt, propName, name, 2,
          [](jsi::Runtime&, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 2) return jsi::Value(0.0);
            return jsi::Value(nitro_swift_add_numbers(args[0].asNumber(),
                                                      args[1].asNumber()));
          });
    }

    if (name == "sha256") {
      return getOrCreateMethod(
          rt, propName, name, 1,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 1) return jsi::String::createFromAscii(runtime, "");
            std::string utf8Str = args[0].asString(runtime).utf8(runtime);
            char hexOut[65];
            nitro_swift_sha256(
                reinterpret_cast<const uint8_t*>(utf8Str.data()),
                static_cast<intptr_t>(utf8Str.size()), hexOut);
            return jsi::String::createFromAscii(runtime, hexOut, 64);
          });
    }

    if (name == "sha256ZeroCopyBuffer") {
      return getOrCreateMethod(
          rt, propName, name, 1,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 1) return jsi::String::createFromAscii(runtime, "");
            jsi::ArrayBuffer ab =
                args[0].asObject(runtime).getArrayBuffer(runtime);
            char hexOut[65];
            nitro_swift_sha256(ab.data(runtime),
                               static_cast<intptr_t>(ab.size(runtime)), hexOut);
            return jsi::String::createFromAscii(runtime, hexOut, 64);
          });
    }

    if (name == "hmacSha256") {
      return getOrCreateMethod(
          rt, propName, name, 2,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 2) return jsi::String::createFromAscii(runtime, "");
            std::string msg = args[0].asString(runtime).utf8(runtime);
            std::string key = args[1].asString(runtime).utf8(runtime);
            char hexOut[65];
            nitro_swift_hmac_sha256(
                reinterpret_cast<const uint8_t*>(msg.data()),
                static_cast<intptr_t>(msg.size()),
                reinterpret_cast<const uint8_t*>(key.data()),
                static_cast<intptr_t>(key.size()), hexOut);
            return jsi::String::createFromAscii(runtime, hexOut, 64);
          });
    }

    if (name == "formatSwiftString") {
      return getOrCreateMethod(
          rt, propName, name, 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) return jsi::String::createFromAscii(runtime, "");
            std::string label = args[0].asString(runtime).utf8(runtime);
            double score = args[1].asNumber();
            intptr_t idx = static_cast<intptr_t>(args[2].asNumber());
            char outBuf[256];
            int32_t len = nitro_swift_format_record(label.c_str(), score, idx,
                                                    outBuf, sizeof(outBuf));
            return jsi::String::createFromUtf8(
                runtime, reinterpret_cast<const uint8_t*>(outBuf),
                len > 0 ? static_cast<size_t>(len) : 0);
          });
    }

    if (name == "formatNSString") {
      return getOrCreateMethod(
          rt, propName, name, 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) return jsi::String::createFromAscii(runtime, "");
            std::string label = args[0].asString(runtime).utf8(runtime);
            double score = args[1].asNumber();
            NSInteger idx = static_cast<NSInteger>(args[2].asNumber());
            NSString* nsLabel = [NSString stringWithUTF8String:label.c_str()];
            NSString* formatted = [NSString
                stringWithFormat:@"[ObjC#%ld] %@ => %d", (long)idx, nsLabel,
                                 (int)(score * 100.0)];
            const char* outUtf8 = [formatted UTF8String];
            return jsi::String::createFromUtf8(
                runtime, reinterpret_cast<const uint8_t*>(outUtf8),
                outUtf8 ? std::strlen(outUtf8) : 0);
          });
    }

    if (name == "stepParticlesSIMDZeroCopy") {
      return getOrCreateMethod(
          rt, propName, name, 3,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 3) {
              throw jsi::JSError(
                  runtime,
                  "stepParticlesSIMDZeroCopy requires (ArrayBuffer, dt, steps)");
            }
            jsi::ArrayBuffer ab =
                args[0].asObject(runtime).getArrayBuffer(runtime);
            float dt = static_cast<float>(args[1].asNumber());
            intptr_t steps = static_cast<intptr_t>(args[2].asNumber());

            float* floatPtr = reinterpret_cast<float*>(ab.data(runtime));
            intptr_t floatCount =
                static_cast<intptr_t>(ab.size(runtime) / sizeof(float));

            double energy =
                nitro_swift_simd_nbody_step(floatPtr, floatCount, dt, steps);
            double rms = nitro_swift_vdsp_rms(floatPtr, floatCount);

            jsi::Object res(runtime);
            res.setProperty(runtime, "totalEnergy", energy);
            res.setProperty(runtime, "vDspRms", rms);
            res.setProperty(runtime, "simdVectors",
                            static_cast<double>(floatCount / 4));
            res.setProperty(
                runtime, "backingStoreAddress",
                jsi::String::createFromUtf8(runtime, pointerToHex(floatPtr)));
            return res;
          });
    }

    if (name == "runSwiftTaskGroupAsync") {
      return getOrCreateMethod(
          rt, propName, name, 2,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            int32_t tasks =
                count > 0 ? static_cast<int32_t>(args[0].asNumber()) : 8;
            int32_t itersPerTask =
                count > 1 ? static_cast<int32_t>(args[1].asNumber()) : 250000;

            tns::Runtime* nsRuntime = tns::Runtime::GetCurrentRuntime();
            std::weak_ptr<tns::EventLoop> weakLoop =
                nsRuntime ? nsRuntime->GetEventLoop()
                          : std::weak_ptr<tns::EventLoop>();

            jsi::Function promiseCtor =
                runtime.global().getPropertyAsFunction(runtime, "Promise");
            jsi::Function executor = jsi::Function::createFromHostFunction(
                runtime, jsi::PropNameID::forAscii(runtime, "executor"), 2,
                [tasks, itersPerTask, weakLoop](
                    jsi::Runtime& rt, const jsi::Value&,
                    const jsi::Value* execArgs, size_t) -> jsi::Value {
                  struct AsyncContext {
                    jsi::Runtime* rt;
                    std::shared_ptr<jsi::Function> resolve;
                    std::weak_ptr<tns::EventLoop> weakLoop;
                    int32_t itersPerTask;
                  };

                  auto* ctx = new AsyncContext{
                      &rt,
                      std::make_shared<jsi::Function>(
                          execArgs[0].asObject(rt).asFunction(rt)),
                      weakLoop, itersPerTask};

                  nitro_swift_async_task_group(
                      tasks, itersPerTask, ctx,
                      [](void* rawCtx, double result, double durationMs,
                         int32_t completedTasks) {
                        auto* context = static_cast<AsyncContext*>(rawCtx);
                        if (auto loop = context->weakLoop.lock()) {
                          jsi::Runtime* rtPtr = context->rt;
                          auto resolvePtr = context->resolve;
                          int32_t iters = context->itersPerTask;
                          delete context;

                          loop->PostOrdered([rtPtr, resolvePtr, result,
                                             durationMs, completedTasks,
                                             iters]() {
                            jsi::Object out(*rtPtr);
                            out.setProperty(*rtPtr, "result", result);
                            out.setProperty(*rtPtr, "durationMs", durationMs);
                            out.setProperty(
                                *rtPtr, "tasks",
                                static_cast<double>(completedTasks));
                            out.setProperty(
                                *rtPtr, "totalIterations",
                                static_cast<double>(completedTasks) * iters);
                            out.setProperty(
                                *rtPtr, "concurrencyEngine",
                                jsi::String::createFromAscii(
                                    *rtPtr,
                                    "Swift 6 withTaskGroup -> "
                                    "tns::EventLoop::PostOrdered"));
                            resolvePtr->call(*rtPtr, out);
                          });
                        } else {
                          delete context;
                        }
                      });

                  return jsi::Value::undefined();
                });

            return promiseCtor.callAsConstructor(runtime, executor);
          });
    }

    return HybridObject::get(rt, propName);
  }
};

// ============================================================================
// Prototype + jsi::NativeState Factory (Nitro's Modern Prototype Architecture)
// ============================================================================
static jsi::Object createNitroPrototypeComputeInstance(jsi::Runtime& rt,
                                                       const std::string& tag,
                                                       size_t memoryBytes) {
  // Build or reuse the shared prototype on globalThis.__NitroComputeProto
  jsi::Object global = rt.global();
  jsi::Object proto(rt);
  if (global.hasProperty(rt, "__NitroComputeProto")) {
    proto = global.getPropertyAsObject(rt, "__NitroComputeProto");
  } else {
    proto.setProperty(
        rt, "addNumbers",
        jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "addNumbers"), 2,
            [](jsi::Runtime& runtime, const jsi::Value& thisVal,
               const jsi::Value* args, size_t count) -> jsi::Value {
              if (count < 2) return jsi::Value(0.0);
              // Fast path: unwrap NativeState if called as method on instance
              if (thisVal.isObject()) {
                jsi::Object selfObj = thisVal.asObject(runtime);
                if (selfObj.hasNativeState<NitroComputeNativeState>(runtime)) {
                  auto state =
                      selfObj.getNativeState<NitroComputeNativeState>(runtime);
                  return jsi::Value(state->addNumbers(args[0].asNumber(),
                                                      args[1].asNumber()));
                }
              }
              return jsi::Value(args[0].asNumber() + args[1].asNumber());
            }));

    proto.setProperty(
        rt, "multiplyAccumulate",
        jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "multiplyAccumulate"), 3,
            [](jsi::Runtime& runtime, const jsi::Value& thisVal,
               const jsi::Value* args, size_t count) -> jsi::Value {
              if (count < 3) return jsi::Value(0.0);
              auto state = thisVal.asObject(runtime)
                               .getNativeState<NitroComputeNativeState>(runtime);
              return jsi::Value(state->multiplyAccumulate(
                  args[0].asNumber(), args[1].asNumber(), args[2].asNumber()));
            }));

    proto.setProperty(
        rt, "getStateSummary",
        jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "getStateSummary"), 0,
            [](jsi::Runtime& runtime, const jsi::Value& thisVal,
               const jsi::Value*, size_t) -> jsi::Value {
              jsi::Object selfObj = thisVal.asObject(runtime);
              auto state =
                  selfObj.getNativeState<NitroComputeNativeState>(runtime);
              jsi::Object info(runtime);
              info.setProperty(runtime, "instanceId",
                               static_cast<double>(state->instanceId()));
              info.setProperty(
                  runtime, "tag",
                  jsi::String::createFromUtf8(runtime, state->tag()));
              info.setProperty(runtime, "memoryBytes",
                               static_cast<double>(state->memoryBytes()));
              info.setProperty(runtime, "callCount",
                               static_cast<double>(state->callCount()));
              info.setProperty(runtime, "accumulator", state->accumulator());
              info.setProperty(runtime, "isDisposed", state->isDisposed());
              return info;
            }));

    proto.setProperty(
        rt, "dispose",
        jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "dispose"), 0,
            [](jsi::Runtime& runtime, const jsi::Value& thisVal,
               const jsi::Value*, size_t) -> jsi::Value {
              jsi::Object selfObj = thisVal.asObject(runtime);
              if (selfObj.hasNativeState<NitroComputeNativeState>(runtime)) {
                auto state =
                    selfObj.getNativeState<NitroComputeNativeState>(runtime);
                state->dispose();
              }
              return jsi::Value::undefined();
            }));

    global.setProperty(rt, "__NitroComputeProto", proto);
  }

  // rnv8::V8Runtime::setNativeState allocates a new 2-internal-field
  // v8::ObjectTemplate instance and resets the JSI handle, so prototype linkage
  // must happen after setNativeState.
  jsi::Object instance(rt);
  auto nativeState =
      std::make_shared<NitroComputeNativeState>(tag, memoryBytes);
  instance.setNativeState(rt, nativeState);
  instance.setExternalMemoryPressure(rt, memoryBytes);

  jsi::Object objectCtor = global.getPropertyAsObject(rt, "Object");
  jsi::Function setProtoFn =
      objectCtor.getPropertyAsFunction(rt, "setPrototypeOf");
  setProtoFn.call(rt, instance, proto);
  return instance;
}

// ============================================================================
// Install globalThis.NitroModules on NativeScript's JSI V8Runtime
// ============================================================================
static bool installNitroModulesOnRuntime(jsi::Runtime& rt) {
  margelo::nitro::nsnitro::HybridDeviceSecureEnclave::registerInRegistry();

  jsi::Object nitroModules(rt);

  nitroModules.setProperty(
      rt, "version", jsi::String::createFromAscii(rt, "1.0.0-ns-v8-jsi"));
  nitroModules.setProperty(
      rt, "hostPlatform",
      jsi::String::createFromAscii(rt, "NativeScript iOS 9.1 (V8 + rnv8::JSI)"));

  // 1. NitroModules.createHybridObject(name, options?)
  nitroModules.setProperty(
      rt, "createHybridObject",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "createHybridObject"), 1,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 1 || !args[0].isString()) {
              throw jsi::JSError(
                  runtime,
                  "NitroModules.createHybridObject(name) requires a module name");
            }
            std::string name = args[0].asString(runtime).utf8(runtime);
            if (margelo::nitro::HybridObjectRegistry::hasHybridObject(name)) {
              auto hybridObj =
                  margelo::nitro::HybridObjectRegistry::createHybridObject(
                      name);
              g_activeHybridObjects.fetch_add(1, std::memory_order_relaxed);
              return hybridObj->toObject(runtime);
            }
            if (name == "NitroCompute") {
              return jsi::Object::createFromHostObject(
                  runtime, std::make_shared<HybridNitroCompute>());
            }
            if (name == "SwiftEngine") {
              return jsi::Object::createFromHostObject(
                  runtime, std::make_shared<HybridSwiftEngine>());
            }
            if (name == "NitroPrototypeCompute") {
              std::string tag = "NitroProto";
              size_t memBytes = 4096;
              if (count > 1 && args[1].isString()) {
                tag = args[1].asString(runtime).utf8(runtime);
              }
              if (count > 2 && args[2].isNumber()) {
                memBytes = static_cast<size_t>(args[2].asNumber());
              }
              return createNitroPrototypeComputeInstance(runtime, tag, memBytes);
            }
            throw jsi::JSError(
                runtime, "Unknown Nitro HybridObject registered: " + name);
          }));

  // 2. NitroModules.getRegisteredModules()
  nitroModules.setProperty(
      rt, "getRegisteredModules",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "getRegisteredModules"), 0,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value*,
             size_t) -> jsi::Value {
            std::vector<std::string> names = {
                "NitroCompute", "NitroPrototypeCompute", "SwiftEngine"};
            for (const auto& regName :
                 margelo::nitro::HybridObjectRegistry::
                     getAllRegisteredHybridObjectNames()) {
              names.push_back(regName);
            }
            jsi::Array arr(runtime, names.size());
            for (size_t i = 0; i < names.size(); ++i) {
              arr.setValueAtIndex(
                  runtime, i, jsi::String::createFromUtf8(runtime, names[i]));
            }
            return arr;
          }));

  // 3. NitroModules.hasNativeState(obj)
  nitroModules.setProperty(
      rt, "hasNativeState",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "hasNativeState"), 1,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value* args,
             size_t count) -> jsi::Value {
            if (count < 1 || !args[0].isObject()) return jsi::Value(false);
            jsi::Object obj = args[0].asObject(runtime);
            if (obj.isHostObject(runtime)) return jsi::Value(false);
            return jsi::Value(obj.hasNativeState(runtime));
          }));

  // 4. NitroModules.getRuntimeDiagnostics()
  nitroModules.setProperty(
      rt, "getRuntimeDiagnostics",
      jsi::Function::createFromHostFunction(
          rt, jsi::PropNameID::forAscii(rt, "getRuntimeDiagnostics"), 0,
          [](jsi::Runtime& runtime, const jsi::Value&, const jsi::Value*,
             size_t) -> jsi::Value {
            jsi::Object diag(runtime);
            diag.setProperty(
                runtime, "runtimeDescription",
                jsi::String::createFromUtf8(runtime, runtime.description()));
            diag.setProperty(
                runtime, "v8Version",
                jsi::String::createFromUtf8(runtime, v8::V8::GetVersion()));

            tns::Runtime* nsRt = tns::Runtime::GetCurrentRuntime();
            v8::Isolate* isolate = nsRt ? nsRt->GetIsolate() : nullptr;
            diag.setProperty(
                runtime, "v8IsolateAddress",
                jsi::String::createFromUtf8(runtime, pointerToHex(isolate)));
            diag.setProperty(
                runtime, "jsiRuntimeAddress",
                jsi::String::createFromUtf8(runtime, pointerToHex(&runtime)));

            // Verify NativeState live
            jsi::Object probeObj(runtime);
            auto probeState =
                std::make_shared<NitroComputeNativeState>("probe", 64);
            probeObj.setNativeState(runtime, probeState);
            bool nativeStateWorks =
                probeObj.hasNativeState<NitroComputeNativeState>(runtime) &&
                probeObj.getNativeState<NitroComputeNativeState>(runtime)
                        ->tag() == "probe";
            probeState->dispose();

            diag.setProperty(runtime, "nativeStateSupported", nativeStateWorks);
            diag.setProperty(runtime, "zeroCopyArrayBufferSupported", true);
            diag.setProperty(runtime, "swiftCxxDirectInterop", true);
            diag.setProperty(runtime, "activeHybridObjects",
                             static_cast<double>(g_activeHybridObjects.load()));
            diag.setProperty(
                runtime, "disposedHybridObjects",
                static_cast<double>(g_disposedHybridObjects.load()));
            diag.setProperty(runtime, "activeNativeStates",
                             static_cast<double>(g_activeNativeStates.load()));
            diag.setProperty(
                runtime, "disposedNativeStates",
                static_cast<double>(g_disposedNativeStates.load()));
            diag.setProperty(
                runtime, "totalNativeBytesAllocated",
                static_cast<double>(g_totalNativeBytesAllocated.load()));
            return diag;
          }));

  rt.global().setProperty(rt, "NitroModules", nitroModules);
  g_isInstalled = true;
  return true;
}

}  // namespace margelo::nitro::nativescript

@implementation NSNitroBridge

+ (BOOL)install {
  std::shared_ptr<facebook::jsi::Runtime> jsiRuntime = [NSJSIRuntime runtime];
  if (!jsiRuntime) {
    NSLog(@"[NSNitroBridge] Failed to acquire +[NSJSIRuntime runtime]");
    return NO;
  }
  bool ok =
      margelo::nitro::nativescript::installNitroModulesOnRuntime(*jsiRuntime);
  NSLog(@"[NSNitroBridge] Installed NitroModules JSI host on NativeScript V8 "
        @"Isolate (ok=%d)",
        ok);
  return ok ? YES : NO;
}

+ (BOOL)isInstalled {
  return margelo::nitro::nativescript::g_isInstalled ? YES : NO;
}

@end

@implementation NSClassicObjCBridge

+ (double)addNumbers:(double)a b:(double)b {
  return a + b;
}

+ (NSString *)sha256String:(NSString *)input {
  const char *utf8 = [input UTF8String];
  if (!utf8) return @"";
  char hexOut[65];
  nitro_swift_sha256(reinterpret_cast<const uint8_t *>(utf8),
                     static_cast<intptr_t>(std::strlen(utf8)), hexOut);
  return [NSString stringWithUTF8String:hexOut];
}

+ (NSString *)formatRecord:(NSString *)name
                     score:(double)score
                     index:(NSInteger)index {
  return [NSString stringWithFormat:@"[ObjC#%ld] %@ => %d", (long)index, name,
                                    (int)(score * 100.0)];
}

+ (double)stepParticlesObjC:(NSMutableData *)data
                         dt:(float)dt
                      steps:(NSInteger)steps {
  if (!data) return 0.0;
  float *ptr = static_cast<float *>([data mutableBytes]);
  intptr_t floatCount = static_cast<intptr_t>([data length] / sizeof(float));
  return nitro_swift_simd_nbody_step(ptr, floatCount, dt,
                                     static_cast<intptr_t>(steps));
}

@end

// ============================================================================
// APPLES-TO-APPLES (TSC): DIRECT C FUNCTION IMPLEMENTATIONS (NO OBJC_MSGSEND)
// ============================================================================
extern "C" double ns_direct_c_add(double a, double b) {
  return a + b;
}

extern "C" double ns_direct_c_dsp(void *bufferPtr,
                                  int32_t floatCount,
                                  float gain,
                                  float drive) {
  if (!bufferPtr || floatCount <= 0) return 0.0;
  float *samples = static_cast<float *>(bufferPtr);
  float peak = 0.0f;
  float z1 = 0.0f;
  const float alpha = 0.85f;

  for (int32_t i = 0; i < floatCount; ++i) {
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

extern "C" int32_t ns_direct_c_format_utf8(const char *labelUtf8,
                                           double score,
                                           int32_t index) {
  char buf[256];
  int len = std::snprintf(buf, sizeof(buf), "[DirectC#%d] %s => %d",
                          static_cast<int>(index),
                          labelUtf8 ? labelUtf8 : "",
                          static_cast<int>(score * 100.0));
  return static_cast<int32_t>(len);
}


