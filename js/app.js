import {
  validatePassword,
  createUser,
  saveUser,
  loadUser,
  getColorPalette,
  getOrCreateUserId,
  saveVoiceprint,
  loadVoiceprint,
  needsEnrollment,
} from "./auth.js";
import {
  initFirebase,
  sendMessage,
  onMessage,
  registerPresence,
  renderMessage,
  clearMessages,
  onMessagesCleared,
  saveUserProfile,
} from "./chat.js";
import { isSupported, toggleListening } from "./speech.js";
import { startAudioLevelMonitor, shouldSend, getCurrentLevel } from "./audio-level.js";
import {
  startPitchDetector,
  getRecentPitchSamples,
  getRecentPitchStats,
  inPitchBand,
} from "./pitch.js";
import { shouldRenderIncoming } from "./dedup.js";
import {
  AUDIO_GATE_THRESHOLD,
  ENROLLMENT_DURATION_MS,
  ENROLLMENT_MIN_SAMPLES,
  PITCH_WINDOW_MS,
  PITCH_TOLERANCE_STDDEV,
  PITCH_MIN_SAMPLES,
} from "./config.js";
import { dlog, initDebugOverlay, bumpCounter } from "./debug.js";

// DOM elements
const passwordScreen = document.getElementById("password-screen");
const setupScreen = document.getElementById("setup-screen");
const enrollmentScreen = document.getElementById("enrollment-screen");
const chatScreen = document.getElementById("chat-screen");

const passwordInput = document.getElementById("password-input");
const passwordBtn = document.getElementById("password-btn");
const passwordError = document.getElementById("password-error");

const nameInput = document.getElementById("name-input");
const colorPicker = document.getElementById("color-picker");
const readonlyToggle = document.getElementById("readonly-toggle");
const setupBtn = document.getElementById("setup-btn");
const setupError = document.getElementById("setup-error");

const enrollmentRecordBtn = document.getElementById("enrollment-record-btn");
const enrollmentContinueBtn = document.getElementById("enrollment-continue-btn");
const enrollmentStatus = document.getElementById("enrollment-status");
const enrollmentPitch = document.getElementById("enrollment-pitch");
const enrollmentError = document.getElementById("enrollment-error");
const enrollmentLevelBarFill = document.getElementById("enrollment-level-bar-fill");

const chatMessages = document.getElementById("chat-messages");
const chatFooter = document.querySelector(".chat-footer");
const micBtn = document.getElementById("mic-btn");
const micStatus = document.getElementById("mic-status");
const usersBtn = document.getElementById("users-btn");
const usersCount = document.getElementById("users-count");
const usersList = document.getElementById("users-list");
const fontDecrease = document.getElementById("font-decrease");
const fontIncrease = document.getElementById("font-increase");
const clearBtn = document.getElementById("clear-btn");

let currentUser = null;
let selectedColor = null;
let interimElement = null;
let cachedVoiceprint = null;

// ===== Font Size Control =====
const FONT_SIZES = [0.9, 1, 1.15, 1.3, 1.5, 1.8, 2.2];
let fontSizeIndex = 1; // default 1rem

fontDecrease.addEventListener("click", () => {
  if (fontSizeIndex > 0) {
    fontSizeIndex--;
    chatMessages.style.fontSize = FONT_SIZES[fontSizeIndex] + "rem";
  }
});

fontIncrease.addEventListener("click", () => {
  if (fontSizeIndex < FONT_SIZES.length - 1) {
    fontSizeIndex++;
    chatMessages.style.fontSize = FONT_SIZES[fontSizeIndex] + "rem";
  }
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Limpiar todos los mensajes para todos?")) return;
  clearBtn.disabled = true;
  try {
    await clearMessages();
    chatMessages.innerHTML = "";
    interimElement = null;
  } catch (err) {
    console.error("Clear failed:", err);
    alert("No se pudo limpiar el chat");
  } finally {
    clearBtn.disabled = false;
  }
});

