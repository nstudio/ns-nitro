#include "HybridQuattroEngine.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <stdexcept>

namespace margelo::nitro::nsnitro {

namespace {

constexpr double kFlybyDuration = 2.15;
constexpr double kTwoPi = 2.0 * M_PI;
// The right channel is a 14 ms canyon slapback of the left, for a wide stage image.
constexpr double kSlapbackSeconds = 0.014;

struct Envelope {
  double rpm;
  double throttle;
  double flutter;
  double doppler;
};

// 0.00-0.42s 2nd gear pull up the hill, 0.42-0.48s upshift, 0.48-1.05s 3rd gear crest jump with a
// rev-limiter bounce, 1.05-1.32s liftoff wastegate flutter, then the Doppler pass-by.
Envelope envelopeAt(double t) {
  Envelope e{4200.0, 1.0, 0.0, 1.0};
  if (t < 0.42) {
    e.rpm = 4200.0 + 3600.0 * std::pow(t / 0.42, 0.85);
    e.throttle = 0.95;
  } else if (t < 0.48) {
    e.rpm = 6200.0;
    e.throttle = 0.25;
    e.flutter = std::sin((t - 0.42) * kTwoPi * 38.0) * 0.7;
  } else if (t < 1.05) {
    double p = (t - 0.48) / 0.57;
    e.rpm = 5600.0 + 2800.0 * std::pow(p, 0.8);
    if (t > 0.88) {
      e.rpm += std::sin(t * kTwoPi * 28.0) * 260.0;
    }
  } else if (t < 1.32) {
    double p = (t - 1.05) / 0.27;
    e.rpm = 8100.0 - 1500.0 * p;
    e.throttle = 0.35;
    double flutterFreq = 26.0 - p * 8.0;
    e.flutter = std::max(0.0, std::sin((t - 1.05) * kTwoPi * flutterFreq)) * (1.0 - p * 0.45);
  } else {
    double p = (t - 1.32) / (kFlybyDuration - 1.32);
    e.rpm = 6800.0 - 2300.0 * std::pow(p, 0.7);
    e.throttle = 0.8 * (1.0 - p * 0.5);
  }
  e.doppler = 1.0 - 0.16 * std::tanh((t - 0.98) * 3.2);
  return e;
}

// xorshift32, so a seed always reproduces the same gravel and backfire noise.
struct Noise {
  uint32_t state;
  explicit Noise(double seed) : state(static_cast<uint32_t>(seed) * 2654435761u | 1u) {}
  double next() {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return static_cast<double>(state) / 4294967295.0;
  }
};

std::vector<float> synthesizeMono(double sampleRate, double seed) {
  const size_t totalSamples = static_cast<size_t>(sampleRate * kFlybyDuration);
  std::vector<float> samples(totalSamples);
  Noise noise(seed);

  double phase1 = 0, phase2 = 0, phaseHalf = 0, phaseTurbo = 0;
  double noiseFilter = 0, gravelFilter = 0;

  for (size_t i = 0; i < totalSamples; i++) {
    const double t = static_cast<double>(i) / sampleRate;
    const double norm = t / kFlybyDuration;
    const Envelope e = envelopeAt(t);

    // An inline-5 fires 2.5 times per revolution; the 0.4x half-order gives it the off-beat growl.
    const double f0 = (e.rpm / 60.0) * 2.5 * e.doppler;
    phase1 += kTwoPi * f0 / sampleRate;
    phase2 += kTwoPi * f0 * 2.0 / sampleRate;
    phaseHalf += kTwoPi * f0 * 0.4 / sampleRate;

    const double rawEngine = 0.52 * std::sin(phase1) + 0.28 * std::sin(phase2 + 0.4) +
                             0.24 * std::sin(phase1 * 1.5 + std::sin(phaseHalf)) + 0.18 * std::sin(phaseHalf);
    const double bark = std::tanh(rawEngine * (2.2 + e.throttle * 1.6));

    const double turboFreq = (2400.0 + (e.rpm - 4000.0) * 0.68) * e.doppler;
    phaseTurbo += kTwoPi * turboFreq / sampleRate;
    const double turboWhistle = std::sin(phaseTurbo) * (0.09 * e.throttle + 0.16 * e.flutter);

    const double white = noise.next() * 2.0 - 1.0;
    noiseFilter = 0.78 * noiseFilter + 0.22 * white;
    gravelFilter = 0.92 * gravelFilter + 0.08 * white;
    const double wastegate = noiseFilter * e.flutter * 0.55;
    const double gravelEnv =
        0.35 * std::exp(-std::pow((t - 0.35) / 0.28, 2.0)) + 0.45 * std::exp(-std::pow((t - 1.38) / 0.32, 2.0));
    const double gravel = gravelFilter * gravelEnv;

    double pop = 0;
    if (t > 1.06 && t < 1.30 && noise.next() < 0.008) {
      pop = (noise.next() * 2.0 - 1.0) * 0.85;
    }

    const double attack = std::min(1.0, t / 0.08);
    const double passByPeak = 0.55 + 0.45 * std::exp(-std::pow((t - 0.92) / 0.55, 2.0));
    const double fadeOut = norm < 0.82 ? 1.0 : std::max(0.0, (1.0 - norm) / 0.18);
    const double mix =
        (bark * (0.55 + 0.25 * e.throttle) + turboWhistle + wastegate + gravel + pop) * attack * passByPeak * fadeOut;
    samples[i] = static_cast<float>(std::clamp(mix, -0.98, 0.98));
  }
  return samples;
}

float channelSample(const std::vector<float>& mono, size_t i, size_t delay, int channel) {
  const float dry = mono[i];
  const float slap = i >= delay ? mono[i - delay] * 0.24f : 0.0f;
  const float mixed = channel == 0 ? dry + slap * 0.5f : dry * 0.92f + slap;
  return std::clamp(mixed, -0.98f, 0.98f);
}

} // namespace

HybridQuattroEngine::HybridQuattroEngine(double sampleRate) : HybridObject(), sampleRate_(sampleRate) {
  if (!(sampleRate >= 8000.0 && sampleRate <= 192000.0)) {
    throw std::invalid_argument("QuattroEngine: sampleRate must be between 8000 and 192000 Hz.");
  }
}

std::vector<double> HybridQuattroEngine::getFiringOrder() {
  return {1, 2, 4, 5, 3};
}

double HybridQuattroEngine::getCylinders() {
  return 5;
}

double HybridQuattroEngine::getSampleRate() {
  return sampleRate_;
}

double HybridQuattroEngine::getFlybyDuration() {
  return kFlybyDuration;
}

Promise<ArrayBuffer> HybridQuattroEngine::synthesizeFlyby(double seed) {
  const double sampleRate = sampleRate_;
  return Promise<ArrayBuffer>::async([sampleRate, seed]() {
    const std::vector<float> mono = synthesizeMono(sampleRate, seed);
    const size_t delay = static_cast<size_t>(sampleRate * kSlapbackSeconds);
    ArrayBuffer stereo = ArrayBuffer::allocate(mono.size() * 2 * sizeof(float));
    float* out = reinterpret_cast<float*>(stereo.data());
    for (size_t i = 0; i < mono.size(); i++) {
      out[i * 2] = channelSample(mono, i, delay, 0);
      out[i * 2 + 1] = channelSample(mono, i, delay, 1);
    }
    return stereo;
  });
}

double HybridQuattroEngine::renderInto(const ArrayBuffer& output, double seed, double channel, double stride) {
  const int channelIndex = static_cast<int>(channel);
  const size_t step = static_cast<size_t>(stride);
  if ((channelIndex != 0 && channelIndex != 1) || step < 1) {
    throw std::invalid_argument("QuattroEngine.renderInto: channel must be 0 or 1, and stride at least 1.");
  }
  float* out = reinterpret_cast<float*>(output.data());
  const size_t floatCount = output.size() / sizeof(float);
  if (out == nullptr || floatCount <= static_cast<size_t>(channelIndex)) {
    return 0;
  }

  const std::vector<float> mono = synthesizeMono(sampleRate_, seed);
  const size_t delay = static_cast<size_t>(sampleRate_ * kSlapbackSeconds);
  const size_t frames = std::min(mono.size(), (floatCount - channelIndex - 1) / step + 1);
  for (size_t i = 0; i < frames; i++) {
    out[i * step + channelIndex] = channelSample(mono, i, delay, channelIndex);
  }
  return static_cast<double>(frames);
}

EngineTelemetry HybridQuattroEngine::telemetryAt(double seconds) {
  const Envelope e = envelopeAt(std::clamp(seconds, 0.0, kFlybyDuration));
  const double spool = std::clamp((e.rpm - 3500.0) / 4500.0, 0.0, 1.0);
  const double boostBar = 0.2 + 1.9 * e.throttle * spool + 0.25 * std::abs(e.flutter);
  return EngineTelemetry(e.rpm, boostBar, e.throttle, e.flutter, e.doppler);
}

} // namespace margelo::nitro::nsnitro
