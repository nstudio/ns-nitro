#include "NativeScriptNitro.hpp"

#include <JSIRuntime.h>
#include <NitroModules/Dispatcher.hpp>
#include <NitroModules/InstallNitro.hpp>

#include <exception>
#include <future>
#include <memory>

namespace nsnitro {

namespace {

using namespace facebook;

// Runs Nitro's callbacks and Promise settlements on NativeScript's JS thread.
class NativeScriptDispatcher final : public margelo::nitro::Dispatcher {
 public:
  explicit NativeScriptDispatcher(std::shared_ptr<tns::JSICallInvoker> invoker) : invoker_(std::move(invoker)) {}

  void runAsync(std::function<void()>&& function) override {
    invoker_->invokeAsync([function = std::move(function)](jsi::Runtime&) { function(); });
  }

  void runSync(std::function<void()>&& function) override {
    if (invoker_->isOnJSThread()) {
      function();
      return;
    }
    auto done = std::make_shared<std::promise<void>>();
    std::future<void> finished = done->get_future();
    invoker_->invokeAsync([function = std::move(function), done](jsi::Runtime&) {
      try {
        function();
        done->set_value();
      } catch (...) {
        done->set_exception(std::current_exception());
      }
    });
    finished.get();
  }

  bool isOnDispatcher() override {
    return invoker_->isOnJSThread();
  }

 private:
  std::shared_ptr<tns::JSICallInvoker> invoker_;
};

} // namespace

bool installNitro() {
  std::shared_ptr<jsi::Runtime> runtime = tns::GetJSIRuntime();
  std::shared_ptr<tns::JSICallInvoker> invoker = tns::GetJSICallInvoker();
  if (!runtime || !invoker) {
    return false;
  }
  if (runtime->global().hasProperty(*runtime, "NitroModulesProxy")) {
    return true;
  }
  margelo::nitro::install(*runtime, std::make_shared<NativeScriptDispatcher>(std::move(invoker)));
  return true;
}

} // namespace nsnitro
