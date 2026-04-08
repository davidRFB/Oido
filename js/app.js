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
const readonlyToggle = document.getElementById("readonly-toggle");
const setupBtn = document.getElementById("setup-btn");
const setupError = document.getElementById("setup-error");

const chatMessages = document.getElementById("chat-messages");
const chatFooter = document.querySelector(".chat-footer");
const micBtn = document.getElementById("mic-btn");
const micStatus = document.getElementById("mic-status");
const usersBtn = document.getElementById("users-btn");
const usersCount = document.getElementById("users-count");
const usersList = document.getElementById("users-list");
const fontDecrease = document.getElementById("font-decrease");
const fontIncrease = document.getElementById("font-increase");

let currentUser = null;
let selectedColor = null;
let interimElement = null;

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

// ===== Screen Navigation =====

function showScreen(screen) {
  [passwordScreen, setupScreen, chatScreen].forEach((s) => s.classList.remove("active"));
  screen.classList.add("active");
}

// ===== Password Screen =====

async function handlePassword() {
  const value = passwordInput.value;
  passwordBtn.disabled = true;
  if (await validatePassword(value)) {
    passwordError.textContent = "";
    showScreen(setupScreen);
    nameInput.focus();
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

function handleSetup() {
  const user = createUser(nameInput.value, selectedColor, readonlyToggle.checked);
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

  // Hide mic for read-only users
  if (currentUser.readOnly) {
    chatFooter.classList.add("hidden");
  } else if (!isSupported()) {
    micStatus.textContent = "Navegador no compatible";
    micBtn.disabled = true;
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

// ===== Auto-restore session =====
const savedUser = loadUser();
if (savedUser) {
  // Skip password, but still show setup for color re-selection
  // (they may want to change color)
}
