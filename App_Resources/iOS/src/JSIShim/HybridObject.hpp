#pragma once

#include <memory>
#include <mutex>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <vector>

#include <JSIShim/JSIConverter.hpp>
#include <JSIShim/Prototype.hpp>
#include "jsi/jsi.h"

namespace nsjsi {

class HybridObject : public facebook::jsi::HostObject,
                     public facebook::jsi::NativeState,
                     public std::enable_shared_from_this<HybridObject> {
 public:
  explicit HybridObject(const char* name) : name_(name ? name : "HybridObject") {}
  ~HybridObject() override = default;

  virtual std::string getName() const noexcept { return name_; }
  virtual size_t getExternalMemorySize() noexcept { return 0; }
  virtual void dispose() noexcept {}
  virtual std::string toString() {
    return "[HybridObject " + name_ + "]";
  }
  virtual bool equals(const std::shared_ptr<HybridObject>& other) {
    return this == other.get();
  }

  virtual facebook::jsi::Object toObject(facebook::jsi::Runtime& rt) {
    ensureInitialized();
    facebook::jsi::Object obj =
        facebook::jsi::Object::createFromHostObject(rt, shared_from_this());
    size_t externalBytes = getExternalMemorySize();
    if (externalBytes > 0) {
      obj.setExternalMemoryPressure(rt, externalBytes);
    }
    return obj;
  }

  facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                           const facebook::jsi::PropNameID& propName) override {
    ensureInitialized();
    std::string key = propName.utf8(rt);

    auto getterIt = prototype_.getGetters().find(key);
    if (getterIt != prototype_.getGetters().end()) {
      return getterIt->second(rt, this);
    }

    auto methodIt = prototype_.getMethods().find(key);
    if (methodIt != prototype_.getMethods().end()) {
      std::weak_ptr<HybridObject> weakSelf = weak_from_this();
      const auto& entry = methodIt->second;
      return facebook::jsi::Function::createFromHostFunction(
          rt, propName, static_cast<unsigned int>(entry.paramCount),
          [weakSelf, invoker = entry.invoker, key](
              facebook::jsi::Runtime& runtime,
              const facebook::jsi::Value& thisVal,
              const facebook::jsi::Value* args,
              size_t count) -> facebook::jsi::Value {
            if (thisVal.isObject()) {
              facebook::jsi::Object thisObj = thisVal.getObject(runtime);
              if (thisObj.hasNativeState<HybridObject>(runtime)) {
                auto stateSelf =
                    thisObj.getNativeState<HybridObject>(runtime);
                if (stateSelf) {
                  return invoker(runtime, stateSelf.get(), args, count);
                }
              }
            }
            auto self = weakSelf.lock();
            if (!self) {
              throw facebook::jsi::JSError(
                  runtime, "Cannot call '" + key +
                               "' on a disposed or collected HybridObject");
            }
            return invoker(runtime, self.get(), args, count);
          });
    }

    return facebook::jsi::Value::undefined();
  }

  void set(facebook::jsi::Runtime& rt,
           const facebook::jsi::PropNameID& propName,
           const facebook::jsi::Value& value) override {
    ensureInitialized();
    std::string key = propName.utf8(rt);
    auto setterIt = prototype_.getSetters().find(key);
    if (setterIt != prototype_.getSetters().end()) {
      setterIt->second(rt, this, value);
      return;
    }
    throw facebook::jsi::JSError(
        rt, "Cannot assign to read-only or non-existent property '" + key +
                "' on HybridObject<" + name_ + ">");
  }

  std::vector<facebook::jsi::PropNameID> getPropertyNames(
      facebook::jsi::Runtime& rt) override {
    ensureInitialized();
    std::vector<facebook::jsi::PropNameID> names;
    names.reserve(prototype_.getGetters().size() +
                  prototype_.getMethods().size());
    for (const auto& [k, _] : prototype_.getGetters()) {
      names.push_back(facebook::jsi::PropNameID::forUtf8(rt, k));
    }
    for (const auto& [k, _] : prototype_.getMethods()) {
      names.push_back(facebook::jsi::PropNameID::forUtf8(rt, k));
    }
    return names;
  }

 protected:
  HybridObject() : name_("HybridObject") {}

  virtual void loadHybridMethods() {
    registerHybrids(this, [](Prototype& prototype) {
      prototype.registerHybridGetter("name", &HybridObject::getName);
      prototype.registerHybridGetter("memorySize",
                                     &HybridObject::getExternalMemorySize);
      prototype.registerHybridMethod("toString", &HybridObject::toString);
      prototype.registerHybridMethod("dispose", &HybridObject::dispose);
      prototype.registerHybridMethod("equals", &HybridObject::equals);
    });
  }

  template <typename TDerived, typename TRegistrar>
  void registerHybrids(TDerived* /*instance*/, TRegistrar&& registrar) {
    registrar(prototype_);
  }

  void ensureInitialized() {
    std::call_once(initFlag_, [this]() { loadHybridMethods(); });
  }

  std::string name_;
  Prototype prototype_;
  std::once_flag initFlag_;
};

template <typename THybrid>
struct JSIConverter<
    std::shared_ptr<THybrid>,
    std::enable_if_t<std::is_base_of_v<HybridObject, THybrid>>> {
  static std::shared_ptr<THybrid> fromJSI(facebook::jsi::Runtime& rt,
                                          const facebook::jsi::Value& value) {
    if (!value.isObject()) {
      throw facebook::jsi::JSError(rt, "Expected a HybridObject instance");
    }
    facebook::jsi::Object obj = value.getObject(rt);
    if (obj.isHostObject(rt)) {
      auto derived = std::dynamic_pointer_cast<THybrid>(obj.getHostObject(rt));
      if (derived) {
        return derived;
      }
    }
    if (obj.hasNativeState(rt)) {
      auto derived = std::dynamic_pointer_cast<THybrid>(obj.getNativeState(rt));
      if (derived) {
        return derived;
      }
    }
    throw facebook::jsi::JSError(rt, "Object is not of expected HybridObject type");
  }

  static facebook::jsi::Value toJSI(facebook::jsi::Runtime& rt,
                                    const std::shared_ptr<THybrid>& value) {
    if (!value) {
      return facebook::jsi::Value::null();
    }
    return value->toObject(rt);
  }
};

}  // namespace nsjsi
