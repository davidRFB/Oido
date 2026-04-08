/**
 * Speech-to-text module using Web Speech API.
 * Configured for Spanish (es-ES) with interim results.
 * Uses non-continuous mode with auto-restart for mobile compatibility.
 */

let recognition = null;
let isListening = false;
let restartTimer = null;
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const MOBILE_RESTART_DELAY = 500; // ms to wait before restarting on mobile

/**
 * Check if the browser supports speech recognition.
 * @returns {boolean}
 */
export function isSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
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
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;

      if (result.isFinal) {
        callbacks.onFinal?.(text);
      } else {
        callbacks.onInterim?.(text);
      }
    }
  };

  rec.onerror = (event) => {
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
        } catch (_e) {
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
    callbacks.onStateChange?.(true);
  };

  rec.onaudioend = () => {
    // On mobile, suppress the brief "off" state between restart cycles
    // so the UI doesn't flicker
    if (isMobile && isListening) {
      callbacks.onStateChange?.(true);
    }
  };

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
    callbacks.onError?.({ error: "not-supported", message: "Reconocimiento de voz no compatible con este navegador" });
    return false;
  }

  // Request mic permission before starting speech recognition
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (_e) {
    callbacks.onError?.({ error: "not-allowed", message: "Permiso de microfono denegado. Activalo en ajustes del navegador." });
    return false;
  }

  if (recognition) {
    try { recognition.abort(); } catch (_e) { /* ignore */ }
  }


  recognition = createRecognition(callbacks);

  try {
    recognition.start();
    isListening = true;
    return true;
  } catch (_e) {
    callbacks.onError?.({ error: "start-failed", message: "No se pudo iniciar el reconocimiento de voz" });
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
