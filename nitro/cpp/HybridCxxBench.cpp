#include "HybridCxxBench.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

namespace margelo::nitro::nsnitro {

HybridCxxBench::HybridCxxBench(const std::string& tag) : HybridObject(), tag_(tag) {}

double HybridCxxBench::addStatic(double a, double b) {
  return a + b;
}

std::string HybridCxxBench::getTag() {
  return tag_;
}

double HybridCxxBench::add(double a, double b) {
  return a + b;
}

std::string HybridCxxBench::formatRecord(const std::string& label, double score, double index) {
  char buffer[256];
  int length = std::snprintf(buffer, sizeof(buffer), "[Nitro#%d] %s => %d", static_cast<int>(index), label.c_str(),
                             static_cast<int>(score * 100.0));
  return std::string(buffer, static_cast<size_t>(std::max(0, std::min(length, static_cast<int>(sizeof(buffer)) - 1))));
}

// Same soft clip + one-pole low-pass as ns_direct_c_dsp, so every lane does identical work.
DspResult HybridCxxBench::processDsp(const ArrayBuffer& samples, double gain, double drive) {
  float* data = reinterpret_cast<float*>(samples.data());
  const size_t count = samples.size() / sizeof(float);
  if (data == nullptr || count == 0) {
    return DspResult(0, 0);
  }

  const float g = static_cast<float>(gain);
  const float d = static_cast<float>(drive);
  const float alpha = 0.85f;
  float z1 = 0.0f;
  float peak = 0.0f;
  double sumSquares = 0.0;
  for (size_t i = 0; i < count; i++) {
    const float x = data[i] * g * d;
    const float x2 = x * x;
    const float saturated = x * (27.0f + x2) / (27.0f + 9.0f * x2);
    const float filtered = (1.0f - alpha) * saturated + alpha * z1;
    z1 = filtered;
    data[i] = filtered;
    peak = std::max(peak, std::fabs(filtered));
    sumSquares += static_cast<double>(filtered) * filtered;
  }
  return DspResult(peak, std::sqrt(sumSquares / static_cast<double>(count)));
}

} // namespace margelo::nitro::nsnitro
