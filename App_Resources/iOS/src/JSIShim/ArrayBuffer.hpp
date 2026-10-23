#pragma once

#include <cstdint>
#include <cstring>
#include <functional>
#include <memory>
#include <stdexcept>

#include "jsi/jsi.h"
#include "runtime/Runtime.h"
#include "v8.h"

namespace nsjsi {

class NativeMutableBuffer final : public facebook::jsi::MutableBuffer {
 public:
  NativeMutableBuffer(uint8_t* data, size_t size,
                      std::function<void()>&& deleteFunc)
      : data_(data), size_(size), deleteFunc_(std::move(deleteFunc)) {}

  explicit NativeMutableBuffer(size_t size)
      : data_(new uint8_t[size]),
        size_(size),
        deleteFunc_([ ptr = data_ ]() { delete[] ptr; }) {
    std::memset(data_, 0, size_);
  }

  ~NativeMutableBuffer() override {
    if (deleteFunc_) {
      deleteFunc_();
    }
  }

  size_t size() const override { return size_; }
  uint8_t* data() override { return data_; }

 private:
  uint8_t* data_;
  size_t size_;
  std::function<void()> deleteFunc_;
};

class ArrayBuffer final {
 public:
  ArrayBuffer(std::shared_ptr<facebook::jsi::MutableBuffer> mutableBuffer,
              bool isOwner)
      : mutableBuffer_(std::move(mutableBuffer)),
        data_(mutableBuffer_ ? mutableBuffer_->data() : nullptr),
        size_(mutableBuffer_ ? mutableBuffer_->size() : 0),
        isOwner_(isOwner) {}

  ArrayBuffer(uint8_t* data, size_t size)
      : mutableBuffer_(nullptr), data_(data), size_(size), isOwner_(false) {}

  static std::shared_ptr<ArrayBuffer> allocate(size_t size) {
    auto buf = std::make_shared<NativeMutableBuffer>(size);
    return std::make_shared<ArrayBuffer>(std::move(buf), true);
  }

  static std::shared_ptr<ArrayBuffer> wrap(
      uint8_t* data, size_t size, std::function<void()>&& deleteFunc) {
    auto buf = std::make_shared<NativeMutableBuffer>(
        data, size, std::move(deleteFunc));
    return std::make_shared<ArrayBuffer>(std::move(buf), true);
  }

  static std::shared_ptr<ArrayBuffer> fromJSI(
      facebook::jsi::Runtime& rt, const facebook::jsi::Value& value) {
    if (!value.isObject()) {
      throw facebook::jsi::JSError(rt, "Expected an ArrayBuffer or TypedArray");
    }
    facebook::jsi::Object obj = value.getObject(rt);
    if (obj.isArrayBuffer(rt)) {
      facebook::jsi::ArrayBuffer ab = std::move(obj).getArrayBuffer(rt);
      return std::make_shared<ArrayBuffer>(ab.data(rt), ab.size(rt));
    }
    if (obj.hasProperty(rt, "buffer")) {
      facebook::jsi::Object inner = obj.getPropertyAsObject(rt, "buffer");
      if (inner.isArrayBuffer(rt)) {
        size_t byteOffset = 0;
        if (obj.hasProperty(rt, "byteOffset")) {
          byteOffset = static_cast<size_t>(
              obj.getProperty(rt, "byteOffset").asNumber());
        }
        size_t byteLength = 0;
        if (obj.hasProperty(rt, "byteLength")) {
          byteLength = static_cast<size_t>(
              obj.getProperty(rt, "byteLength").asNumber());
        }
        facebook::jsi::ArrayBuffer ab = std::move(inner).getArrayBuffer(rt);
        return std::make_shared<ArrayBuffer>(
            ab.data(rt) + byteOffset,
            byteLength > 0 ? byteLength : (ab.size(rt) - byteOffset));
      }
    }
    throw facebook::jsi::JSError(
        rt, "Value is neither an ArrayBuffer nor a TypedArray view");
  }

  facebook::jsi::Value toJSI(facebook::jsi::Runtime& rt) const {
    if (mutableBuffer_) {
      try {
        return facebook::jsi::ArrayBuffer(rt, mutableBuffer_);
      } catch (const std::logic_error&) {
        // Fallback for unpatched @nativescript/ios 9.1.0 builds where
        // V8Runtime::createArrayBuffer throws std::logic_error.
        v8::Isolate* isolate = tns::Runtime::GetCurrentRuntime()->GetIsolate();
        v8::Locker locker(isolate);
        v8::Isolate::Scope isolateScope(isolate);
        v8::HandleScope handleScope(isolate);
        v8::Local<v8::Context> context = isolate->GetCurrentContext();
        v8::Context::Scope contextScope(context);

        auto* holder =
            new std::shared_ptr<facebook::jsi::MutableBuffer>(mutableBuffer_);
        std::unique_ptr<v8::BackingStore> backingStore =
            v8::ArrayBuffer::NewBackingStore(
                mutableBuffer_->data(), mutableBuffer_->size(),
                [](void*, size_t, void* deleterData) {
                  delete static_cast<
                      std::shared_ptr<facebook::jsi::MutableBuffer>*>(
                      deleterData);
                },
                holder);
        v8::Local<v8::ArrayBuffer> v8Ab =
            v8::ArrayBuffer::New(isolate, std::move(backingStore));
        v8::Local<v8::String> tempKey =
            v8::String::NewFromUtf8Literal(isolate, "__nitroTmpAb");
        context->Global()->Set(context, tempKey, v8Ab).Check();
        facebook::jsi::Value val =
            rt.global().getProperty(rt, "__nitroTmpAb");
        context->Global()->Delete(context, tempKey).Check();
        return val;
      }
    }
    throw facebook::jsi::JSError(
        rt, "Cannot convert non-owning ArrayBuffer view back to JSI");
  }

  uint8_t* data() const noexcept { return data_; }
  size_t size() const noexcept { return size_; }
  bool isOwner() const noexcept { return isOwner_; }

 private:
  std::shared_ptr<facebook::jsi::MutableBuffer> mutableBuffer_;
  uint8_t* data_;
  size_t size_;
  bool isOwner_;
};

}  // namespace nsjsi
