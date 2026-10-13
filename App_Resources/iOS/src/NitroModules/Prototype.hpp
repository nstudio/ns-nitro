#pragma once

#include <functional>
#include <memory>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <utility>
#include <vector>

#include <NitroModules/JSIConverter.hpp>
#include "jsi/jsi.h"

namespace margelo::nitro {

class HybridObject;

class Prototype final {
 public:
  using MethodInvoker = std::function<facebook::jsi::Value(
      facebook::jsi::Runtime&, HybridObject*, const facebook::jsi::Value*,
      size_t)>;
  using GetterInvoker =
      std::function<facebook::jsi::Value(facebook::jsi::Runtime&, HybridObject*)>;
  using SetterInvoker = std::function<void(
      facebook::jsi::Runtime&, HybridObject*, const facebook::jsi::Value&)>;

  struct MethodEntry {
    size_t paramCount;
    MethodInvoker invoker;
  };

  template <typename TDerived, typename TReturn, typename... TArgs>
  void registerHybridMethod(const std::string& name,
                            TReturn (TDerived::*method)(TArgs...)) {
    methods_[name] = MethodEntry{
        sizeof...(TArgs),
        [method, name](facebook::jsi::Runtime& rt, HybridObject* basePtr,
                       const facebook::jsi::Value* args,
                       size_t count) -> facebook::jsi::Value {
          if (count < sizeof...(TArgs)) {
            throw facebook::jsi::JSError(
                rt, "Method '" + name + "' expected " +
                        std::to_string(sizeof...(TArgs)) + " arguments, got " +
                        std::to_string(count));
          }
          auto* instance = dynamic_cast<TDerived*>(basePtr);
          if (!instance) {
            throw facebook::jsi::JSError(
                rt, "Invalid HybridObject receiver for '" + name + "'");
          }
          return invokeMember(rt, instance, method, args,
                              std::index_sequence_for<TArgs...>{});
        }};
  }

  template <typename TDerived, typename TReturn, typename... TArgs>
  void registerHybridMethod(const std::string& name,
                            TReturn (TDerived::*method)(TArgs...) const) {
    methods_[name] = MethodEntry{
        sizeof...(TArgs),
        [method, name](facebook::jsi::Runtime& rt, HybridObject* basePtr,
                       const facebook::jsi::Value* args,
                       size_t count) -> facebook::jsi::Value {
          if (count < sizeof...(TArgs)) {
            throw facebook::jsi::JSError(
                rt, "Method '" + name + "' expected " +
                        std::to_string(sizeof...(TArgs)) + " arguments, got " +
                        std::to_string(count));
          }
          const auto* instance = dynamic_cast<const TDerived*>(basePtr);
          if (!instance) {
            throw facebook::jsi::JSError(
                rt, "Invalid HybridObject receiver for '" + name + "'");
          }
          return invokeConstMember(rt, instance, method, args,
                                   std::index_sequence_for<TArgs...>{});
        }};
  }

  template <typename TDerived>
  void registerRawHybridMethod(
      const std::string& name, size_t paramCount,
      std::function<facebook::jsi::Value(facebook::jsi::Runtime&, TDerived*,
                                         const facebook::jsi::Value*, size_t)>&&
          fn) {
    methods_[name] = MethodEntry{
        paramCount,
        [fn = std::move(fn), name](facebook::jsi::Runtime& rt,
                                   HybridObject* basePtr,
                                   const facebook::jsi::Value* args,
                                   size_t count) -> facebook::jsi::Value {
          auto* instance = dynamic_cast<TDerived*>(basePtr);
          if (!instance) {
            throw facebook::jsi::JSError(
                rt, "Invalid HybridObject receiver for '" + name + "'");
          }
          return fn(rt, instance, args, count);
        }};
  }

