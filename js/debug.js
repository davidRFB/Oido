/**
 * Lightweight debug module. Opt-in via URL `?debug=1` (persisted to
 * sessionStorage so reloads keep it on). When enabled:
 *   - dlog(category, ...) writes timestamped console lines.
 *   - A floating overlay shows live threshold/gate state and counters.
 *
 * Pure no-op when disabled, so production cost is one boolean check per call.
 */

let enabled = null;
let overlay = null;
let fields = {};
const counters = { sent: 0, recv: 0, dropped: 0, autoPromote: 0, engineSuppressed: 0 };

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

export function dlog(category, ...args) {
  if (!isDebugEnabled()) return;
  const t = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[${t}] ${category}`, ...args);
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

function render() {
  if (!overlay) return;
  const f = fields;
  overlay.textContent =
    `RMS:    ${fmt(f.rms)}\n` +
    `Ambient:${fmt(f.ambient)}  (×${fmt(f.multiplier)})\n` +
    `Thresh: ${fmt(f.threshold)}\n` +
    `Gate:   ${f.gate || "—"}\n` +
    `Sent:${counters.sent}  Recv:${counters.recv}  Drop:${counters.dropped}\n` +
    `AutoPromote:${counters.autoPromote}  EngSupp:${counters.engineSuppressed}\n` +
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
