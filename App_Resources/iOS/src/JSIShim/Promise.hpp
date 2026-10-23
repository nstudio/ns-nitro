#pragma once

#import <dispatch/dispatch.h>

#include <exception>
#include <functional>
#include <memory>
#include <string>

#include <jsi/jsi.h>
#include <NativeScript/runtime/EventLoop.h>
#include <NativeScript/runtime/Runtime.h>

namespace margelo::nitro {

template <typename TResult>
class Promise final : public std::enable_shared_from_this<Promise<TResult>> {
 public:
  using WorkFn = std::function<TResult()>;

  explicit Promise(WorkFn&& workFn) : workFn_(std::move(workFn)) {}

  static std::shared_ptr<Promise<TResult>> async(WorkFn&& run) {
    return std::make_shared<Promise<TResult>>(std::move(run));
  }

  template <typename TConverter>
  facebook::jsi::Value toJSI(facebook::jsi::Runtime& rt,
                             TConverter&& resultConverter) {
    facebook::jsi::Function promiseCtor =
        rt.global().getPropertyAsFunction(rt, "Promise");
    tns::Runtime* nsRuntime = tns::Runtime::GetCurrentRuntime();
    std::weak_ptr<tns::EventLoop> weakLoop =
        nsRuntime ? nsRuntime->GetEventLoop()
                  : std::weak_ptr<tns::EventLoop>();
    auto work = workFn_;

    auto executor = facebook::jsi::Function::createFromHostFunction(
        rt, facebook::jsi::PropNameID::forAscii(rt, "PromiseExecutor"), 2,
        [weakLoop, work, resultConverter](
            facebook::jsi::Runtime& runtime,
            const facebook::jsi::Value& /*thisVal*/,
            const facebook::jsi::Value* args,
            size_t count) -> facebook::jsi::Value {
          if (count < 2) {
            throw facebook::jsi::JSError(
                runtime, "Promise executor requires resolve and reject");
          }
          auto resolvePtr = std::make_shared<facebook::jsi::Function>(
              args[0].asObject(runtime).asFunction(runtime));
          auto rejectPtr = std::make_shared<facebook::jsi::Function>(
              args[1].asObject(runtime).asFunction(runtime));
          facebook::jsi::Runtime* rtPtr = &runtime;

          dispatch_async(
              dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
                try {
                  TResult value = work();
                  if (auto loop = weakLoop.lock()) {
                    loop->PostOrdered([rtPtr, resolvePtr, rejectPtr,
                                       resultConverter,
                                       value = std::move(value)]() {
                      try {
                        facebook::jsi::Value jsiVal =
                            resultConverter(*rtPtr, value);
                        resolvePtr->call(*rtPtr, jsiVal);
                      } catch (const std::exception& ex) {
                        rejectPtr->call(
                            *rtPtr, facebook::jsi::String::createFromUtf8(
                                        *rtPtr, ex.what()));
                      }
                    });
                  }
                } catch (const std::exception& ex) {
                  std::string message = ex.what();
                  if (auto loop = weakLoop.lock()) {
                    loop->PostOrdered(
                        [rtPtr, rejectPtr, message]() {
                          rejectPtr->call(
                              *rtPtr, facebook::jsi::String::createFromUtf8(
                                          *rtPtr, message));
                        });
                  }
                }
              });

          return facebook::jsi::Value::undefined();
        });

    return promiseCtor.callAsConstructor(rt, std::move(executor));
  }

 private:
  WorkFn workFn_;
};

}  // namespace margelo::nitro