  template <typename TDerived, typename TValue>
  void registerHybridGetter(const std::string& name,
                            TValue (TDerived::*getter)()) {
    getters_[name] = [getter, name](facebook::jsi::Runtime& rt,
                                    HybridObject* basePtr) {
      auto* instance = dynamic_cast<TDerived*>(basePtr);
      if (!instance) {
        throw facebook::jsi::JSError(
            rt, "Invalid HybridObject receiver for getter '" + name + "'");
      }
      using CleanT = std::decay_t<TValue>;
      return JSIConverter<CleanT>::toJSI(rt, (instance->*getter)());
    };
  }

  template <typename TDerived, typename TValue>
  void registerHybridGetter(const std::string& name,
                            TValue (TDerived::*getter)() const) {
    getters_[name] = [getter, name](facebook::jsi::Runtime& rt,
                                    HybridObject* basePtr) {
      const auto* instance = dynamic_cast<const TDerived*>(basePtr);
      if (!instance) {
        throw facebook::jsi::JSError(
            rt, "Invalid HybridObject receiver for getter '" + name + "'");
      }
      using CleanT = std::decay_t<TValue>;
      return JSIConverter<CleanT>::toJSI(rt, (instance->*getter)());
    };
  }

  template <typename TDerived, typename TValue>
  void registerHybridSetter(const std::string& name,
                            void (TDerived::*setter)(TValue)) {
    setters_[name] = [setter, name](facebook::jsi::Runtime& rt,
                                    HybridObject* basePtr,
                                    const facebook::jsi::Value& value) {
      auto* instance = dynamic_cast<TDerived*>(basePtr);
      if (!instance) {
        throw facebook::jsi::JSError(
            rt, "Invalid HybridObject receiver for setter '" + name + "'");
      }
      using CleanT = std::decay_t<TValue>;
      (instance->*setter)(JSIConverter<CleanT>::fromJSI(rt, value));
    };
  }

  const std::unordered_map<std::string, MethodEntry>& getMethods() const {
    return methods_;
  }
  const std::unordered_map<std::string, GetterInvoker>& getGetters() const {
    return getters_;
  }
  const std::unordered_map<std::string, SetterInvoker>& getSetters() const {
    return setters_;
  }

 private:
  template <typename TDerived, typename TReturn, typename... TArgs, size_t... Is>
  static facebook::jsi::Value invokeMember(
      facebook::jsi::Runtime& rt, TDerived* instance,
      TReturn (TDerived::*method)(TArgs...), const facebook::jsi::Value* args,
      std::index_sequence<Is...>) {
    if constexpr (std::is_void_v<TReturn>) {
      (instance->*method)(
          JSIConverter<std::decay_t<TArgs>>::fromJSI(rt, args[Is])...);
      return facebook::jsi::Value::undefined();
    } else {
      using CleanRet = std::decay_t<TReturn>;
      return JSIConverter<CleanRet>::toJSI(
          rt, (instance->*method)(
                  JSIConverter<std::decay_t<TArgs>>::fromJSI(rt, args[Is])...));
    }
  }

  template <typename TDerived, typename TReturn, typename... TArgs, size_t... Is>
  static facebook::jsi::Value invokeConstMember(
      facebook::jsi::Runtime& rt, const TDerived* instance,
      TReturn (TDerived::*method)(TArgs...) const,
      const facebook::jsi::Value* args, std::index_sequence<Is...>) {
    if constexpr (std::is_void_v<TReturn>) {
      (instance->*method)(
          JSIConverter<std::decay_t<TArgs>>::fromJSI(rt, args[Is])...);
      return facebook::jsi::Value::undefined();
    } else {
      using CleanRet = std::decay_t<TReturn>;
      return JSIConverter<CleanRet>::toJSI(
          rt, (instance->*method)(
                  JSIConverter<std::decay_t<TArgs>>::fromJSI(rt, args[Is])...));
    }
  }

  std::unordered_map<std::string, MethodEntry> methods_;
  std::unordered_map<std::string, GetterInvoker> getters_;
  std::unordered_map<std::string, SetterInvoker> setters_;
};

}  // namespace margelo::nitro
