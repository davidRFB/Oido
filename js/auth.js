import { ROOM_PASSWORD, COLOR_PALETTE } from "./config.js";

const SESSION_KEY = "oido_user";

/**
 * Validate password against the hardcoded room password.
 * @param {string} input
 * @returns {boolean}
 */
export function validatePassword(input) {
  return typeof input === "string" && input.trim() === ROOM_PASSWORD;
}

/**
 * Create a user object from name and color.
 * @param {string} name
 * @param {string} color - hex color value
 * @returns {{ name: string, color: string } | null}
 */
export function createUser(name, color) {
  const trimmed = (name || "").trim();
  if (!trimmed) return null;
  if (!color) return null;
  return { name: trimmed, color };
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
