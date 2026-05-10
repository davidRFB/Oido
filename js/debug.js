/**
 * Debug + diagnostics module.
 *
 * - dlog(category, ...) ALWAYS records into an in-memory ring buffer (so the
 *   Diagnóstico panel can show recent activity to non-developer users).
 *   Console output stays gated by `?debug=1` so the production console isn't
 *   spammed.
 * - When ?debug=1 is on, a floating overlay shows live threshold/gate/pitch
 *   state plus counters.
 *
 * The ring buffer is small and fixed-size, so production overhead is bounded.
 */

let enabled = null;
let overlay = null;
let fields = {};
const counters = { sent: 0, recv: 0, dropped: 0, gateDrop: 0, pitchDrop: 0, autoPromote: 0, engineSuppressed: 0 };

const LOG_CAPACITY = 200;
const recentLogs = []; // FIFO, evict from front when full

function readEnabled() {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("debug") === "1") {
      sessionStorage.setItem("oidoDebug", "1");
      return true;
    }
    if (params.get("debug") === "0") {
      sessionStorage.removeItem("oidoDebug");
      return false;
    }
    return sessionStorage.getItem("oidoDebug") === "1";
  } catch (_e) {
    return false;
  }
}

export function isDebugEnabled() {
  if (enabled === null) enabled = readEnabled();
  return enabled;
}

function stringifyArg(a) {
  if (a === null || a === undefined) return String(a);
  if (typeof a === "string") return a;
  if (typeof a === "number" || typeof a === "boolean") return String(a);
  try { return JSON.stringify(a); } catch { return String(a); }
}

export function dlog(category, ...args) {
  const t = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  // Always record so Diagnóstico can show recent events to non-dev users.
  const msg = args.map(stringifyArg).join(" ");
  if (recentLogs.length >= LOG_CAPACITY) recentLogs.shift();
  recentLogs.push({ t, category, msg });
  if (!isDebugEnabled()) return;
  console.log(`[${t}] ${category}`, ...args);
}

/**
 * Recent log entries, oldest first. Returns a shallow copy.
 */
export function getRecentLogs() {
  return recentLogs.slice();
}

/**
 * Format the recent log buffer as plain text — suitable for "Copiar registro"
 * so a non-developer can paste it into WhatsApp.
 */
export function getRecentLogsAsText() {
  return recentLogs.map((l) => `[${l.t}] ${l.category} ${l.msg}`).join("\n");
}

/**
 * Synchronous capability snapshot of the runtime. The Diagnóstico panel
 * renders this so the family can see what's missing on each device.
 */
export function getCapabilities() {
  const speechApi = !!(typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition));
  const mediaDevices = !!(typeof navigator !== "undefined" &&
    navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const audioContext = !!(typeof window !== "undefined" &&
    (window.AudioContext || window.webkitAudioContext));
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const platform = typeof navigator !== "undefined" ? navigator.platform : "";
  return { speechApi, mediaDevices, audioContext, online, ua, platform };
}

/**
 * Resolve the current microphone permission state. Returns one of:
 * "granted" | "denied" | "prompt" | "unknown" — falls back to "unknown" on
 * browsers that don't expose the Permissions API for `microphone`.
 */
export async function getMicPermission() {
  try {
    if (typeof navigator !== "undefined" && navigator.permissions && navigator.permissions.query) {
      const res = await navigator.permissions.query({ name: "microphone" });
      return res.state;
    }
  } catch (_e) { /* unsupported on Firefox/Safari sometimes */ }
  return "unknown";
}

function fmt(n) {
  if (n === null || n === undefined) return "—";
  if (typeof n !== "number") return String(n);
  return n.toFixed(3);
}

function buildOverlay() {
  const el = document.createElement("div");
  el.id = "debug-overlay";
  el.style.cssText = [
    "position:fixed",
    "top:8px",
    "right:8px",
    "z-index:9999",
    "background:rgba(0,0,0,0.78)",
    "color:#0f0",
    "font:11px/1.35 ui-monospace,Menlo,monospace",
    "padding:8px 10px",
    "border-radius:6px",
    "border:1px solid #0f0",
    "max-width:280px",
    "white-space:pre-wrap",
    "pointer-events:auto",
    "user-select:text",
  ].join(";");
  el.title = "Debug overlay (?debug=0 to disable)";
  document.body.appendChild(el);
  return el;
}

function fmtHz(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n) + "Hz";
}

function render() {
  if (!overlay) return;
  const f = fields;
  const band = (typeof f.vpMean === "number" && typeof f.vpStddev === "number" && typeof f.vpTolerance === "number")
    ? `${fmtHz(f.vpMean)}±${fmtHz(f.vpTolerance * f.vpStddev)}`
    : "—";
  overlay.textContent =
    `RMS:    ${fmt(f.rms)}\n` +
    `Ambient:${fmt(f.ambient)}  (×${fmt(f.multiplier)})\n` +
    `Thresh: ${fmt(f.threshold)}\n` +
    `Gate:   ${f.gate || "—"}\n` +
    `Pitch:  ${fmtHz(f.pitchMedian)}  n=${f.pitchN ?? 0}  ${f.pitchInBand || "—"}\n` +
    `Voice:  ${band}\n` +
    `Sent:${counters.sent}  Recv:${counters.recv}  Drop:${counters.dropped}\n` +
    `GateDrop:${counters.gateDrop}  PitchDrop:${counters.pitchDrop}\n` +
    `Last:   ${f.lastEvent || "—"}`;
}

/**
 * Initialize the on-screen overlay. Safe to call multiple times.
 */
export function initDebugOverlay() {
  if (!isDebugEnabled()) return;
  if (overlay) return;
  if (typeof document === "undefined" || !document.body) return;
  overlay = buildOverlay();
  render();
}

export function updateGateStats({ rms, ambient, multiplier, threshold, gate }) {
  if (!isDebugEnabled()) return;
  fields.rms = rms;
  fields.ambient = ambient;
  fields.multiplier = multiplier;
  fields.threshold = threshold;
  fields.gate = gate;
  render();
}

/**
 * Live pitch state for the overlay. inBand may be "OK", "BAD", "?" (insufficient
 * samples), or "—" (no voiceprint). Voiceprint fields publish the current band
 * so an operator can see what the gate is checking against.
 */
export function updatePitchStats({ median, n, inBand, vpMean, vpStddev, vpTolerance }) {
  if (!isDebugEnabled()) return;
  fields.pitchMedian = median;
  fields.pitchN = n;
  fields.pitchInBand = inBand;
  if (vpMean !== undefined) fields.vpMean = vpMean;
  if (vpStddev !== undefined) fields.vpStddev = vpStddev;
  if (vpTolerance !== undefined) fields.vpTolerance = vpTolerance;
  render();
}

export function bumpCounter(key, label) {
  if (!isDebugEnabled()) return;
  if (counters[key] !== undefined) counters[key]++;
  if (label) fields.lastEvent = label;
  render();
}

export function setLastEvent(label) {
  if (!isDebugEnabled()) return;
  fields.lastEvent = label;
  render();
}
