import { describe, it, expect, beforeEach } from "vitest";
import {
  autocorrelateF0,
  medianInWindow,
  inPitchBand,
  getRecentPitchStats,
  getRecentPitchSamples,
  _pushPitchForTest,
  _resetForTest,
} from "../js/pitch.js";

function sine(buf, freqHz, sampleRate, amplitude = 0.5) {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = amplitude * Math.sin(2 * Math.PI * freqHz * i / sampleRate);
  }
}

// Mulberry32 PRNG so noise-bearing tests are reproducible.
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("autocorrelateF0", () => {
  it("returns null for null/empty buffers", () => {
    expect(autocorrelateF0(null, 48000, 70, 500)).toBeNull();
    expect(autocorrelateF0(new Float32Array(0), 48000, 70, 500)).toBeNull();
    expect(autocorrelateF0(new Float32Array(32), 48000, 70, 500)).toBeNull();
  });

  it("returns null for silent buffers", () => {
    const buf = new Float32Array(4096);
    expect(autocorrelateF0(buf, 48000, 70, 500)).toBeNull();
  });

  it("recovers a 200 Hz sine at 48 kHz within 2 Hz", () => {
    const buf = new Float32Array(4096);
    sine(buf, 200, 48000);
    const f0 = autocorrelateF0(buf, 48000, 70, 500);
    expect(f0).not.toBeNull();
    expect(Math.abs(f0 - 200)).toBeLessThan(2);
  });

  it("recovers a 120 Hz sine (typical adult male) within 2 Hz", () => {
    const buf = new Float32Array(4096);
    sine(buf, 120, 48000);
    const f0 = autocorrelateF0(buf, 48000, 70, 500);
    expect(f0).not.toBeNull();
    expect(Math.abs(f0 - 120)).toBeLessThan(2);
  });

  it("recovers a 250 Hz sine (typical adult female / kid) within 2 Hz", () => {
    const buf = new Float32Array(4096);
    sine(buf, 250, 48000);
    const f0 = autocorrelateF0(buf, 48000, 70, 500);
    expect(f0).not.toBeNull();
    expect(Math.abs(f0 - 250)).toBeLessThan(2);
  });

  it("works at a 44.1 kHz sample rate too", () => {
    const buf = new Float32Array(4096);
    sine(buf, 180, 44100);
    const f0 = autocorrelateF0(buf, 44100, 70, 500);
    expect(f0).not.toBeNull();
    expect(Math.abs(f0 - 180)).toBeLessThan(2);
  });

  it("locks onto the fundamental, not a harmonic, even with added noise (lag-bias regression)", () => {
    // Real speech has a fundamental + harmonics + noise. Without per-pair
    // normalization, autocorrelation prefers the smallest tau in the search
    // range and locks onto the high end (manifested as 500 Hz on real audio).
    const buf = new Float32Array(4096);
    const r = rng(42);
    for (let i = 0; i < buf.length; i++) {
      const t = i / 48000;
      buf[i] =
        0.5 * Math.sin(2 * Math.PI * 130 * t) +   // fundamental
        0.3 * Math.sin(2 * Math.PI * 260 * t) +   // 2nd harmonic
        0.2 * Math.sin(2 * Math.PI * 390 * t) +   // 3rd harmonic
        0.05 * (r() * 2 - 1);                     // noise
    }
    const f0 = autocorrelateF0(buf, 48000, 70, 500);
    expect(f0).not.toBeNull();
    expect(Math.abs(f0 - 130)).toBeLessThan(3);
  });

  it("does not pick a sub-octave when integer-period peaks are tied (octave-error regression)", () => {
    // 250 Hz at 48 kHz lands on integer period (192 samples). Peaks at
    // 192, 384, 576 are all theoretically tied at +1, and float rounding
    // slightly favors the larger τ — without the lowest-octave-bias fix
    // the detector reports ~167 Hz (sub-octave) instead of 250 Hz.
    const buf = new Float32Array(4096);
    sine(buf, 250, 48000);
    const f0 = autocorrelateF0(buf, 48000, 70, 500);
    expect(f0).not.toBeNull();
    expect(Math.abs(f0 - 250)).toBeLessThan(2);
  });

  it("returns null for low-energy buffers below the voicing threshold", () => {
    // Quiet noise should not be reported as voiced — it pollutes the median.
    const buf = new Float32Array(4096);
    const r = rng(1);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.005 * (r() * 2 - 1);
    expect(autocorrelateF0(buf, 48000, 70, 500)).toBeNull();
  });
});

