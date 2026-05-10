/**
 * Speech-to-text module using Web Speech API.
 * Configured for Spanish (es-ES) with interim results.
 * Uses non-continuous mode with auto-restart for mobile compatibility.
 */

import { dlog } from "./debug.js";

let recognition = null;
let isListening = false;
let restartTimer = null;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// iOS only exposes webkitSpeechRecognition to Safari. Chrome/Firefox/Edge on
// iPhone wrap WebKit but Apple withholds the speech service from them, so the
// constructor exists yet start() fires "service-not-allowed" instantly.
const isIOSNonSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) &&
  /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/.test(navigator.userAgent);
const MOBILE_RESTART_DELAY = 500; // ms to wait before restarting on mobile

/**
 * Check if the browser supports speech recognition.
 * @returns {boolean}
 */
export function isSupported() {
  if (isIOSNonSafari) return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Returns a stable reason code when speech recognition won't work on this
 * browser, or null when it should. Lets the UI surface a tailored message
 * (e.g. "open in Safari") instead of a generic "no compatible".
 *   "ios-non-safari" — iPhone Chrome/Firefox/Edge: Safari-only on iOS
 *   "no-api"         — no SpeechRecognition constructor at all
 */
export function getUnsupportedReason() {
  if (isIOSNonSafari) return "ios-non-safari";
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return "no-api";
  return null;
}

/**
 * Create a fresh recognition instance and wire up callbacks.
 */
function createRecognition(callbacks) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.lang = "es-ES";
  // Mobile Chrome throws "service-not-allowed" with continuous=true
  rec.continuous = !isMobile;
  rec.interimResults = true;

  rec.onresult = (event) => {
    dlog("speech", "onresult results=" + event.results.length, "idx=" + event.resultIndex);
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;

      if (result.isFinal) {
        dlog("speech", "final:", text);
        callbacks.onFinal?.(text);
      } else {
        dlog("speech", "interim:", text);
        callbacks.onInterim?.(text);
      }
    }
  };

  rec.onerror = (event) => {
    dlog("speech", "onerror:", event.error || "(unknown)", event.message || "");
    if (event.error === "no-speech" || event.error === "aborted") {
      return;
    }
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      isListening = false;
      recognition = null;
      callbacks.onError?.({
        error: event.error,
        message: "Servicio de voz no disponible. Reinicia el navegador.",
      });
      callbacks.onStateChange?.(false);
      return;
    }
    callbacks.onError?.(event);
  };

  rec.onend = () => {
    dlog("speech", "onend isListening=" + isListening);
    // Auto-restart if we're still supposed to be listening
    if (isListening) {
      const restart = () => {
        if (!isListening) {
          callbacks.onStateChange?.(false);
          return;
        }
        try {
          recognition = createRecognition(callbacks);
          recognition.start();
          dlog("speech", "restart ok");
        } catch (e) {
          dlog("speech", "restart failed:", e && e.message ? e.message : String(e));
          isListening = false;
          callbacks.onStateChange?.(false);
        }
      };

      if (isMobile) {
        // Delay restart on mobile to prevent rapid cycling
        restartTimer = setTimeout(restart, MOBILE_RESTART_DELAY);
      } else {
        restart();
      }
    } else {
      callbacks.onStateChange?.(false);
    }
  };

  rec.onstart = () => {
    dlog("speech", "onstart");
    callbacks.onStateChange?.(true);
  };

  rec.onaudiostart = () => dlog("speech", "onaudiostart");
  rec.onaudioend = () => {
    dlog("speech", "onaudioend isListening=" + isListening);
    // On mobile, suppress the brief "off" state between restart cycles
    // so the UI doesn't flicker
    if (isMobile && isListening) {
      callbacks.onStateChange?.(true);
    }
  };
  rec.onspeechstart = () => dlog("speech", "onspeechstart");
  rec.onspeechend = () => dlog("speech", "onspeechend");
  rec.onnomatch = () => dlog("speech", "onnomatch");
  rec.onsoundstart = () => dlog("speech", "onsoundstart");
  rec.onsoundend = () => dlog("speech", "onsoundend");

  return rec;
}

/**
 * Start listening for speech.
 * @param {object} callbacks
 * @param {function} callbacks.onInterim - called with interim text
 * @param {function} callbacks.onFinal - called with final transcribed text
 * @param {function} callbacks.onError - called with error event
 * @param {function} callbacks.onStateChange - called with boolean (true=listening)
 * @returns {Promise<boolean>} true if started successfully
 */
export async function startListening(callbacks) {
  if (!isSupported()) {
    dlog("speech", "startListening: not-supported");
    callbacks.onError?.({ error: "not-supported", message: "Reconocimiento de voz no compatible con este navegador" });
    return false;
  }

  // Request mic permission before starting speech recognition.
  // Skipped on mobile: the await boundary breaks the user-gesture chain that
  // webkitSpeechRecognition.start() needs (iOS Safari/Chrome), and on Android
  // Chrome, opening a getUserMedia stream right before start() is one of the
  // failure modes that surfaces as "service-not-allowed". Letting
  // recognition.start() request permission itself works around both quirks.
  if (!isMobile) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      dlog("speech", "getUserMedia ok");
    } catch (e) {
      dlog("speech", "getUserMedia denied:", e && e.name ? e.name : String(e));
      callbacks.onError?.({ error: "not-allowed", message: "Permiso de microfono denegado. Activalo en ajustes del navegador." });
      return false;
    }
  }

  if (recognition) {
    try { recognition.abort(); } catch (_e) { /* ignore */ }
  }


  recognition = createRecognition(callbacks);

  try {
    recognition.start();
    isListening = true;
    dlog("speech", "start() ok continuous=" + recognition.continuous);
    return true;
  } catch (e) {
    dlog("speech", "start() threw:", e && e.message ? e.message : String(e));
    callbacks.onError?.({ error: "start-failed", message: "No se pudo iniciar: " + (e && e.message ? e.message : e) });
    return false;
  }
}

/**
 * Stop listening.
 */
export function stopListening() {
  isListening = false;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (recognition) {
    try { recognition.stop(); } catch (_e) { /* ignore */ }
    recognition = null;
  }
}

/**
 * Toggle listening on/off.
 * @param {object} callbacks - same as startListening
 * @returns {Promise<boolean>} new listening state
 */
export async function toggleListening(callbacks) {
  if (isListening) {
    stopListening();
    callbacks.onStateChange?.(false);
    return false;
  } else {
    return await startListening(callbacks);
  }
}

/**
 * Get current listening state.
 * @returns {boolean}
 */
export function getIsListening() {
  return isListening;
}
