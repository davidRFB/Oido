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
