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
 * Pure helper: estimate F0 from a time-domain Float32 buffer.
 *
 * Two corrections vs naive autocorrelation:
 *   1. Per-pair normalization (corr / (N - τ)) — without it, smaller τ
 *      accumulates more terms and wins by default on noisy real-world audio,
 *      locking the detector to high frequencies for low-pitched speech.
 *   2. Lowest-octave bias — at integer multiples of the true period
 *      (τ, 2τ, 3τ, …) the coefficient is identical in theory and only
 *      differs by float-point rounding. Picking the smallest τ that's a
 *      local maximum within 85% of the global best avoids spurious
 *      sub-octave detections like reporting 167 Hz for a 250 Hz signal.
 *
 * Returns null when the buffer is silent or the best peak doesn't clear
 * the confidence floor.
 */
export function autocorrelateF0(buf, sampleRate, fmin, fmax) {
  if (!buf || buf.length < 64 || !sampleRate) return null;

  let r0 = 0;
  for (let i = 0; i < buf.length; i++) r0 += buf[i] * buf[i];
  const rms = Math.sqrt(r0 / buf.length);
  if (rms < PITCH_VOICED_RMS) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / fmax));
  const tauMax = Math.min(Math.floor(sampleRate / fmin), Math.floor(buf.length / 2));
  if (tauMax <= tauMin + 1) return null;

  const energyPerSample = r0 / buf.length;
  if (energyPerSample === 0) return null;

  const span = tauMax - tauMin + 1;
  const coeffs = new Float32Array(span);
  let globalBest = -Infinity;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let corr = 0;
    const limit = buf.length - tau;
    for (let i = 0; i < limit; i++) {
      corr += buf[i] * buf[i + tau];
    }
    const coeff = (corr / limit) / energyPerSample;
    coeffs[tau - tauMin] = coeff;
    if (coeff > globalBest) globalBest = coeff;
  }
  if (globalBest < 0.3) return null;

  // Smallest local-maximum tau within 85% of the global best.
  const acceptance = globalBest * 0.85;
  let bestTau = -1;
  for (let i = 1; i < span - 1; i++) {
    const c = coeffs[i];
    if (c >= acceptance && c >= coeffs[i - 1] && c >= coeffs[i + 1]) {
      bestTau = i + tauMin;
      break;
    }
  }
  if (bestTau < 0) {
    // No clean local max — fall back to global argmax. Rare in practice.
    for (let i = 0; i < span; i++) {
      if (coeffs[i] === globalBest) { bestTau = i + tauMin; break; }
    }
  }

  // Parabolic interpolation using the cached coefficient triple.
  const idx = bestTau - tauMin;
  if (idx > 0 && idx < span - 1) {
    const nL = coeffs[idx - 1];
    const nC = coeffs[idx];
    const nR = coeffs[idx + 1];
    const denom = 2 * (nL - 2 * nC + nR);
    if (Math.abs(denom) > 1e-9) {
      const shift = (nL - nR) / denom;
      const refinedTau = bestTau + shift;
      if (refinedTau > 0) return sampleRate / refinedTau;
    }
  }
  return sampleRate / bestTau;
}

/**
 * Pure helper: returns true when median Hz lies within
 * voiceprint.f0_mean +/- toleranceStddev * stddev. Default-allows (returns
 * true) when median is null or the voiceprint is missing/invalid so the gate
 * degrades to the existing audio-level behavior. The stddev floor stops a
 * too-stable enrollment (a low f0_stddev) from producing an absurdly tight
 * band that rejects normal speech variation.
 */
export function inPitchBand(median, voiceprint, toleranceStddev, minStddev = 8) {
  if (median === null || median === undefined || !Number.isFinite(median)) return true;
  if (!voiceprint || typeof voiceprint.f0_mean !== "number" || typeof voiceprint.f0_stddev !== "number") {
    return true;
  }
  const stddev = Math.max(voiceprint.f0_stddev, minStddev);
  return Math.abs(median - voiceprint.f0_mean) <= toleranceStddev * stddev;
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
