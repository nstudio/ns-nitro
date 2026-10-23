#pragma once

#include <NSNitroModules/HybridQuattroEngineSpec.hpp>

#include <vector>

namespace margelo::nitro::nsnitro {

class HybridQuattroEngine final : public HybridQuattroEngineSpec {
 public:
  explicit HybridQuattroEngine(double sampleRate);

  static std::vector<double> getFiringOrder();
  static double getCylinders();

  double getSampleRate() override;
  double getFlybyDuration() override;

  Promise<ArrayBuffer> synthesizeFlyby(double seed) override;
  double renderInto(const ArrayBuffer& output, double seed, double channel, double stride) override;
  EngineTelemetry telemetryAt(double seconds) override;

 private:
  double sampleRate_;
};

} // namespace margelo::nitro::nsnitro
