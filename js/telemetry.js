/**
 * Passive device telemetry. Writes a per-device snapshot to
 * rooms/default/devices/{userId} on chat entry and on speech errors so the
 * maintainer can diagnose remote devices from the Firebase console without
 * asking the user to copy logs from the Diagnóstico panel.
 *
 * Soft-fails on offline mode (no firebaseConfig) and on any Firebase error —
 * this is observability, never blocking the chat path.
 */

import { getDb } from "./chat.js";
import { getCapabilities, getMicPermission } from "./debug.js";
import { isMonitorDegraded, getMonitorPeakEver } from "./audio-level.js";
import { getUnsupportedReason } from "./speech.js";

const RECENT_ERRORS_CAP = 10;

function deviceRef(userId) {
  const db = getDb();
  if (!db || !userId) return null;
  return firebase.ref(db, "rooms/default/devices/" + userId);
}

/**
 * Write or refresh the device snapshot for this user. Uses update() so
 * recentErrors stays intact across writes. firstSeenAt is set only on the
 * first write — subsequent writes leave it alone via a one-shot get().
 */
export async function writeDeviceSnapshot(user) {
  if (!user || !user.userId) return;
  const ref = deviceRef(user.userId);
  if (!ref) return;

  const caps = getCapabilities();
  const micPermission = await getMicPermission();
  const now = Date.now();

  const fields = {
    name: user.name || "",
    color: user.color || "#000000",
    ua: (caps.ua || "").slice(0, 500),
    platform: (caps.platform || "").slice(0, 100),
    caps: {
      speechApi: !!caps.speechApi,
      mediaDevices: !!caps.mediaDevices,
      audioContext: !!caps.audioContext,
      online: !!caps.online,
    },
    micPermission: String(micPermission || "unknown").slice(0, 20),
    unsupportedReason: getUnsupportedReason(),
    readOnly: !!user.readOnly,
    gateDegraded: !!isMonitorDegraded(),
    monitorPeak: Number(getMonitorPeakEver()) || 0,
    lastSeenAt: now,
  };

  try {
    const snap = await firebase.get(ref);
    if (!snap.exists() || !snap.child("firstSeenAt").exists()) {
      fields.firstSeenAt = now;
    }
    await firebase.update(ref, fields);
  } catch (_e) {
    /* observability is best-effort */
  }
}

/**
 * Append a speech-error entry under recentErrors and trim to the last
 * RECENT_ERRORS_CAP entries. Push-IDs are time-ordered so sorting them
 * lexicographically is equivalent to sorting by time.
 */
export async function recordError(user, code, message) {
  if (!user || !user.userId) return;
  const ref = deviceRef(user.userId);
  if (!ref) return;

  const errorsRef = firebase.ref(getDb(), "rooms/default/devices/" + user.userId + "/recentErrors");
  const entry = {
    code: String(code || "unknown").slice(0, 50),
    message: String(message || "").slice(0, 500),
    at: Date.now(),
  };

  try {
    await firebase.push(errorsRef, entry);
    const snap = await firebase.get(errorsRef);
    if (!snap.exists()) return;
    const keys = [];
    snap.forEach((child) => { keys.push(child.key); });
    keys.sort();
    const overflow = keys.length - RECENT_ERRORS_CAP;
    for (let i = 0; i < overflow; i++) {
      const oldRef = firebase.ref(
        getDb(),
        "rooms/default/devices/" + user.userId + "/recentErrors/" + keys[i],
      );
      await firebase.set(oldRef, null);
    }
  } catch (_e) {
    /* observability is best-effort */
  }
}
