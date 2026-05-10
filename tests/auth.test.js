import { describe, it, expect, beforeEach } from "vitest";
import {
  validatePassword,
  createUser,
  saveUser,
  loadUser,
  getColorPalette,
  getUserId,
  getOrCreateUserId,
  saveVoiceprint,
  loadVoiceprint,
  needsEnrollment,
  markAuthFresh,
  isAuthFresh,
  clearAuthFresh,
} from "../js/auth.js";
import { ENROLLMENT_MIN_SAMPLES, AUTH_FRESH_MS } from "../js/config.js";

describe("validatePassword", () => {
  it("accepts the correct password", async () => {
    expect(await validatePassword("jaimeynubia")).toBe(true);
  });

  it("rejects wrong password", async () => {
    expect(await validatePassword("wrong")).toBe(false);
  });

  it("rejects empty string", async () => {
    expect(await validatePassword("")).toBe(false);
  });

  it("rejects null/undefined", async () => {
    expect(await validatePassword(null)).toBe(false);
    expect(await validatePassword(undefined)).toBe(false);
  });

  it("trims whitespace before comparing", async () => {
    expect(await validatePassword("  jaimeynubia  ")).toBe(true);
  });
});

describe("createUser", () => {
  it("creates a user with name and color", () => {
    const user = createUser("David", "#ef4444");
    expect(user).toEqual({ name: "David", color: "#ef4444", readOnly: false });
  });

  it("creates a read-only user", () => {
    const user = createUser("David", "#ef4444", true);
    expect(user.readOnly).toBe(true);
  });

  it("trims the name", () => {
    const user = createUser("  David  ", "#ef4444");
    expect(user.name).toBe("David");
  });

  it("returns null for empty name", () => {
    expect(createUser("", "#ef4444")).toBeNull();
    expect(createUser("   ", "#ef4444")).toBeNull();
  });

  it("returns null for missing color", () => {
    expect(createUser("David", "")).toBeNull();
    expect(createUser("David", null)).toBeNull();
  });
});

describe("saveUser / loadUser", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves and loads a user", () => {
    const user = { name: "David", color: "#ef4444" };
    saveUser(user);
    expect(loadUser()).toEqual(user);
  });

  it("returns null when no user saved", () => {
    expect(loadUser()).toBeNull();
  });

  it("returns null for corrupted data", () => {
    localStorage.setItem("oido_user", "not-json");
    expect(loadUser()).toBeNull();
  });

  it("persists across simulated reloads (localStorage, not sessionStorage)", () => {
    const user = { name: "David", color: "#ef4444", readOnly: false };
    saveUser(user);
    // Simulating a sessionStorage clear (tab close) must not affect us.
    sessionStorage.clear();
    expect(loadUser()).toEqual(user);
  });
});

describe("getUserId / getOrCreateUserId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getUserId returns null on first visit", () => {
    expect(getUserId()).toBeNull();
  });

  it("getOrCreateUserId mints a UUID on first call and persists it", () => {
    const id = getOrCreateUserId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(20);
    expect(localStorage.getItem("oido_user_id")).toBe(id);
  });

  it("getOrCreateUserId returns the same UUID on subsequent calls", () => {
    const a = getOrCreateUserId();
    const b = getOrCreateUserId();
    const c = getUserId();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("getUserId reads back what getOrCreateUserId wrote", () => {
    const id = getOrCreateUserId();
    expect(getUserId()).toBe(id);
  });
});

describe("voiceprint persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no voiceprint is stored", () => {
    expect(loadVoiceprint()).toBeNull();
  });

  it("round-trips a saved voiceprint", () => {
    const profile = { f0_mean: 180, f0_stddev: 22, f0_samples: 30, enrolled_at: 12345 };
    saveVoiceprint(profile);
    expect(loadVoiceprint()).toEqual(profile);
  });

  it("rejects shape-invalid stored data", () => {
    localStorage.setItem("oido_voiceprint", JSON.stringify({ junk: 1 }));
    expect(loadVoiceprint()).toBeNull();
  });

  it("rejects corrupted JSON", () => {
    localStorage.setItem("oido_voiceprint", "not-json");
    expect(loadVoiceprint()).toBeNull();
  });

  it("ignores save calls with bad shape", () => {
    saveVoiceprint(null);
    saveVoiceprint({ f0_mean: "nope", f0_stddev: 22, f0_samples: 30 });
    expect(loadVoiceprint()).toBeNull();
  });
});

describe("needsEnrollment", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns true when no voiceprint is stored", () => {
    expect(needsEnrollment()).toBe(true);
  });

  it("returns true when stored sample count is below the threshold", () => {
    saveVoiceprint({ f0_mean: 180, f0_stddev: 22, f0_samples: ENROLLMENT_MIN_SAMPLES - 1, enrolled_at: 1 });
    expect(needsEnrollment()).toBe(true);
  });

  it("returns false once a full-sample voiceprint is stored", () => {
    saveVoiceprint({ f0_mean: 180, f0_stddev: 22, f0_samples: ENROLLMENT_MIN_SAMPLES, enrolled_at: 1 });
    expect(needsEnrollment()).toBe(false);
  });
});

describe("auth freshness", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("isAuthFresh returns false when no stamp is stored", () => {
    expect(isAuthFresh()).toBe(false);
  });

  it("isAuthFresh returns true right after markAuthFresh", () => {
    const now = 1_000_000;
    markAuthFresh(now);
    expect(isAuthFresh(now)).toBe(true);
  });

  it("isAuthFresh stays true within the freshness window", () => {
    const now = 1_000_000;
    markAuthFresh(now);
    expect(isAuthFresh(now + AUTH_FRESH_MS - 1)).toBe(true);
  });

  it("isAuthFresh returns false at and after the freshness window", () => {
    const now = 1_000_000;
    markAuthFresh(now);
    expect(isAuthFresh(now + AUTH_FRESH_MS)).toBe(false);
    expect(isAuthFresh(now + AUTH_FRESH_MS + 1)).toBe(false);
  });

  it("isAuthFresh rejects future timestamps (clock skew)", () => {
    markAuthFresh(2_000_000);
    expect(isAuthFresh(1_000_000)).toBe(false);
  });

  it("isAuthFresh rejects corrupt stored values", () => {
    localStorage.setItem("oido_auth_at", "not-a-number");
    expect(isAuthFresh()).toBe(false);
    localStorage.setItem("oido_auth_at", "0");
    expect(isAuthFresh()).toBe(false);
    localStorage.setItem("oido_auth_at", "-5");
    expect(isAuthFresh()).toBe(false);
  });

  it("clearAuthFresh removes a previously-set stamp", () => {
    markAuthFresh(1_000_000);
    expect(isAuthFresh(1_000_000)).toBe(true);
    clearAuthFresh();
    expect(isAuthFresh(1_000_000)).toBe(false);
  });
});

describe("getColorPalette", () => {
  it("returns an array of colors", () => {
    const palette = getColorPalette();
    expect(palette.length).toBeGreaterThanOrEqual(6);
    expect(palette[0]).toHaveProperty("name");
    expect(palette[0]).toHaveProperty("value");
  });
});
