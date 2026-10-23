#pragma once

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include <JSIShim/HybridObjectRegistry.hpp>
#include "specs/HybridDeviceSecureEnclaveSpec.hpp"

extern "C" {
void nitro_swift_hkdf_sha256(const uint8_t* secretPtr, intptr_t secretLen,
                             const uint8_t* saltPtr, intptr_t saltLen,
                             const uint8_t* infoPtr, intptr_t infoLen,
                             char* outHexPtr);
int32_t nitro_swift_aes_gcm_seal(const uint8_t* plaintextPtr,
                                 intptr_t plaintextLen,
                                 const uint8_t* secretPtr, intptr_t secretLen,
                                 char* outHexPtr, intptr_t maxHexCapacity);
void nitro_swift_fill_entropy(uint8_t* bufferPtr, intptr_t byteLength);
}

namespace nsjsi::nsnitro {

class HybridDeviceSecureEnclave final : public HybridDeviceSecureEnclaveSpec {
 public:
  HybridDeviceSecureEnclave() : HybridDeviceSecureEnclaveSpec() {}
  ~HybridDeviceSecureEnclave() override = default;

  size_t getExternalMemorySize() noexcept override { return 4096; }

  std::string getEnclaveArchitecture() override {
#if defined(__aarch64__) || defined(__arm64__)
    return "Apple Silicon ARM64 · Swift 6 CryptoKit (HKDF + AES-GCM)";
#else
    return "x86_64 · Swift 6 CryptoKit (HKDF + AES-GCM)";
#endif
  }

  double getHardwareConcurrency() override {
    unsigned int threads = std::thread::hardware_concurrency();
    return static_cast<double>(threads > 0 ? threads : 4);
  }

  double getOperationsExecuted() override {
    return static_cast<double>(
        opsExecuted_.load(std::memory_order_relaxed));
  }

  std::string deriveHkdfKeyHex(const std::string& secret,
                               const std::string& salt,
                               const std::string& info) override {
    char outHex[65];
    nitro_swift_hkdf_sha256(
        reinterpret_cast<const uint8_t*>(secret.data()),
        static_cast<intptr_t>(secret.size()),
        reinterpret_cast<const uint8_t*>(salt.data()),
        static_cast<intptr_t>(salt.size()),
        reinterpret_cast<const uint8_t*>(info.data()),
        static_cast<intptr_t>(info.size()), outHex);
    opsExecuted_.fetch_add(1, std::memory_order_relaxed);
    return std::string(outHex, 64);
  }

  std::string sealAesGcmPayload(const std::string& plaintext,
                                const std::string& secret) override {
    size_t maxHexLen = (plaintext.size() + 64) * 2 + 1;
    std::vector<char> outHex(maxHexLen, 0);
    int32_t sealedBytes = nitro_swift_aes_gcm_seal(
        reinterpret_cast<const uint8_t*>(plaintext.data()),
        static_cast<intptr_t>(plaintext.size()),
        reinterpret_cast<const uint8_t*>(secret.data()),
        static_cast<intptr_t>(secret.size()), outHex.data(),
        static_cast<intptr_t>(maxHexLen));
    opsExecuted_.fetch_add(1, std::memory_order_relaxed);
    if (sealedBytes <= 0) {
      return "";
    }
    return std::string(outHex.data(), static_cast<size_t>(sealedBytes * 2));
  }

  std::shared_ptr<nsjsi::ArrayBuffer> generateEntropyBuffer(
      double byteLength) override {
    size_t clampedBytes =
        std::clamp(static_cast<size_t>(byteLength), size_t{16}, size_t{1048576});
    auto buffer = nsjsi::ArrayBuffer::allocate(clampedBytes);
    nitro_swift_fill_entropy(buffer->data(),
                             static_cast<intptr_t>(buffer->size()));
    opsExecuted_.fetch_add(1, std::memory_order_relaxed);
    return buffer;
  }

  std::shared_ptr<nsjsi::Promise<std::string>> deriveKeyRoundsAsync(
      const std::string& secret, double rounds) override {
    int totalRounds = std::clamp(static_cast<int>(rounds), 1, 50000);
    auto self = std::dynamic_pointer_cast<HybridDeviceSecureEnclave>(
        shared_from_this());
    return nsjsi::Promise<std::string>::async(
        [self, secret, totalRounds]() -> std::string {
          std::string current = secret;
          const std::string salt = "ns-nitro-hkdf-salt";
          const std::string info = "margelo.nitro.nativescript.v8";
          char outHex[65];
          for (int i = 0; i < totalRounds; ++i) {
            nitro_swift_hkdf_sha256(
                reinterpret_cast<const uint8_t*>(current.data()),
                static_cast<intptr_t>(current.size()),
                reinterpret_cast<const uint8_t*>(salt.data()),
                static_cast<intptr_t>(salt.size()),
                reinterpret_cast<const uint8_t*>(info.data()),
                static_cast<intptr_t>(info.size()), outHex);
            current.assign(outHex, 64);
          }
          self->opsExecuted_.fetch_add(totalRounds, std::memory_order_relaxed);
          return current;
        });
  }

  static void registerInRegistry() {
    nsjsi::HybridObjectRegistry::registerHybridObjectConstructor(
        HybridDeviceSecureEnclaveSpec::TAG,
        []() -> std::shared_ptr<nsjsi::HybridObject> {
          return std::make_shared<HybridDeviceSecureEnclave>();
        });
  }

 private:
  std::atomic<int64_t> opsExecuted_{0};
};

}  // namespace nsjsi::nsnitro
