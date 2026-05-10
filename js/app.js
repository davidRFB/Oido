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
  markAuthFresh,
  isAuthFresh,
  clearAuthFresh,
} from "./auth.js";
import {
  initFirebase,
  sendMessage,
  onMessage,
  registerPresence,
  updatePresence,
  renderMessage,
  clearMessages,
  onMessagesCleared,
  saveUserProfile,
} from "./chat.js";
import { isSupported, toggleListening, stopListening, getIsListening } from "./speech.js";
import {
  startAudioLevelMonitor,
  stopAudioLevelMonitor,
  shouldSend,
  getCurrentLevel,
  isMonitorDegraded,
  getMonitorPeakEver,
} from "./audio-level.js";
import {
  startPitchDetector,
  stopPitchDetector,
  getRecentPitchSamples,
  getRecentPitchStats,
  inPitchBand,
} from "./pitch.js";
import { shouldRenderIncoming } from "./dedup.js";
import {
  AUDIO_GATE_THRESHOLD,
  ENROLLMENT_DURATION_MS,
  ENROLLMENT_MIN_SAMPLES,
  ENROLLMENT_PHRASES,
  PITCH_WINDOW_MS,
  PITCH_TOLERANCE_STDDEV,
  PITCH_MIN_SAMPLES,
} from "./config.js";
import {
  dlog,
  initDebugOverlay,
  bumpCounter,
  updatePitchStats,
  getRecentLogsAsText,
  getCapabilities,
  getMicPermission,
} from "./debug.js";

// DOM elements
const passwordScreen = document.getElementById("password-screen");
const setupScreen = document.getElementById("setup-screen");
const enrollmentScreen = document.getElementById("enrollment-screen");
const chatScreen = document.getElementById("chat-screen");

const passwordInput = document.getElementById("password-input");
const passwordBtn = document.getElementById("password-btn");
const passwordError = document.getElementById("password-error");

const setupTitle = document.getElementById("setup-title");
const nameInput = document.getElementById("name-input");
const colorPicker = document.getElementById("color-picker");
const readonlyToggle = document.getElementById("readonly-toggle");
const readonlyToggleLabel = document.getElementById("readonly-toggle-label");
const setupBtn = document.getElementById("setup-btn");
const setupCancelBtn = document.getElementById("setup-cancel-btn");
const setupError = document.getElementById("setup-error");

const enrollmentRecordBtn = document.getElementById("enrollment-record-btn");
const enrollmentContinueBtn = document.getElementById("enrollment-continue-btn");
const enrollmentStatus = document.getElementById("enrollment-status");
const enrollmentPitch = document.getElementById("enrollment-pitch");
const enrollmentError = document.getElementById("enrollment-error");
const enrollmentPhraseEl = document.getElementById("enrollment-phrase");
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
const userPill = document.getElementById("user-pill");
const userPillDot = document.getElementById("user-pill-dot");
const userPillName = document.getElementById("user-pill-name");
const settingsBtn = document.getElementById("settings-btn");
const settingsList = document.getElementById("settings-list");
const settingsEditProfile = document.getElementById("settings-edit-profile");
const settingsRerecord = document.getElementById("settings-rerecord");
const settingsDiagnostics = document.getElementById("settings-diagnostics");
const settingsLogout = document.getElementById("settings-logout");
const settingsClear = document.getElementById("settings-clear");

const supportBanner = document.getElementById("support-banner");
const supportBannerText = document.getElementById("support-banner-text");
const supportBannerBtn = document.getElementById("support-banner-btn");

const diagModal = document.getElementById("diag-modal");
const diagBackdrop = document.getElementById("diag-backdrop");
const diagCloseBtn = document.getElementById("diag-close-btn");
const diagCopyBtn = document.getElementById("diag-copy-btn");
const diagRefreshBtn = document.getElementById("diag-refresh-btn");
const diagCaps = document.getElementById("diag-caps");
const diagState = document.getElementById("diag-state");
const diagLogs = document.getElementById("diag-logs");

