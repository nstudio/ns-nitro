#pragma once

#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <vector>

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/Promise.hpp>
#include "jsi/jsi.h"

namespace margelo::nitro {

class HybridObject;

template <typename T, typename Enable = void>
struct JSIConverter;

template <>
struct JSIConverter<double> {
  static double fromJSI(facebook::jsi::Runtime& rt,
                        const facebook::jsi::Value& value) {
    return value.asNumber();
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime&, double value) {
    return facebook::jsi::Value(value);
  }
};

template <>
struct JSIConverter<float> {
  static float fromJSI(facebook::jsi::Runtime& rt,
                       const facebook::jsi::Value& value) {
    return static_cast<float>(value.asNumber());
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime&, float value) {
    return facebook::jsi::Value(static_cast<double>(value));
  }
};

template <>
struct JSIConverter<int32_t> {
  static int32_t fromJSI(facebook::jsi::Runtime& rt,
                         const facebook::jsi::Value& value) {
    return static_cast<int32_t>(value.asNumber());
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime&, int32_t value) {
    return facebook::jsi::Value(static_cast<int>(value));
  }
};

template <>
struct JSIConverter<int64_t> {
  static int64_t fromJSI(facebook::jsi::Runtime& rt,
                         const facebook::jsi::Value& value) {
    return static_cast<int64_t>(value.asNumber());
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime&, int64_t value) {
    return facebook::jsi::Value(static_cast<double>(value));
  }
};

template <>
struct JSIConverter<size_t> {
  static size_t fromJSI(facebook::jsi::Runtime& rt,
                        const facebook::jsi::Value& value) {
    return static_cast<size_t>(value.asNumber());
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime&, size_t value) {
    return facebook::jsi::Value(static_cast<double>(value));
  }
};

template <>
struct JSIConverter<bool> {
  static bool fromJSI(facebook::jsi::Runtime& rt,
                      const facebook::jsi::Value& value) {
    return value.getBool();
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime&, bool value) {
    return facebook::jsi::Value(value);
  }
};

template <>
struct JSIConverter<std::string> {
  static std::string fromJSI(facebook::jsi::Runtime& rt,
                             const facebook::jsi::Value& value) {
    return value.asString(rt).utf8(rt);
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime& rt,
                                    const std::string& value) {
    return facebook::jsi::String::createFromUtf8(rt, value);
  }
};

template <typename T>
struct JSIConverter<std::optional<T>> {
  static std::optional<T> fromJSI(facebook::jsi::Runtime& rt,
                                  const facebook::jsi::Value& value) {
    if (value.isUndefined() || value.isNull()) {
      return std::nullopt;
    }
    return JSIConverter<T>::fromJSI(rt, value);
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime& rt,
                                    const std::optional<T>& value) {
    if (!value.has_value()) {
      return facebook::jsi::Value::undefined();
    }
    return JSIConverter<T>::toJSI(rt, *value);
  }
};

template <typename T>
struct JSIConverter<std::vector<T>> {
  static std::vector<T> fromJSI(facebook::jsi::Runtime& rt,
                                const facebook::jsi::Value& value) {
    facebook::jsi::Array arr = value.asObject(rt).asArray(rt);
    size_t len = arr.size(rt);
    std::vector<T> out;
    out.reserve(len);
    for (size_t i = 0; i < len; ++i) {
      out.push_back(JSIConverter<T>::fromJSI(rt, arr.getValueAtIndex(rt, i)));
    }
    return out;
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime& rt,
                                    const std::vector<T>& vec) {
    facebook::jsi::Array arr(rt, vec.size());
    for (size_t i = 0; i < vec.size(); ++i) {
      arr.setValueAtIndex(rt, i, JSIConverter<T>::toJSI(rt, vec[i]));
    }
    return arr;
  }
};

template <typename V>
struct JSIConverter<std::unordered_map<std::string, V>> {
  static std::unordered_map<std::string, V> fromJSI(
      facebook::jsi::Runtime& rt, const facebook::jsi::Value& value) {
    facebook::jsi::Object obj = value.asObject(rt);
    facebook::jsi::Array names = obj.getPropertyNames(rt);
    size_t len = names.size(rt);
    std::unordered_map<std::string, V> out;
    out.reserve(len);
    for (size_t i = 0; i < len; ++i) {
      facebook::jsi::String key = names.getValueAtIndex(rt, i).asString(rt);
      out.emplace(key.utf8(rt),
                  JSIConverter<V>::fromJSI(rt, obj.getProperty(rt, key)));
    }
    return out;
  }
  static facebook::jsi::Value toJSI(
      facebook::jsi::Runtime& rt,
      const std::unordered_map<std::string, V>& map) {
    facebook::jsi::Object obj(rt);
    for (const auto& [k, v] : map) {
      obj.setProperty(rt, k.c_str(), JSIConverter<V>::toJSI(rt, v));
    }
    return obj;
  }
};

template <>
struct JSIConverter<std::shared_ptr<ArrayBuffer>> {
  static std::shared_ptr<ArrayBuffer> fromJSI(
      facebook::jsi::Runtime& rt, const facebook::jsi::Value& value) {
    return ArrayBuffer::fromJSI(rt, value);
  }
  static facebook::jsi::Value toJSI(facebook::jsi::Runtime& rt,
                                    const std::shared_ptr<ArrayBuffer>& buf) {
    if (!buf) {
      return facebook::jsi::Value::null();
    }
    return buf->toJSI(rt);
  }
};

template <typename TResult>
struct JSIConverter<std::shared_ptr<Promise<TResult>>> {
  static facebook::jsi::Value toJSI(
      facebook::jsi::Runtime& rt,
      const std::shared_ptr<Promise<TResult>>& promise) {
    if (!promise) {
      return facebook::jsi::Value::undefined();
    }
    return promise->toJSI(
        rt, [](facebook::jsi::Runtime& innerRt, const TResult& res) {
          return JSIConverter<TResult>::toJSI(innerRt, res);
        });
  }
};

}  // namespace margelo::nitro
