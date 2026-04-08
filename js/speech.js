/**
 * Speech-to-text module using Web Speech API.
 * Configured for Spanish (es-ES), continuous recognition with interim results.
 */

let recognition = null;
let isListening = false;

/**
 * Check if the browser supports speech recognition.
 * @returns {boolean}
 */
export function isSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Create and configure a speech recognition instance.
 * @param {object} callbacks
 * @param {function} callbacks.onInterim - called with interim text as the user speaks
 * @param {function} callbacks.onFinal - called with final transcribed text
 * @param {function} callbacks.onError - called with error event
 * @param {function} callbacks.onStateChange - called with boolean (true=listening)
 * @returns {boolean} true if started successfully
 */
export async function startListening({ onInterim, onFinal, onError, onStateChange }) {
  if (!isSupported()) {
    onError?.({ error: "not-supported", message: "Speech recognition not supported in this browser" });
    return false;
  }

  // Request mic permission before starting speech recognition
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop the stream immediately - we just needed the permission
    stream.getTracks().forEach((track) => track.stop());
  } catch (_e) {
    onError?.({ error: "not-allowed", message: "Microphone permission denied. Enable it in browser settings." });
    return false;
  }

  if (recognition) {
    recognition.abort();
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = "es-ES";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;

      if (result.isFinal) {
        onFinal?.(text);
      } else {
        onInterim?.(text);
      }
    }
  };

  recognition.onerror = (event) => {
    // "no-speech" and "aborted" are not real errors - just restart
    if (event.error === "no-speech" || event.error === "aborted") {
      return;
    }
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      isListening = false;
      onError?.({
        error: event.error,
        message: "Microphone permission denied. Check browser settings and ensure you're using Chrome/Edge.",
      });
      return;
    }
    onError?.(event);
  };

  recognition.onend = () => {
    // Auto-restart if we're still supposed to be listening
    if (isListening) {
      try {
        recognition.start();
      } catch (_e) {
        // May fail if already started, ignore
      }
    } else {
      onStateChange?.(false);
    }
  };

  recognition.onstart = () => {
    onStateChange?.(true);
  };

  try {
    recognition.start();
    isListening = true;
    return true;
  } catch (_e) {
    onError?.({ error: "start-failed", message: "Failed to start speech recognition" });
    return false;
  }
}

/**
 * Stop listening.
 */
export function stopListening() {
  isListening = false;
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
}

/**
 * Toggle listening on/off.
 * @param {object} callbacks - same as startListening
 * @returns {boolean} new listening state
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
