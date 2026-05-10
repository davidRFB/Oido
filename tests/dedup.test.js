import { describe, it, expect, beforeEach } from "vitest";
import {
  normalize,
  levenshtein,
  shouldRenderIncoming,
  _resetDedupRing,
} from "../js/dedup.js";

describe("normalize", () => {
  it("lowercases", () => {
    expect(normalize("Hola Mundo")).toBe("hola mundo");
  });

  it("strips punctuation", () => {
    expect(normalize("¡Hola, mundo! ¿Cómo estás?")).toBe("hola mundo cómo estás");
  });

  it("collapses whitespace", () => {
    expect(normalize("hola    mundo\n\thola")).toBe("hola mundo hola");
  });

  it("returns empty string for non-string input", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
    expect(normalize(42)).toBe("");
  });
});

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hola", "hola")).toBe(0);
  });

  it("returns the length of the other when one is empty", () => {
    expect(levenshtein("", "hola")).toBe(4);
    expect(levenshtein("hola", "")).toBe(4);
  });

  it("counts a single insertion as 1", () => {
    expect(levenshtein("hola", "holaa")).toBe(1);
  });

  it("counts a single deletion as 1", () => {
    expect(levenshtein("holaa", "hola")).toBe(1);
  });

  it("counts a single substitution as 1", () => {
    expect(levenshtein("hola", "holo")).toBe(1);
  });

  it("is symmetric", () => {
    expect(levenshtein("kitten", "sitting")).toBe(levenshtein("sitting", "kitten"));
  });
});

describe("shouldRenderIncoming", () => {
  beforeEach(() => {
    _resetDedupRing();
  });

  const finalMsg = (name, text, timestamp = 0) => ({ name, text, timestamp, isFinal: true });

  it("renders the first message it sees", () => {
    const now = 1000;
    expect(shouldRenderIncoming(finalMsg("Ana", "Hola mundo"), "Self", () => now)).toBe(true);
  });

  it("dedups exact-text match from a different user within the window", () => {
    let now = 1000;
    shouldRenderIncoming(finalMsg("Ana", "Hola mundo"), "Self", () => now);
    now = 1500;
    expect(shouldRenderIncoming(finalMsg("Bob", "Hola mundo"), "Self", () => now)).toBe(false);
  });

  it("dedups near-text match (one typo) from a different user within the window", () => {
    let now = 1000;
    shouldRenderIncoming(finalMsg("Ana", "Hola mundo amigo"), "Self", () => now);
    now = 1300;
    expect(shouldRenderIncoming(finalMsg("Bob", "Hola mundi amigo"), "Self", () => now)).toBe(false);
  });

  it("does NOT dedup substantially different text", () => {
    let now = 1000;
    shouldRenderIncoming(finalMsg("Ana", "Hola mundo"), "Self", () => now);
    now = 1500;
    expect(shouldRenderIncoming(finalMsg("Bob", "Que tal estas amigo"), "Self", () => now)).toBe(true);
  });

  it("does NOT dedup the same user repeating themselves", () => {
    let now = 1000;
    shouldRenderIncoming(finalMsg("Ana", "Sí"), "Self", () => now);
    now = 1300;
    expect(shouldRenderIncoming(finalMsg("Ana", "Sí"), "Self", () => now)).toBe(true);
  });

  it("does NOT dedup if prior message is older than the window", () => {
    let now = 1000;
    shouldRenderIncoming(finalMsg("Ana", "Hola mundo"), "Self", () => now);
    now = 5000;
    expect(shouldRenderIncoming(finalMsg("Bob", "Hola mundo"), "Self", () => now)).toBe(true);
  });

  it("records dropped duplicates so a third device's copy is also suppressed", () => {
    let now = 1000;
    expect(shouldRenderIncoming(finalMsg("Ana", "Hola"), "Self", () => now)).toBe(true);
    now = 1100;
    expect(shouldRenderIncoming(finalMsg("Bob", "Hola"), "Self", () => now)).toBe(false);
    now = 1200;
    expect(shouldRenderIncoming(finalMsg("Carl", "Hola"), "Self", () => now)).toBe(false);
  });

  it("respects an injectable nowFn", () => {
    let now = 1000;
    shouldRenderIncoming(finalMsg("Ana", "Hola"), "Self", () => now);
    now = 1000 + 10000;
    // 10s gap > DEDUP_WINDOW_MS (2s), so no dedup.
    expect(shouldRenderIncoming(finalMsg("Bob", "Hola"), "Self", () => now)).toBe(true);
  });
});
