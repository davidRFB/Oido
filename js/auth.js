import { ROOM_PASSWORD_HASH, COLOR_PALETTE } from "./config.js";

const SESSION_KEY = "oido_user";

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
 * @returns {{ name: string, color: string } | null}
 */
export function createUser(name, color, readOnly = false) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  if (!color) return null;
  return { name: trimmed, color, readOnly };
}

/**
 * Save user to sessionStorage.
 * @param {{ name: string, color: string }} user
 */
export function saveUser(user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

/**
 * Load user from sessionStorage.
 * @returns {{ name: string, color: string } | null}
 */
export function loadUser() {
  const data = sessionStorage.getItem(SESSION_KEY);
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
 * Get the available color palette.
 * @returns {Array<{ name: string, value: string }>}
 */
export function getColorPalette() {
  return COLOR_PALETTE;
}