describe("medianInWindow", () => {
  it("returns null on empty array", () => {
    expect(medianInWindow([], 1000, 500)).toBeNull();
  });

  it("returns null when nothing is in window", () => {
    expect(medianInWindow([{ t: 100, hz: 200 }], 1000, 500)).toBeNull();
  });

  it("returns the only sample when one is in window", () => {
    expect(medianInWindow([{ t: 800, hz: 200 }], 1000, 500)).toBe(200);
  });

  it("ignores samples older than nowMs - windowMs", () => {
    const samples = [
      { t: 100, hz: 999 }, // out of window
      { t: 600, hz: 110 },
      { t: 800, hz: 130 },
      { t: 900, hz: 120 },
    ];
    expect(medianInWindow(samples, 1000, 500)).toBe(120);
  });

  it("averages the two middles when count is even", () => {
    const samples = [
      { t: 600, hz: 100 },
      { t: 700, hz: 200 },
      { t: 800, hz: 300 },
      { t: 900, hz: 400 },
    ];
    expect(medianInWindow(samples, 1000, 500)).toBe(250);
  });

  it("skips samples whose hz is null", () => {
    const samples = [
      { t: 600, hz: null },
      { t: 700, hz: 200 },
    ];
    expect(medianInWindow(samples, 1000, 500)).toBe(200);
  });
});

describe("inPitchBand", () => {
  const profile = { f0_mean: 200, f0_stddev: 20, f0_samples: 30 };

  it("default-allows when voiceprint is missing", () => {
    expect(inPitchBand(180, null, 2.5)).toBe(true);
    expect(inPitchBand(180, undefined, 2.5)).toBe(true);
    expect(inPitchBand(180, { f0_mean: "x" }, 2.5)).toBe(true);
  });

  it("default-allows when median is null/undefined/non-finite", () => {
    expect(inPitchBand(null, profile, 2.5)).toBe(true);
    expect(inPitchBand(undefined, profile, 2.5)).toBe(true);
    expect(inPitchBand(NaN, profile, 2.5)).toBe(true);
  });

  it("accepts medians inside the tolerance band", () => {
    // band half-width = 2.5 * 20 = 50, so [150, 250] is inside.
    expect(inPitchBand(200, profile, 2.5)).toBe(true);
    expect(inPitchBand(180, profile, 2.5)).toBe(true);
    expect(inPitchBand(150, profile, 2.5)).toBe(true);
    expect(inPitchBand(250, profile, 2.5)).toBe(true);
  });

  it("rejects medians outside the tolerance band", () => {
    expect(inPitchBand(149, profile, 2.5)).toBe(false);
    expect(inPitchBand(251, profile, 2.5)).toBe(false);
    expect(inPitchBand(120, profile, 2.5)).toBe(false);
  });

  it("floors stddev at minStddev so an over-stable enrollment doesn't make the band absurdly tight", () => {
    const tight = { f0_mean: 200, f0_stddev: 1, f0_samples: 30 };
    // Without flooring: band would be 200 +/- 2.5, rejecting 210. With floor of 8: band 200 +/- 20, accepting 210.
    expect(inPitchBand(210, tight, 2.5, 8)).toBe(true);
  });
});

describe("getRecentPitchStats / getRecentPitchSamples / ring", () => {
  beforeEach(() => {
    _resetForTest();
  });

  it("returns empty stats when nothing has been observed", () => {
    const stats = getRecentPitchStats(1500);
    expect(stats.median).toBeNull();
    expect(stats.n).toBe(0);
    expect(stats.samples).toEqual([]);
  });

  it("aggregates pushed samples into median + count", () => {
    const now = performance.now();
    _pushPitchForTest(now - 100, 100);
    _pushPitchForTest(now - 50, 200);
    _pushPitchForTest(now - 10, 300);
    const stats = getRecentPitchStats(1500);
    expect(stats.n).toBe(3);
    expect(stats.median).toBe(200);
  });

  it("excludes samples older than the requested window", () => {
    const now = performance.now();
    _pushPitchForTest(now - 5000, 999); // outside any reasonable window
    _pushPitchForTest(now - 100, 150);
    _pushPitchForTest(now - 50, 250);
    const stats = getRecentPitchStats(1000);
    expect(stats.n).toBe(2);
    expect(stats.median).toBe(200);
  });

  it("getRecentPitchSamples returns raw values within window", () => {
    const now = performance.now();
    _pushPitchForTest(now - 5000, 999);
    _pushPitchForTest(now - 100, 150);
    _pushPitchForTest(now - 50, 250);
    const values = getRecentPitchSamples(1000);
    expect(values.sort()).toEqual([150, 250]);
  });
});
