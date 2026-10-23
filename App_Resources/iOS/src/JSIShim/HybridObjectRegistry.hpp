#pragma once

#include <functional>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include <NitroModules/HybridObject.hpp>

namespace margelo::nitro {

class HybridObjectRegistry final {
 public:
  using ConstructorFn = std::function<std::shared_ptr<HybridObject>()>;

  static void registerHybridObjectConstructor(
      const std::string& hybridObjectName, ConstructorFn&& constructorFn) {
    std::lock_guard<std::mutex> lock(mutex());
    constructors()[hybridObjectName] = std::move(constructorFn);
  }

  static bool hasHybridObject(const std::string& hybridObjectName) {
    std::lock_guard<std::mutex> lock(mutex());
    return constructors().find(hybridObjectName) != constructors().end();
  }

  static std::shared_ptr<HybridObject> createHybridObject(
      const std::string& hybridObjectName) {
    ConstructorFn fn;
    {
      std::lock_guard<std::mutex> lock(mutex());
      auto it = constructors().find(hybridObjectName);
      if (it == constructors().end()) {
        throw std::runtime_error(
            "HybridObject '" + hybridObjectName +
            "' is not registered in HybridObjectRegistry.");
      }
      fn = it->second;
    }
    return fn();
  }

  static std::vector<std::string> getAllRegisteredHybridObjectNames() {
    std::lock_guard<std::mutex> lock(mutex());
    std::vector<std::string> names;
    names.reserve(constructors().size());
    for (const auto& [name, _] : constructors()) {
      names.push_back(name);
    }
    return names;
  }

 private:
  static std::unordered_map<std::string, ConstructorFn>& constructors() {
    static std::unordered_map<std::string, ConstructorFn> s_map;
    return s_map;
  }

  static std::mutex& mutex() {
    static std::mutex s_mutex;
    return s_mutex;
  }
};

}  // namespace margelo::nitro
