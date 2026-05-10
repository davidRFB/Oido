import { ROOM_PASSWORD_HASH, COLOR_PALETTE, ENROLLMENT_MIN_SAMPLES } from "./config.js";

const LOCAL_KEY = "oido_user";
const LOCAL_USER_ID_KEY = "oido_user_id";
const LOCAL_VOICEPRINT_KEY = "oido_voiceprint";

/**
 * Hash a string using SHA-256 via Web Crypto API.
 * @param {string} text
 * @returns {Promise<string>} hex-encoded hash
 */
async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate password against the stored hash.
 * @param {string} input
 * @returns {Promise<boolean>}
 */
export async function validatePassword(input) {
  if (typeof input !== "string" || !input.trim()) return false;
  const hash = await sha256(input.trim());
  return hash === ROOM_PASSWORD_HASH;
}

/**
 * Create a user object from name and color.
 * @param {string} name
 * @param {string} color - hex color value
 * @returns {{ name: string, color: string, readOnly: boolean } | null}
 */
export function createUser(name, color, readOnly = false) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  if (!color) return null;
  return { name: trimmed, color, readOnly };
}

/**
 * Save user to localStorage so name + color survive tab close on the same device.
 * @param {{ name: string, color: string, readOnly?: boolean }} user
 */
export function saveUser(user) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(user));
}

/**
 * Load user from localStorage.
 * @returns {{ name: string, color: string, readOnly?: boolean } | null}
 */
export function loadUser() {
  const data = localStorage.getItem(LOCAL_KEY);
  if (!data) return null;
  try {
    const user = JSON.parse(data);
    if (user && user.name && user.color) return user;
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the persisted user id without creating one. Returns null on first visit.
 * @returns {string | null}
 */
export function getUserId() {
  return localStorage.getItem(LOCAL_USER_ID_KEY);
}

/**
 * Read the persisted user id, generating and storing a fresh UUID on first call.
 * @returns {string}
 */
export function getOrCreateUserId() {
  const existing = getUserId();
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(LOCAL_USER_ID_KEY, fresh);
  return fresh;
}

/**
 * Persist this device's voiceprint (mean F0 + sample stddev + count) so the
 * pitch gate can suppress crosstalk without re-running enrollment every visit.
 * @param {{ f0_mean: number, f0_stddev: number, f0_samples: number, enrolled_at?: number }} profile
 */
export function saveVoiceprint(profile) {
  if (!profile) return;
  if (typeof profile.f0_mean !== "number" || typeof profile.f0_stddev !== "number") return;
  if (typeof profile.f0_samples !== "number") return;
  localStorage.setItem(LOCAL_VOICEPRINT_KEY, JSON.stringify(profile));
}

/**
 * Read the stored voiceprint. Returns null when missing or shape-invalid so
 * callers can default-allow.
 * @returns {{ f0_mean: number, f0_stddev: number, f0_samples: number, enrolled_at?: number } | null}
 */
export function loadVoiceprint() {
  const data = localStorage.getItem(LOCAL_VOICEPRINT_KEY);
  if (!data) return null;
  try {
    const v = JSON.parse(data);
    if (
      v &&
      typeof v.f0_mean === "number" &&
      typeof v.f0_stddev === "number" &&
      typeof v.f0_samples === "number"
    ) {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether this device should run enrollment before entering chat. True if no
 * voiceprint is stored or the stored sample count is below the enrollment
 * threshold (which would have produced an unreliable band).
 * @returns {boolean}
 */
export function needsEnrollment() {
  const v = loadVoiceprint();
  if (!v) return true;
  return v.f0_samples < ENROLLMENT_MIN_SAMPLES;
}

/**
 * Get the available color palette.
 * @returns {Array<{ name: string, value: string }>}
 */
export function getColorPalette() {
  return COLOR_PALETTE;
}
