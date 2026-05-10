import { describe, it, expect } from "vitest";
import { maxLevelInWindow } from "../js/audio-level.js";

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
