import { describe, it, expect } from "vitest";
import { shouldSuppressFinal } from "../js/speech.js";
import { normalize } from "../js/dedup.js";
import { INTERIM_AUTOPROMOTE_WINDOW_MS } from "../js/config.js";

const now = 10_000;

function entry(text, ageMs) {
  return { normText: normalize(text), t: now - ageMs };
}

describe("shouldSuppressFinal", () => {
  it("returns false for empty ring", () => {
    expect(shouldSuppressFinal([], "hola que tal", now)).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(shouldSuppressFinal([entry("hola", 100)], "", now)).toBe(false);
  });

  it("suppresses identical text within the window", () => {
    expect(shouldSuppressFinal([entry("hola que tal", 500)], "hola que tal", now)).toBe(true);
  });

  it("does NOT suppress identical text past the window", () => {
    expect(
      shouldSuppressFinal(
        [entry("hola que tal", INTERIM_AUTOPROMOTE_WINDOW_MS + 100)],
        "hola que tal",
        now,
      ),
    ).toBe(false);
  });

  it("normalizes punctuation and case before comparing", () => {
    expect(
      shouldSuppressFinal([entry("hola que tal", 500)], "Hola, qué tal.", now),
    ).toBe(true);
  });

  it("does NOT suppress very different text", () => {
    expect(
      shouldSuppressFinal(
        [entry("hola que tal", 500)],
        "buenas tardes señor",
        now,
      ),
    ).toBe(false);
  });

  it("suppresses near-duplicates within the dedup ratio", () => {
    // levenshtein ratio <= 0.25 should match (one or two char differences)
    expect(
      shouldSuppressFinal([entry("hola que tal", 500)], "ola que tal", now),
    ).toBe(true);
  });
});
