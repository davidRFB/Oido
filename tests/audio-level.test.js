import { describe, it, expect } from "vitest";
import { maxLevelInWindow, percentileInWindow } from "../js/audio-level.js";

describe("maxLevelInWindow", () => {
  it("returns null on empty array", () => {
    expect(maxLevelInWindow([], 1000, 500)).toBeNull();
  });

  it("returns null when nothing is in window", () => {
    expect(maxLevelInWindow([{ t: 100, rms: 0.5 }], 1000, 500)).toBeNull();
  });

  it("returns the only sample when one is in window", () => {
    expect(maxLevelInWindow([{ t: 800, rms: 0.3 }], 1000, 500)).toBe(0.3);
  });

  it("ignores samples older than nowMs - windowMs", () => {
    const samples = [
      { t: 100, rms: 0.9 },  // out
      { t: 600, rms: 0.2 },  // in (cutoff = 1000-500 = 500)
      { t: 900, rms: 0.4 },  // in
    ];
    expect(maxLevelInWindow(samples, 1000, 500)).toBe(0.4);
  });

  it("returns the max rms within the window", () => {
    const samples = [
      { t: 600, rms: 0.1 },
      { t: 700, rms: 0.7 },
      { t: 800, rms: 0.3 },
      { t: 900, rms: 0.5 },
    ];
    expect(maxLevelInWindow(samples, 1000, 500)).toBe(0.7);
  });

  it("treats the boundary t === nowMs - windowMs as in-window", () => {
    expect(maxLevelInWindow([{ t: 500, rms: 0.42 }], 1000, 500)).toBe(0.42);
  });
});

describe("percentileInWindow", () => {
  it("returns null on empty array", () => {
    expect(percentileInWindow([], 1000, 500, 0.2)).toBeNull();
  });

  it("returns null when nothing is in window", () => {
    expect(percentileInWindow([{ t: 100, rms: 0.5 }], 1000, 500, 0.2)).toBeNull();
  });

  it("returns the only sample when one is in window", () => {
    expect(percentileInWindow([{ t: 800, rms: 0.3 }], 1000, 500, 0.2)).toBe(0.3);
    expect(percentileInWindow([{ t: 800, rms: 0.3 }], 1000, 500, 0.99)).toBe(0.3);
  });

  it("returns p20 (second-lowest) of five evenly-spaced samples", () => {
    const samples = [
      { t: 600, rms: 0.5 },
      { t: 700, rms: 0.1 },
      { t: 800, rms: 0.3 },
      { t: 900, rms: 0.4 },
      { t: 950, rms: 0.2 },
    ];
    // Sorted in-window: [0.1, 0.2, 0.3, 0.4, 0.5]; p20 -> ceil(0.2*5)-1 = 0 -> 0.1
    // p40 -> ceil(0.4*5)-1 = 1 -> 0.2
    expect(percentileInWindow(samples, 1000, 500, 0.2)).toBe(0.1);
    expect(percentileInWindow(samples, 1000, 500, 0.4)).toBe(0.2);
  });

  it("ignores samples older than nowMs - windowMs", () => {
    const samples = [
      { t: 100, rms: 0.01 }, // out
      { t: 600, rms: 0.5 },  // in
      { t: 900, rms: 0.7 },  // in
    ];
    // p50 of [0.5, 0.7] -> ceil(0.5*2)-1 = 0 -> 0.5
    expect(percentileInWindow(samples, 1000, 500, 0.5)).toBe(0.5);
  });

  it("treats the boundary t === nowMs - windowMs as in-window", () => {
    expect(percentileInWindow([{ t: 500, rms: 0.42 }], 1000, 500, 0.2)).toBe(0.42);
  });

  it("clamps p outside [0,1]", () => {
    const samples = [
      { t: 800, rms: 0.1 },
      { t: 900, rms: 0.9 },
    ];
    expect(percentileInWindow(samples, 1000, 500, -1)).toBe(0.1);
    expect(percentileInWindow(samples, 1000, 500, 2)).toBe(0.9);
  });
});