// ===== Screen Navigation =====

function showScreen(screen) {
  [passwordScreen, setupScreen, enrollmentScreen, chatScreen].forEach((s) => s.classList.remove("active"));
  screen.classList.add("active");
}

// ===== Password Screen =====

async function handlePassword() {
  const value = passwordInput.value;
  passwordBtn.disabled = true;
  if (await validatePassword(value)) {
    passwordError.textContent = "";
    // Returning user — name + color survived in localStorage. Skip setup, and
    // skip enrollment too if they're either read-only or already have a saved
    // voiceprint. This is the no-friction repeat-visit path.
    const savedUser = loadUser();
    if (savedUser && (savedUser.readOnly || loadVoiceprint())) {
      savedUser.userId = getOrCreateUserId();
      currentUser = savedUser;
      enterChat();
    } else {
      showScreen(setupScreen);
      nameInput.focus();
    }
  } else {
    passwordError.textContent = "Clave incorrecta";
    passwordInput.value = "";
    passwordInput.focus();
  }
  passwordBtn.disabled = false;
}

passwordBtn.addEventListener("click", handlePassword);
passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handlePassword();
});

// ===== Setup Screen =====

function renderColorPicker() {
  const palette = getColorPalette();
  palette.forEach((color) => {
    const btn = document.createElement("button");
    btn.className = "color-option";
    btn.style.backgroundColor = color.value;
    btn.title = color.name;
    btn.setAttribute("aria-label", color.name);
    btn.addEventListener("click", () => {
      colorPicker.querySelectorAll(".color-option").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedColor = color.value;
    });
    colorPicker.appendChild(btn);
  });
}

async function handleSetup() {
  const user = createUser(nameInput.value, selectedColor, readonlyToggle.checked);
  if (!user) {
    setupError.textContent = "Ingresa tu nombre y elige un color";
    return;
  }
  setupError.textContent = "";
  user.userId = getOrCreateUserId();
  currentUser = user;
  saveUser(user);

  // Read-only users (deaf family member) don't speak, so they skip enrollment.
  if (user.readOnly || !needsEnrollment()) {
    enterChat();
    return;
  }

  showScreen(enrollmentScreen);
  enrollmentError.textContent = "";
  enrollmentPitch.textContent = "";
  enrollmentRecordBtn.disabled = true;
  enrollmentContinueBtn.disabled = true;
  enrollmentStatus.textContent = "Iniciando microfono...";
  startEnrollmentLevelLoop();
  // Prime the shared mic + pitch detector here so the recording is ready
  // before the user taps Grabar. Soft-fails report a friendly error.
  const ok = await startAudioLevelMonitor();
  if (ok) startPitchDetector();
  enrollmentStatus.textContent = ok
    ? "Toca grabar y lee la frase"
    : "Microfono no disponible. Revisa permisos.";
  enrollmentRecordBtn.disabled = !ok;
}

setupBtn.addEventListener("click", handleSetup);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSetup();
});

renderColorPicker();

// ===== Enrollment Screen =====

let pendingVoiceprint = null;

