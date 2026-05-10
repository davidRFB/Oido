/**
 * Cross-device dedup for inbound chat messages.
 *
 * When several phones in the same physical room each transcribe the same
 * utterance, peers receive near-identical messages from different users
 * within a short window. We render the first one and suppress the rest.
 *
 * Pure / DOM-free so it can be unit-tested without jsdom audio mocks.
 */

import {
  DEDUP_WINDOW_MS,
  DEDUP_RING_SIZE,
  DEDUP_LEN_RATIO_MAX,
  DEDUP_LEV_RATIO_MAX,
} from "./config.js";

const PUNCT_RE = /[.,!?;:¿¡"'`(){}[\]…—–-]/g;
const WS_RE = /\s+/g;

/**
 * Lowercase, strip punctuation, collapse whitespace.
 */
export function normalize(text) {
  if (typeof text !== "string") return "";
  return text.toLowerCase().replace(PUNCT_RE, "").replace(WS_RE, " ").trim();
}

/**
 * Iterative two-row Levenshtein. O(min(a, b)) memory.
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  // Make a the shorter for memory.
  if (al > bl) return levenshtein(b, a);

  let prev = new Array(al + 1);
  let curr = new Array(al + 1);
  for (let i = 0; i <= al; i++) prev[i] = i;

  for (let j = 1; j <= bl; j++) {
    curr[0] = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= al; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,    // insertion
        prev[i] + 1,        // deletion
        prev[i - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[al];
}

let ring = []; // { name, normText, t }

function recordIntoRing(entry) {
  if (ring.length < DEDUP_RING_SIZE) {
    ring.push(entry);
  } else {
    // Drop the oldest entry, append the new one.
    ring.shift();
    ring.push(entry);
  }
}

/**
 * Decide whether to render an inbound final message.
 * Always records into the ring (even when returning false) so a third
 * device's copy is suppressed too.
 *
 * @param {{ name: string, text: string, timestamp: number, isFinal: boolean }} message
 * @param {string} _selfName - currentUser.name (currently unused; kept for future
 *   self-aware filtering, e.g. echo from speakers re-transcribed by own mic).
 * @param {() => number} [nowFn] - injectable for tests; defaults to Date.now.
 */
export function shouldRenderIncoming(message, _selfName, nowFn) {
  const now = (nowFn || Date.now)();
  const normText = normalize(message.text);
  const entry = { name: message.name, normText, t: now };

  // Look for a different-user duplicate within the window before recording,
  // so the new entry doesn't match itself.
  let isDup = false;
  if (normText.length > 0) {
    for (const prev of ring) {
      if (prev.name === message.name) continue;          // same name = ignore for dedup
      if (now - prev.t > DEDUP_WINDOW_MS) continue;       // outside window
      const a = prev.normText;
      const b = normText;
      const maxLen = Math.max(a.length, b.length);
      if (maxLen === 0) continue;
      // Cheap pre-filter on length ratio.
      if (Math.abs(a.length - b.length) / maxLen >= DEDUP_LEN_RATIO_MAX) continue;
      const dist = levenshtein(a, b);
      if (dist / maxLen < DEDUP_LEV_RATIO_MAX) {
        isDup = true;
        break;
      }
    }
  }

  recordIntoRing(entry);
  return !isDup;
}

export function _resetDedupRing() {
  ring = [];
}
