/**
 * Local mic audio-level monitor for the cross-room speech gate.
 *
 * Opens one persistent getUserMedia stream + AudioContext + AnalyserNode and
 * samples the time-domain RMS each animation frame into a ring buffer. The
 * speech path queries shouldSend() before broadcasting a final transcript:
 * if the local mic was quiet, the speech most likely came from another
 * phone's owner across the room, so we drop it.
 *
 * Soft-fails open: if mic permission is denied, the API isn't available, or
 * the iOS recognition stream conflicts with this one, shouldSend() returns
 * true so the rest of the app keeps working.
 */

import {
  AUDIO_GATE_THRESHOLD,
  AUDIO_GATE_WINDOW_MS,
  AUDIO_RING_CAPACITY,
} from "./config.js";

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let audioCtx = null;
let mediaStream = null;
let analyser = null;
let dataArray = null;
let rafId = null;
// Circular ring of {t, rms}. t is performance.now() ms.
let ring = [];
let ringIdx = 0;
let monitorState = "idle"; // idle | starting | running | failed
let currentLevel = 0;

/**
 * Pure helper. Given samples sorted by time, return the max rms whose
 * t >= nowMs - windowMs. Boundary t === nowMs - windowMs counts as in-window.
 * Returns null if no samples in window.
 */
export function maxLevelInWindow(samples, nowMs, windowMs) {
  if (!samples || samples.length === 0) return null;
  const cutoff = nowMs - windowMs;
  let max = null;
  for (const s of samples) {
    if (!s) continue;
    if (s.t >= cutoff) {
      if (max === null || s.rms > max) max = s.rms;
    }
  }
  return max;
}

function pushSample(t, rms) {
  if (ring.length < AUDIO_RING_CAPACITY) {
    ring.push({ t, rms });
  } else {
    ring[ringIdx] = { t, rms };
    ringIdx = (ringIdx + 1) % AUDIO_RING_CAPACITY;
  }
}

function computeRms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

function tick() {
  if (monitorState !== "running" || !analyser || !dataArray) return;
  analyser.getFloatTimeDomainData(dataArray);
  const rms = computeRms(dataArray);
  currentLevel = rms;
  pushSample(performance.now(), rms);
  rafId = requestAnimationFrame(tick);
}

/**
 * Start mic monitoring. Idempotent — second call while already running is a no-op.
 * Resolves true on success, false on soft-fail (denied / unsupported / iOS conflict).
 */
export async function startAudioLevelMonitor() {
  if (monitorState === "running" || monitorState === "starting") return monitorState === "running";
  monitorState = "starting";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    monitorState = "failed";
    return false;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    monitorState = "failed";
    return false;
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new AC();
    const source = audioCtx.createMediaStreamSource(mediaStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    dataArray = new Float32Array(analyser.fftSize);
    source.connect(analyser);
    monitorState = "running";
    rafId = requestAnimationFrame(tick);
    return true;
  } catch (_e) {
    // Most common path on iOS Safari (mic conflict with webkitSpeechRecognition)
    // and on permission denial. Stay open so the app still works.
    monitorState = "failed";
    if (mediaStream) {
      try { mediaStream.getTracks().forEach((t) => t.stop()); } catch (_e2) { /* ignore */ }
      mediaStream = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (_e2) { /* ignore */ }
      audioCtx = null;
    }
    if (isIOS) console.warn("Audio gate disabled on iOS (mic conflict). Speech still works.");
    return false;
  }
}

/**
 * Stop monitoring and release mic + AudioContext. Idempotent.
 */
export function stopAudioLevelMonitor() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (mediaStream) {
    try { mediaStream.getTracks().forEach((t) => t.stop()); } catch (_e) { /* ignore */ }
    mediaStream = null;
  }
  if (audioCtx) {
    try { audioCtx.close(); } catch (_e) { /* ignore */ }
    audioCtx = null;
  }
  analyser = null;
  dataArray = null;
  ring = [];
  ringIdx = 0;
  currentLevel = 0;
  monitorState = "idle";
}

/**
 * Open by default — returns true on no data, startup race, or any failure.
 */
export function shouldSend() {
  if (monitorState !== "running") return true;
  const max = maxLevelInWindow(ring, performance.now(), AUDIO_GATE_WINDOW_MS);
  if (max === null) return true;
  return max >= AUDIO_GATE_THRESHOLD;
}

/**
 * Latest RMS reading (0..1). 0 if monitor isn't running.
 */
export function getCurrentLevel() {
  return monitorState === "running" ? currentLevel : 0;
}

/**
 * Test seam — inject a sample into the ring without an AudioContext.
 * Production code never calls this.
 */
export function _pushSampleForTest(t, rms) {
  pushSample(t, rms);
  monitorState = "running";
  currentLevel = rms;
}

export function _resetForTest() {
  ring = [];
  ringIdx = 0;
  monitorState = "idle";
  currentLevel = 0;
}
