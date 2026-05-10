/**
 * Pitch detector. Attaches a parallel AnalyserNode to the shared mic graph
 * exposed by audio-level.js, runs a per-frame autocorrelation F0 estimator,
 * and rolls the recent estimates into a ring buffer that the speech gate and
 * the enrollment screen query.
 *
 * Soft-fails open like audio-level.js — if the shared context isn't available
 * (iOS conflict, denial, unsupported browser), the detector reports no data
 * and downstream code default-allows.
 */

import {
  PITCH_F0_MIN,
  PITCH_F0_MAX,
  PITCH_FFT_SIZE,
  PITCH_RING_CAPACITY,
  PITCH_VOICED_RMS,
} from "./config.js";
import { getSharedAudioContext, getSharedMediaStreamSource } from "./audio-level.js";

let analyser = null;
let dataArray = null;
let rafId = null;
// Circular ring of {t, hz}. t is performance.now() ms.
let ring = [];
let ringIdx = 0;
let detectorState = "idle"; // idle | running | failed

/**
 * Pure helper: estimate F0 from a time-domain Float32 buffer using normalized
 * autocorrelation with parabolic peak interpolation. Returns null when the
 * buffer is silent, or when no τ in [sampleRate/fmax, sampleRate/fmin]
 * produces a peak above the confidence threshold.
 */
export function autocorrelateF0(buf, sampleRate, fmin, fmax) {
  if (!buf || buf.length < 64 || !sampleRate) return null;

  // Voicing check — silent buffers produce noise pitch estimates.
  let r0 = 0;
  for (let i = 0; i < buf.length; i++) r0 += buf[i] * buf[i];
  const rms = Math.sqrt(r0 / buf.length);
  if (rms < PITCH_VOICED_RMS) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
  const tauMax = Math.min(Math.floor(sampleRate / fmin), Math.floor(buf.length / 2));
  if (tauMax <= tauMin) return null;

  let bestTau = -1;
  let bestCorr = -Infinity;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let corr = 0;
    const limit = buf.length - tau;
    for (let i = 0; i < limit; i++) {
      corr += buf[i] * buf[i + tau];
    }
    if (corr > bestCorr) {
      bestCorr = corr;
      bestTau = tau;
    }
  }
  if (bestTau < 0 || r0 === 0) return null;

  const normalized = bestCorr / r0;
  if (normalized < 0.3) return null;

  const tauL = bestTau - 1;
  const tauR = bestTau + 1;
  if (tauL >= tauMin && tauR <= tauMax) {
    let cL = 0;
    let cR = 0;
    const limit = buf.length - tauR;
    for (let i = 0; i < limit; i++) {
      cL += buf[i] * buf[i + tauL];
      cR += buf[i] * buf[i + tauR];
    }
    const denom = 2 * (cL - 2 * bestCorr + cR);
    if (Math.abs(denom) > 1e-9) {
      const shift = (cL - cR) / denom;
      const refinedTau = bestTau + shift;
      if (refinedTau > 0) return sampleRate / refinedTau;
    }
  }
  return sampleRate / bestTau;
}

/**
 * Pure helper: median Hz across samples whose t falls in [nowMs - windowMs, nowMs].
 * Returns null when no in-window samples exist.
 */
export function medianInWindow(samples, nowMs, windowMs) {
  if (!samples || samples.length === 0) return null;
  const cutoff = nowMs - windowMs;
  const inWindow = [];
  for (const s of samples) {
    if (!s || s.hz === null || s.hz === undefined) continue;
    if (s.t >= cutoff) inWindow.push(s.hz);
  }
  if (inWindow.length === 0) return null;
  inWindow.sort((a, b) => a - b);
  const mid = Math.floor(inWindow.length / 2);
  if (inWindow.length % 2 === 0) {
    return (inWindow[mid - 1] + inWindow[mid]) / 2;
  }
  return inWindow[mid];
}

function pushSample(t, hz) {
  if (ring.length < PITCH_RING_CAPACITY) {
    ring.push({ t, hz });
  } else {
    ring[ringIdx] = { t, hz };
    ringIdx = (ringIdx + 1) % PITCH_RING_CAPACITY;
  }
}

function tick() {
  if (detectorState !== "running" || !analyser || !dataArray) return;
  const ctx = getSharedAudioContext();
  if (ctx) {
    analyser.getFloatTimeDomainData(dataArray);
    const f0 = autocorrelateF0(dataArray, ctx.sampleRate, PITCH_F0_MIN, PITCH_F0_MAX);
    if (f0 !== null && f0 >= PITCH_F0_MIN && f0 <= PITCH_F0_MAX) {
      pushSample(performance.now(), f0);
    }
  }
  rafId = requestAnimationFrame(tick);
}

/**
 * Start the pitch detector. Idempotent; soft-fails open when the shared
 * audio graph isn't running (e.g. iOS, denial). Returns true on success.
 */
export function startPitchDetector() {
  if (detectorState === "running") return true;
  const ctx = getSharedAudioContext();
  const source = getSharedMediaStreamSource();
  if (!ctx || !source) {
    detectorState = "failed";
    return false;
  }
  try {
    analyser = ctx.createAnalyser();
    analyser.fftSize = PITCH_FFT_SIZE;
    dataArray = new Float32Array(analyser.fftSize);
    source.connect(analyser);
    detectorState = "running";
    rafId = requestAnimationFrame(tick);
    return true;
  } catch (_e) {
    detectorState = "failed";
    analyser = null;
    dataArray = null;
    return false;
  }
}

/**
 * Stop the detector. Does not close the shared audio graph — audio-level.js
 * owns that. Idempotent.
 */
export function stopPitchDetector() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (analyser) {
    try { analyser.disconnect(); } catch (_e) { /* ignore */ }
  }
  analyser = null;
  dataArray = null;
  ring = [];
  ringIdx = 0;
  detectorState = "idle";
}

/**
 * Stats over the last windowMs: median Hz, sample count, raw values.
 * Returns { median: null, n: 0, samples: [] } when nothing in window.
 */
export function getRecentPitchStats(windowMs) {
  const now = performance.now();
  const cutoff = now - windowMs;
  const values = [];
  for (const s of ring) {
    if (!s || s.hz === null || s.hz === undefined) continue;
    if (s.t >= cutoff) values.push(s.hz);
  }
  if (values.length === 0) return { median: null, n: 0, samples: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
  return { median, n: values.length, samples: values };
}

/**
 * Raw F0 samples in the recent window — used by enrollment to compute the
 * voiceprint mean + stddev directly from observations.
 */
export function getRecentPitchSamples(windowMs) {
  const cutoff = performance.now() - windowMs;
  const out = [];
  for (const s of ring) {
    if (!s || s.hz === null || s.hz === undefined) continue;
    if (s.t >= cutoff) out.push(s.hz);
  }
  return out;
}

/**
 * Test seam — inject a sample without an AudioContext.
 */
export function _pushPitchForTest(t, hz) {
  pushSample(t, hz);
  detectorState = "running";
}

export function _resetForTest() {
  ring = [];
  ringIdx = 0;
  detectorState = "idle";
  analyser = null;
  dataArray = null;
}
