import { describe, it, expect } from "vitest";
import { maxLevelInWindow, isMonitorStreamDegraded } from "../js/audio-level.js";
import { MONITOR_DEGRADED_GRACE_MS, MONITOR_DEGRADED_FLOOR_RMS } from "../js/config.js";

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

describe("isMonitorStreamDegraded", () => {
  const grace = MONITOR_DEGRADED_GRACE_MS;
  const floor = MONITOR_DEGRADED_FLOOR_RMS;

  it("returns false when startedAt is null (not running yet)", () => {
    expect(isMonitorStreamDegraded(10000, null, 0, grace, floor)).toBe(false);
  });

  it("returns false during the grace period even if peak is zero", () => {
    expect(isMonitorStreamDegraded(1000, 0, 0, grace, floor)).toBe(false);
    expect(isMonitorStreamDegraded(grace - 1, 0, 0, grace, floor)).toBe(false);
  });

  it("returns true after grace when peak stayed below floor", () => {
    expect(isMonitorStreamDegraded(grace + 1, 0, 0, grace, floor)).toBe(true);
    expect(isMonitorStreamDegraded(grace + 1, 0, floor / 2, grace, floor)).toBe(true);
  });

  it("returns false after grace when peak crossed the floor", () => {
    expect(isMonitorStreamDegraded(grace + 1, 0, floor, grace, floor)).toBe(false);
    expect(isMonitorStreamDegraded(grace + 1, 0, floor * 2, grace, floor)).toBe(false);
  });

  it("uses elapsed time, so a fresh restart resets the grace window", () => {
    // started at 50_000, queried at 50_000 + grace - 1 → still in grace
    expect(isMonitorStreamDegraded(50_000 + grace - 1, 50_000, 0, grace, floor)).toBe(false);
    // started at 50_000, queried at 50_000 + grace + 1 → past grace, peak 0 → degraded
    expect(isMonitorStreamDegraded(50_000 + grace + 1, 50_000, 0, grace, floor)).toBe(true);
  });
});