function startEnrollmentLevelLoop() {
  if (!enrollmentLevelBarFill) return;
  const tick = () => {
    if (!enrollmentScreen.classList.contains("active")) return;
    const lvl = getCurrentLevel();
    enrollmentLevelBarFill.style.width = Math.min(100, Math.round(lvl * 200)) + "%";
    enrollmentLevelBarFill.classList.toggle("above-threshold", lvl >= AUDIO_GATE_THRESHOLD);
    const stats = getRecentPitchStats(500);
    if (stats.median !== null) {
      enrollmentPitch.textContent = Math.round(stats.median) + " Hz";
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function handleEnrollmentRecord() {
  enrollmentError.textContent = "";
  enrollmentRecordBtn.disabled = true;
  enrollmentContinueBtn.disabled = true;
  pendingVoiceprint = null;

  const total = ENROLLMENT_DURATION_MS;
  const startedAt = performance.now();
  enrollmentStatus.textContent = "Habla... " + Math.ceil(total / 1000);
  const interval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((total - (performance.now() - startedAt)) / 1000));
    enrollmentStatus.textContent = remaining > 0 ? "Habla... " + remaining : "Procesando...";
  }, 250);

  await new Promise((r) => setTimeout(r, total));
  clearInterval(interval);

  // The pitch ring filters by time, so passing the recording duration as the
  // window naturally excludes anything observed before recording started.
  const samples = getRecentPitchSamples(performance.now() - startedAt + 50);
  if (samples.length < ENROLLMENT_MIN_SAMPLES) {
    enrollmentError.textContent =
      "Pocas muestras (" + samples.length + "). Intenta hablar mas fuerte o mas cerca del microfono.";
    enrollmentStatus.textContent = "Toca grabar y lee la frase";
    enrollmentRecordBtn.disabled = false;
    return;
  }

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length;
  const stddev = Math.sqrt(variance);
  pendingVoiceprint = {
    f0_mean: mean,
    f0_stddev: stddev,
    f0_samples: samples.length,
    enrolled_at: Date.now(),
  };

  enrollmentStatus.textContent =
    "Listo: " + Math.round(mean) + " Hz, " + samples.length + " muestras";
  enrollmentRecordBtn.disabled = false;
  enrollmentContinueBtn.disabled = false;
}

function handleEnrollmentContinue() {
  if (!pendingVoiceprint) return;
  saveVoiceprint(pendingVoiceprint);
  enterChat();
}

enrollmentRecordBtn.addEventListener("click", handleEnrollmentRecord);
enrollmentContinueBtn.addEventListener("click", handleEnrollmentContinue);

// ===== Chat Screen =====