let currentUser = null;
let selectedColor = null;
let interimElement = null;
let cachedVoiceprint = null;
let isReEnrolling = false;
let isEditingProfile = false;
let audioMonitorAttempted = false;

// Bring the audio gate online after speech recognition is running. Idempotent
// per chat session — flag is reset in enterChat. Soft-fails: if the platform
// rejects a parallel getUserMedia (Android Chrome with active recognizer,
// iOS Safari), the monitor stays in "failed" state and shouldSend() defaults
// open, so the app keeps transcribing without the gate.
async function ensureAudioMonitor() {
  if (audioMonitorAttempted) return;
  audioMonitorAttempted = true;
  try {
    const ok = await startAudioLevelMonitor();
    dlog("audio", "monitor:", ok ? "running" : "failed");
    if (ok) {
      const pitchOk = startPitchDetector();
      dlog("pitch", "detector:", pitchOk ? "running" : "failed");
    }
  } catch (_e) {
    /* gate stays open, pitch detector stays idle */
  }
}

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

settingsClear.addEventListener("click", async () => {
  closeSettings();
  if (!confirm("Limpiar todos los mensajes para todos?")) return;
  settingsClear.disabled = true;
  try {
    await clearMessages();
    chatMessages.innerHTML = "";
    interimElement = null;
  } catch (err) {
    console.error("Clear failed:", err);
    alert("No se pudo limpiar el chat");
  } finally {
    settingsClear.disabled = false;
  }
});

// ===== Settings Dropdown =====

function openSettings() {
  settingsList.classList.remove("hidden");
  settingsBtn.setAttribute("aria-expanded", "true");
}

function closeSettings() {
  settingsList.classList.add("hidden");
  settingsBtn.setAttribute("aria-expanded", "false");
}

settingsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (settingsList.classList.contains("hidden")) {
    openSettings();
  } else {
    closeSettings();
  }
});

document.addEventListener("click", (e) => {
  if (!settingsBtn.contains(e.target) && !settingsList.contains(e.target)) {
    closeSettings();
  }
});

settingsRerecord.addEventListener("click", () => {
  closeSettings();
  startReEnrollment();
});

settingsEditProfile.addEventListener("click", () => {
  closeSettings();
  startProfileEdit();
});

settingsLogout.addEventListener("click", () => {
  closeSettings();
  if (!confirm("Cerrar sesión? Tendrás que ingresar la clave de nuevo.")) return;
  // Drop the auth-fresh stamp so tryAutoEnter won't bypass the password
  // screen on the next load. Hard-reload so Firebase listeners, mic state,
  // and all module-level vars reset cleanly. Saved name/color/voiceprint
  // stay in localStorage — re-entering the password lands you back in chat.
  clearAuthFresh();
  location.reload();
});

settingsDiagnostics.addEventListener("click", () => {
  closeSettings();
  openDiagnostics();
});

// ===== Diagnostic Modal =====

function rowHTML(label, value, cls) {
  const c = cls ? ` class="${cls}"` : "";
  return `<tr><td>${label}</td><td${c}>${value}</td></tr>`;
}

