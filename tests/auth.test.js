import { describe, it, expect, beforeEach } from "vitest";
import { validatePassword, createUser, saveUser, loadUser, getColorPalette } from "../js/auth.js";

describe("validatePassword", () => {
  it("accepts the correct password", () => {
    expect(validatePassword("oido2026")).toBe(true);
  });

  it("rejects wrong password", () => {
    expect(validatePassword("wrong")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validatePassword("")).toBe(false);
  });

  it("rejects null/undefined", () => {
    expect(validatePassword(null)).toBe(false);
    expect(validatePassword(undefined)).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    expect(validatePassword("  oido2026  ")).toBe(true);
  });
});

describe("createUser", () => {
  it("creates a user with name and color", () => {
    const user = createUser("David", "#ef4444");
    expect(user).toEqual({ name: "David", color: "#ef4444" });
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
    sessionStorage.clear();
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
    sessionStorage.setItem("oido_user", "not-json");
    expect(loadUser()).toBeNull();
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
