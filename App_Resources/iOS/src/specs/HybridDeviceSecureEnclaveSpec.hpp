#pragma once

#include <memory>
#include <string>

#include <NitroModules/ArrayBuffer.hpp>
#include <NitroModules/HybridObject.hpp>
#include <NitroModules/Promise.hpp>

namespace margelo::nitro::nsnitro {

class HybridDeviceSecureEnclaveSpec : public virtual margelo::nitro::HybridObject {
 public:
  static constexpr auto TAG = "DeviceSecureEnclave";

  HybridDeviceSecureEnclaveSpec() : HybridObject(TAG) {}
  ~HybridDeviceSecureEnclaveSpec() override = default;

  // Properties
  virtual std::string getEnclaveArchitecture() = 0;
  virtual double getHardwareConcurrency() = 0;
  virtual double getOperationsExecuted() = 0;

  // Methods
  virtual std::string deriveHkdfKeyHex(const std::string& secret,
                                       const std::string& salt,
                                       const std::string& info) = 0;
  virtual std::string sealAesGcmPayload(const std::string& plaintext,
                                        const std::string& secret) = 0;
  virtual std::shared_ptr<margelo::nitro::ArrayBuffer> generateEntropyBuffer(
      double byteLength) = 0;
  virtual std::shared_ptr<margelo::nitro::Promise<std::string>>
  deriveKeyRoundsAsync(const std::string& secret, double rounds) = 0;

 protected:
  void loadHybridMethods() override {
    HybridObject::loadHybridMethods();
    registerHybrids(this, [](Prototype& prototype) {
      prototype.registerHybridGetter(
          "enclaveArchitecture",
          &HybridDeviceSecureEnclaveSpec::getEnclaveArchitecture);
      prototype.registerHybridGetter(
          "hardwareConcurrency",
          &HybridDeviceSecureEnclaveSpec::getHardwareConcurrency);
      prototype.registerHybridGetter(
          "operationsExecuted",
          &HybridDeviceSecureEnclaveSpec::getOperationsExecuted);
      prototype.registerHybridMethod(
          "deriveHkdfKeyHex",
          &HybridDeviceSecureEnclaveSpec::deriveHkdfKeyHex);
      prototype.registerHybridMethod(
          "sealAesGcmPayload",
          &HybridDeviceSecureEnclaveSpec::sealAesGcmPayload);
      prototype.registerHybridMethod(
          "generateEntropyBuffer",
          &HybridDeviceSecureEnclaveSpec::generateEntropyBuffer);
      prototype.registerHybridMethod(
          "deriveKeyRoundsAsync",
          &HybridDeviceSecureEnclaveSpec::deriveKeyRoundsAsync);
    });
  }
};

}  // namespace margelo::nitro::nsnitro