async function refreshDiagnostics() {
  const caps = getCapabilities();
  const micPerm = await getMicPermission();
  const speechRow = caps.speechApi
    ? rowHTML("Reconocimiento de voz", "Disponible", "diag-ok")
    : rowHTML("Reconocimiento de voz", "NO disponible", "diag-bad");
  const mediaRow = caps.mediaDevices
    ? rowHTML("Acceso al micrófono (API)", "Disponible", "diag-ok")
    : rowHTML("Acceso al micrófono (API)", "NO disponible", "diag-bad");
  const audioRow = caps.audioContext
    ? rowHTML("AudioContext", "Disponible", "diag-ok")
    : rowHTML("AudioContext", "NO disponible", "diag-bad");
  const onlineRow = caps.online
    ? rowHTML("Internet", "Conectado", "diag-ok")
    : rowHTML("Internet", "SIN conexión", "diag-bad");
  let permCls = "diag-warn";
  let permLabel = micPerm;
  if (micPerm === "granted") { permCls = "diag-ok"; permLabel = "Permitido"; }
  else if (micPerm === "denied") { permCls = "diag-bad"; permLabel = "Denegado"; }
  else if (micPerm === "prompt") { permCls = "diag-warn"; permLabel = "Pendiente"; }
  else { permCls = "diag-warn"; permLabel = "Desconocido"; }
  const permRow = rowHTML("Permiso del micrófono", permLabel, permCls);
  const uaRow = rowHTML("Navegador", caps.ua || "—");

  diagCaps.innerHTML = speechRow + mediaRow + audioRow + permRow + onlineRow + uaRow;

  const listening = getIsListening();
  const vp = loadVoiceprint();
  const degraded = isMonitorDegraded();
  const peakEver = getMonitorPeakEver();
  const gateRow = degraded
    ? rowHTML("Filtro de audio", "Degradado (bypass)", "diag-warn")
    : rowHTML("Filtro de audio", "Activo", "diag-ok");
  const peakRow = rowHTML(
    "Pico de mic registrado",
    peakEver > 0 ? peakEver.toFixed(4) : "0",
    peakEver > 0.005 ? "diag-ok" : "diag-warn",
  );
  const stateRows = [
    rowHTML("Modo solo lectura", currentUser && currentUser.readOnly ? "Sí" : "No",
      currentUser && currentUser.readOnly ? "diag-warn" : "diag-ok"),
    rowHTML("Voz registrada", vp ? `Sí (${Math.round(vp.f0_mean)} Hz)` : "No",
      vp ? "diag-ok" : "diag-warn"),
    rowHTML("Escuchando", listening ? "Sí" : "No", listening ? "diag-ok" : "diag-warn"),
    rowHTML("Estado del micrófono", micStatus.textContent || "—"),
    gateRow,
    peakRow,
  ];
  diagState.innerHTML = stateRows.join("");

  diagLogs.textContent = getRecentLogsAsText() || "(sin eventos aún)";
  // Auto-scroll the log to the bottom so the most recent line is visible.
  diagLogs.scrollTop = diagLogs.scrollHeight;
}

function openDiagnostics() {
  refreshDiagnostics();
  diagModal.classList.remove("hidden");
}

function closeDiagnostics() {
  diagModal.classList.add("hidden");
}

diagCloseBtn.addEventListener("click", closeDiagnostics);
diagBackdrop.addEventListener("click", closeDiagnostics);
diagRefreshBtn.addEventListener("click", refreshDiagnostics);
diagCopyBtn.addEventListener("click", async () => {
  const text = getRecentLogsAsText();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      diagCopyBtn.textContent = "Copiado!";
    } else {
      // Fallback for older mobile browsers without async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      diagCopyBtn.textContent = "Copiado!";
    }
  } catch (_e) {
    diagCopyBtn.textContent = "Error al copiar";
  }
  setTimeout(() => { diagCopyBtn.textContent = "Copiar registro"; }, 1800);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !diagModal.classList.contains("hidden")) {
    closeDiagnostics();
  }
});

// ===== Support Banner =====

function refreshSupportBanner() {
  if (!supportBanner) return;
  const caps = getCapabilities();
  const issues = [];
  if (!caps.speechApi) issues.push("reconocimiento de voz");
  if (!caps.mediaDevices) issues.push("micrófono");
  if (!caps.audioContext) issues.push("AudioContext");
  if (issues.length === 0) {
    supportBanner.classList.add("hidden");
    return;
  }
  supportBannerText.textContent =
    "Tu navegador no soporta: " + issues.join(", ") + ". El micrófono no funcionará.";
  supportBanner.classList.remove("hidden");
}

if (supportBannerBtn) {
  supportBannerBtn.addEventListener("click", () => openDiagnostics());
}

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
    markAuthFresh();
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