function startMicLevelBarLoop() {
  const fill = document.getElementById("mic-level-bar-fill");
  if (!fill) return;
  const tick = () => {
    const lvl = getCurrentLevel();
    // Map 0..0.5 RMS to 0..100% so normal speech fills most of the bar.
    fill.style.width = Math.min(100, Math.round(lvl * 200)) + "%";
    fill.classList.toggle("above-threshold", lvl >= AUDIO_GATE_THRESHOLD);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function enterChat() {
  showScreen(chatScreen);
  initFirebase();
  initDebugOverlay();

  // Mirror the local voiceprint into the user profile so peers can resolve
  // userId -> name/color (and later, voiceprint when we want cross-device
  // sync). Local pitch gate uses this cached copy directly — Firebase is
  // not in the hot path.
  cachedVoiceprint = loadVoiceprint();
  if (cachedVoiceprint) currentUser.voiceprint = cachedVoiceprint;

  // Best-effort profile sync. Failures (offline, rules) are logged but don't
  // block entering chat.
  saveUserProfile(currentUser).catch((err) => {
    console.warn("saveUserProfile failed:", err);
  });

  // Persistent mic for the audio gate. Soft-fails on iOS and on denial —
  // shouldSend() returns true when the monitor isn't running, so the app
  // keeps working with the gate effectively bypassed. The pitch detector
  // attaches to the same audio graph; it also soft-fails open.
  startAudioLevelMonitor()
    .then((ok) => { if (ok) startPitchDetector(); })
    .catch(() => { /* gate stays open, pitch detector stays idle */ });
  startMicLevelBarLoop();

  // Listen for messages
  onMessage((message) => {
    // Remove interim element if this is a final message from same user
    if (message.isFinal && interimElement && message.name === currentUser.name) {
      interimElement.remove();
      interimElement = null;
    }
    // Cross-device dedup: same utterance picked up by multiple phones in
    // the room. shouldRenderIncoming records into the ring even when it
    // returns false, so a third device's copy is suppressed too.
    if (message.isFinal && !shouldRenderIncoming(message, currentUser.name)) {
      dlog("recv", "DEDUP-DROP", message.name, message.text);
      bumpCounter("dropped", `dedup-drop: ${message.name}: ${message.text}`);
      return;
    }
    if (message.isFinal) {
      dlog("recv", message.name, message.text);
      bumpCounter("recv", `recv: ${message.name}: ${message.text}`);
    }
    renderMessage(chatMessages, message);
  });

  // Clear DOM when any user clears the chat
  onMessagesCleared(() => {
    chatMessages.innerHTML = "";
    interimElement = null;
  });

  // Register presence
  registerPresence(currentUser, (users) => {
    usersCount.textContent = users.length;
    usersList.innerHTML = "";
    users.forEach((u) => {
      const item = document.createElement("div");
      item.className = "users-list-item";
      const dot = document.createElement("span");
      dot.className = "user-dot";
      dot.style.backgroundColor = u.color;
      const name = document.createElement("span");
      name.textContent = u.name;
      item.appendChild(dot);
      item.appendChild(name);
      usersList.appendChild(item);
    });
  });

  // Toggle users list dropdown
  usersBtn.addEventListener("click", () => {
    usersList.classList.toggle("hidden");
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!usersBtn.contains(e.target) && !usersList.contains(e.target)) {
      usersList.classList.add("hidden");
    }
  });

  // Hide mic for read-only users, auto-start for speakers
  if (currentUser.readOnly) {
    chatFooter.classList.add("hidden");
  } else if (!isSupported()) {
    micStatus.textContent = "Navegador no compatible";
    micBtn.disabled = true;
  } else {
    // Auto-start listening
    micBtn.click();
  }
}

// ===== Mic Toggle =====

micBtn.addEventListener("click", async () => {
  micBtn.disabled = true;
  const result = await toggleListening({
    onInterim: (text) => {
      if (interimElement) {
        interimElement.querySelector(".chat-text").textContent = text;
      } else {
        interimElement = renderMessage(chatMessages, {
          name: currentUser.name,
          color: currentUser.color,
          text: text,
          isFinal: false,
          timestamp: Date.now(),
        });
      }
    },

    onFinal: (text) => {
      if (interimElement) {
        interimElement.remove();
        interimElement = null;
      }
      // Drop transcripts captured while local mic was quiet — almost
      // certainly someone else's voice picked up across the room.
      if (!shouldSend()) {
        dlog("send", "GATE-DROP", text);
        bumpCounter("dropped", `gate-drop: ${text}`);
        return;
      }
      // Pitch gate: drop when the recent F0 distribution doesn't match the
      // device owner's voiceprint. Default-allows when no voiceprint or too
      // few pitch samples — same soft-fail philosophy as the audio gate.
      if (cachedVoiceprint) {
        const stats = getRecentPitchStats(PITCH_WINDOW_MS);
        if (
          stats.n >= PITCH_MIN_SAMPLES &&
          stats.median !== null &&
          !inPitchBand(stats.median, cachedVoiceprint, PITCH_TOLERANCE_STDDEV)
        ) {
          dlog("send", "PITCH-DROP", text, Math.round(stats.median));
          bumpCounter("dropped", `pitch-drop: ${Math.round(stats.median)}Hz: ${text}`);
          return;
        }
      }
      dlog("send", text);
      bumpCounter("sent", `sent: ${text}`);
      sendMessage(currentUser, text, true);
    },

    onError: (event) => {
      console.error("Speech error:", event);
      micStatus.textContent = "Error: " + (event.message || event.error);
      micBtn.classList.remove("listening");
    },

    onStateChange: (listening) => {
      if (listening) {
        micBtn.classList.add("listening");
        micStatus.textContent = "Escuchando...";
      } else {
        micBtn.classList.remove("listening");
        micStatus.textContent = "Toca para hablar";
      }
    },
  });
  micBtn.disabled = false;

  if (result) {
    micBtn.classList.add("listening");
    micStatus.textContent = "Escuchando...";
  } else {
    micBtn.classList.remove("listening");
    micStatus.textContent = "Toca para hablar";
  }
});

