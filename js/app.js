import { validatePassword, createUser, saveUser, loadUser, getColorPalette } from "./auth.js";
import { initFirebase, sendMessage, onMessage, registerPresence, renderMessage } from "./chat.js";
import { isSupported, toggleListening } from "./speech.js";

// DOM elements
const passwordScreen = document.getElementById("password-screen");
const setupScreen = document.getElementById("setup-screen");
const chatScreen = document.getElementById("chat-screen");

const passwordInput = document.getElementById("password-input");
const passwordBtn = document.getElementById("password-btn");
const passwordError = document.getElementById("password-error");

const nameInput = document.getElementById("name-input");
const colorPicker = document.getElementById("color-picker");
const setupBtn = document.getElementById("setup-btn");
const setupError = document.getElementById("setup-error");

const chatMessages = document.getElementById("chat-messages");
const micBtn = document.getElementById("mic-btn");
const micStatus = document.getElementById("mic-status");
const usersCount = document.getElementById("users-count");

let currentUser = null;
let selectedColor = null;
let interimElement = null;

// ===== Screen Navigation =====

function showScreen(screen) {
  [passwordScreen, setupScreen, chatScreen].forEach((s) => s.classList.remove("active"));
  screen.classList.add("active");
}

// ===== Password Screen =====

function handlePassword() {
  const value = passwordInput.value;
  if (validatePassword(value)) {
    passwordError.textContent = "";
    showScreen(setupScreen);
    nameInput.focus();
  } else {
    passwordError.textContent = "Clave incorrecta";
    passwordInput.value = "";
    passwordInput.focus();
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

function handleSetup() {
  const user = createUser(nameInput.value, selectedColor);
  if (!user) {
    setupError.textContent = "Ingresa tu nombre y elige un color";
    return;
  }
  setupError.textContent = "";
  currentUser = user;
  saveUser(user);
  enterChat();
}

setupBtn.addEventListener("click", handleSetup);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSetup();
});

renderColorPicker();

// ===== Chat Screen =====

function enterChat() {
  showScreen(chatScreen);
  initFirebase();

  // Listen for messages
  onMessage((message) => {
    // Remove interim element if this is a final message from same user
    if (message.isFinal && interimElement && message.name === currentUser.name) {
      interimElement.remove();
      interimElement = null;
    }
    renderMessage(chatMessages, message);
  });

  // Register presence
  registerPresence(currentUser, (users) => {
    usersCount.textContent = `${users.length} conectado${users.length !== 1 ? "s" : ""}`;
  });

  // Check speech support
  if (!isSupported()) {
    micStatus.textContent = "Navegador no compatible";
    micBtn.disabled = true;
  }
}

// ===== Mic Toggle =====

micBtn.addEventListener("click", () => {
  const nowListening = toggleListening({
    onInterim: (text) => {
      // Update or create interim message display
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
      // Remove interim element
      if (interimElement) {
        interimElement.remove();
        interimElement = null;
      }
      // Send final message to Firebase
      sendMessage(currentUser, text, true);
    },

    onError: (event) => {
      console.error("Speech error:", event);
      micStatus.textContent = "Error: " + (event.error || event.message);
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

  // Immediate visual feedback
  if (nowListening) {
    micBtn.classList.add("listening");
    micStatus.textContent = "Escuchando...";
  } else {
    micBtn.classList.remove("listening");
    micStatus.textContent = "Toca para hablar";
  }
});

// ===== Auto-restore session =====
const savedUser = loadUser();
if (savedUser) {
  // Skip password, but still show setup for color re-selection
  // (they may want to change color)
}