// On reload, if the password was validated within the last hour, jump
// straight past the password gate. Same routing rules as handlePassword:
// returning users with a voiceprint go to chat; first-time users to setup.
function tryAutoEnter() {
  if (!isAuthFresh()) return;
  const savedUser = loadUser();
  if (savedUser && (savedUser.readOnly || loadVoiceprint())) {
    savedUser.userId = getOrCreateUserId();
    currentUser = savedUser;
    enterChat();
  } else {
    showScreen(setupScreen);
    nameInput.focus();
  }
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
    btn.dataset.colorValue = color.value;
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

function selectColorInPicker(value) {
  selectedColor = null;
  colorPicker.querySelectorAll(".color-option").forEach((b) => {
    const match = b.dataset.colorValue === value;
    b.classList.toggle("selected", match);
    if (match) selectedColor = value;
  });
}

async function handleSetup() {
  if (isEditingProfile) {
    const trimmed = (nameInput.value || "").trim();
    if (!trimmed || !selectedColor) {
      setupError.textContent = "Ingresa tu nombre y elige un color";
      return;
    }
    setupError.textContent = "";
    currentUser.name = trimmed;
    currentUser.color = selectedColor;
    saveUser(currentUser);
    saveUserProfile(currentUser).catch((err) => {
      console.warn("saveUserProfile failed:", err);
    });
    updatePresence(currentUser);
    applyUserPill(currentUser);
    finishProfileEdit();
    showScreen(chatScreen);
    return;
  }

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
  showRandomEnrollmentPhrase();
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

function startProfileEdit() {
  if (!currentUser) return;
  isEditingProfile = true;
  setupTitle.textContent = "Cambiar nombre y color";
  setupBtn.textContent = "Guardar";
  setupCancelBtn.classList.remove("hidden");
  // readOnly is locked once chosen — switching mid-session would skip or
  // require enrollment, and the request is just name + color.
  if (readonlyToggleLabel) readonlyToggleLabel.classList.add("hidden");
  nameInput.value = currentUser.name;
  selectColorInPicker(currentUser.color);
  setupError.textContent = "";
  showScreen(setupScreen);
  nameInput.focus();
  nameInput.select();
}

function finishProfileEdit() {
  isEditingProfile = false;
  setupTitle.textContent = "Tu nombre y color";
  setupBtn.textContent = "Unirse";
  setupCancelBtn.classList.add("hidden");
  if (readonlyToggleLabel) readonlyToggleLabel.classList.remove("hidden");
  setupError.textContent = "";
}

setupBtn.addEventListener("click", handleSetup);
setupCancelBtn.addEventListener("click", () => {
  finishProfileEdit();
  showScreen(chatScreen);
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSetup();
});

renderColorPicker();

// ===== Enrollment Screen =====

let pendingVoiceprint = null;
let lastPhraseIdx = -1;

/**
 * Pick a random phrase from the pool, avoiding the previous one. Stateful so
 * a user who taps Grabar twice in a row sees variety.
 */
function pickEnrollmentPhrase() {
  const pool = ENROLLMENT_PHRASES;
  if (!pool || pool.length === 0) return "";
  if (pool.length === 1) {
    lastPhraseIdx = 0;
    return pool[0];
  }
  let idx = Math.floor(Math.random() * pool.length);
  if (idx === lastPhraseIdx) idx = (idx + 1) % pool.length;
  lastPhraseIdx = idx;
  return pool[idx];
}

function showRandomEnrollmentPhrase() {
  if (!enrollmentPhraseEl) return;
  enrollmentPhraseEl.textContent = pickEnrollmentPhrase();
}

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
  dlog("enrollment", "captured", {
    mean: Math.round(mean),
    stddev: +stddev.toFixed(2),
    n: samples.length,
  });

  enrollmentStatus.textContent =
    "Listo: " + Math.round(mean) + " Hz, " + samples.length + " muestras";
  enrollmentRecordBtn.disabled = false;
  enrollmentContinueBtn.disabled = false;
}

function handleEnrollmentContinue() {
  if (!pendingVoiceprint) return;
  saveVoiceprint(pendingVoiceprint);
  if (isReEnrolling) {
    isReEnrolling = false;
    cachedVoiceprint = loadVoiceprint();
    if (cachedVoiceprint) currentUser.voiceprint = cachedVoiceprint;
    saveUserProfile(currentUser).catch((err) => {
      console.warn("saveUserProfile failed:", err);
    });
    showScreen(chatScreen);
    if (!currentUser.readOnly && isSupported() && !getIsListening()) {
      micBtn.click();
    }
    return;
  }
  enterChat();
}

function startReEnrollment() {
  isReEnrolling = true;
  pendingVoiceprint = null;
  if (getIsListening()) {
    stopListening();
    micBtn.classList.remove("listening");
    micStatus.textContent = "Pausado";
  }
  showScreen(enrollmentScreen);
  showRandomEnrollmentPhrase();
  enrollmentError.textContent = "";
  enrollmentPitch.textContent = "";
  enrollmentRecordBtn.disabled = false;
  enrollmentContinueBtn.disabled = true;
  enrollmentStatus.textContent = "Toca grabar y lee la frase";
  startEnrollmentLevelLoop();
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
    publishPitchDebug();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Push the current pitch state into the debug overlay. No-op when debug is
 * off (updatePitchStats short-circuits), so this is safe to call per-frame.
 */
function publishPitchDebug() {
  const stats = getRecentPitchStats(PITCH_WINDOW_MS);
  let inBand;
  if (!cachedVoiceprint) {
    inBand = "—";
  } else if (stats.n < PITCH_MIN_SAMPLES || stats.median === null) {
    inBand = "?";
  } else {
    inBand = inPitchBand(stats.median, cachedVoiceprint, PITCH_TOLERANCE_STDDEV) ? "OK" : "BAD";
  }
  updatePitchStats({
    median: stats.median,
    n: stats.n,
    inBand,
    vpMean: cachedVoiceprint ? cachedVoiceprint.f0_mean : null,
    vpStddev: cachedVoiceprint ? cachedVoiceprint.f0_stddev : null,
    vpTolerance: PITCH_TOLERANCE_STDDEV,
  });
}

function applyUserPill(user) {
  if (!userPill || !user) return;
  userPillName.textContent = user.name;
  userPillDot.style.backgroundColor = user.color;
  userPill.style.color = user.color;
  userPill.style.borderColor = user.color;
  // Hex -> rgba(15%) for the pill background. Falls back to the raw value
  // when the color isn't a 6-digit hex (palette is, but stay defensive).
  const hex = (user.color || "").replace("#", "");
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    userPill.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.14)`;
  } else {
    userPill.style.backgroundColor = "transparent";
  }
}

function enterChat() {
  showScreen(chatScreen);
  applyUserPill(currentUser);
  refreshSupportBanner();
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

  // Release any mic stream left running by enrollment. On Android Chrome,
  // webkitSpeechRecognition.start() throws "service-not-allowed" while the
  // page is holding an open getUserMedia stream — so the monitor + pitch
  // detector are re-armed lazily from onStateChange after speech is up.
  stopPitchDetector();
  stopAudioLevelMonitor();
  audioMonitorAttempted = false;
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
        bumpCounter("gateDrop");
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
          dlog("send", "PITCH-DROP", text, Math.round(stats.median) + "Hz",
            "vs", Math.round(cachedVoiceprint.f0_mean) + "Hz");
          bumpCounter("dropped", `pitch-drop: ${Math.round(stats.median)}Hz: ${text}`);
          bumpCounter("pitchDrop");
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
        ensureAudioMonitor();
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

// Auto-skip the password screen if a recent validation is still fresh.
// Runs at module load — DOM is ready since the script is loaded after
// index.html parses past the chat screen.
tryAutoEnter();
