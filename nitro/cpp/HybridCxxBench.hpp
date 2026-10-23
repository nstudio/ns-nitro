#pragma once

#include <NSNitroModules/HybridCxxBenchSpec.hpp>

#include <string>

namespace margelo::nitro::nsnitro {

class HybridCxxBench final : public HybridCxxBenchSpec {
 public:
  explicit HybridCxxBench(const std::string& tag);

  static double addStatic(double a, double b);

  std::string getTag() override;
  double add(double a, double b) override;
  std::string formatRecord(const std::string& label, double score, double index) override;
  DspResult processDsp(const ArrayBuffer& samples, double gain, double drive) override;

 private:
  std::string tag_;
};

} // namespace margelo::nitro::nsnitro
