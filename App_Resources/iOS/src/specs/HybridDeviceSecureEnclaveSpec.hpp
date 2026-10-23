#pragma once

#include <memory>
#include <string>

#include <JSIShim/ArrayBuffer.hpp>
#include <JSIShim/HybridObject.hpp>
#include <JSIShim/Promise.hpp>

namespace nsjsi::nsnitro {

class HybridDeviceSecureEnclaveSpec : public virtual nsjsi::HybridObject {
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
  virtual std::shared_ptr<nsjsi::ArrayBuffer> generateEntropyBuffer(
      double byteLength) = 0;
  virtual std::shared_ptr<nsjsi::Promise<std::string>>
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

}  // namespace nsjsi::nsnitro
