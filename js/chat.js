import { firebaseConfig } from "./config.js";

let db = null;
let messagesRef = null;
let presenceRef = null;
let userPresenceRef = null;
let clearedAtRef = null;

/**
 * Initialize Firebase and connect to the room.
 * Uses Firebase SDK loaded via CDN in index.html.
 */
export function initFirebase() {
  if (db) return;

  if (firebaseConfig.apiKey === "YOUR_API_KEY") {
    console.warn("Firebase not configured - running in offline mode");
    return;
  }

  const app = firebase.initializeApp(firebaseConfig);
  db = firebase.database(app);
  messagesRef = firebase.ref(db, "rooms/default/messages");
  presenceRef = firebase.ref(db, "rooms/default/presence");
  clearedAtRef = firebase.ref(db, "rooms/default/clearedAt");
}

/**
 * Send a message to the room.
 * @param {{ name: string, color: string }} user
 * @param {string} text
 * @param {boolean} [isFinal=true]
 */
export function sendMessage(user, text, isFinal = true) {
  if (!messagesRef) {
    // Offline mode - dispatch a custom event for local testing
    window.dispatchEvent(new CustomEvent("oido-message", {
      detail: formatMessage(user, text, isFinal),
    }));
    return;
  }

  const message = formatMessage(user, text, isFinal);
  firebase.push(messagesRef, message);
}

/**
 * Format a message object.
 * @param {{ name: string, color: string }} user
 * @param {string} text
 * @param {boolean} isFinal
 * @returns {{ name: string, color: string, text: string, isFinal: boolean, timestamp: number }}
 */
export function formatMessage(user, text, isFinal) {
  return {
    name: user.name,
    color: user.color,
    text: text,
    isFinal: isFinal,
    timestamp: Date.now(),
  };
}

/**
 * Delete every message in the room and bump the cleared-at timestamp so
 * other connected clients clear their local DOM via onMessagesCleared.
 * @returns {Promise<void>}
 */
export async function clearMessages() {
  if (!messagesRef) return;
  await firebase.set(messagesRef, null);
  await firebase.set(clearedAtRef, Date.now());
}

/**
 * Subscribe to "chat was cleared" events. The callback fires whenever the
 * room's clearedAt timestamp changes after the initial connection — i.e.
 * skips the first snapshot, which represents existing state at join time.
 * @param {function} callback
 */
export function onMessagesCleared(callback) {
  if (!clearedAtRef) return;
  let initialized = false;
  firebase.onValue(clearedAtRef, () => {
    if (!initialized) {
      initialized = true;
      return;
    }
    callback();
  });
}

/**
 * Listen for new messages in the room.
 * @param {function} callback - called with message object for each new message
 */
export function onMessage(callback) {
  if (!messagesRef) {
    // Offline mode - listen for custom events
    window.addEventListener("oido-message", (e) => {
      callback(e.detail);
    });
    return;
  }

  firebase.onChildAdded(messagesRef, (snapshot) => {
    callback(snapshot.val());
  });
}

/**
 * Register user presence in the room.
 * @param {{ name: string, color: string }} user
 * @param {function} onPresenceChange - called with array of connected users
 */
export function registerPresence(user, onPresenceChange) {
  if (!presenceRef) return;

  const connectedRef = firebase.ref(db, ".info/connected");
  userPresenceRef = firebase.push(presenceRef);

  firebase.onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      firebase.onDisconnect(userPresenceRef).remove();
      firebase.set(userPresenceRef, {
        name: user.name,
        color: user.color,
        joinedAt: Date.now(),
      });
    }
  });

  firebase.onValue(presenceRef, (snap) => {
    const users = [];
    snap.forEach((child) => {
      users.push(child.val());
    });
    onPresenceChange(users);
  });
}

/**
 * Render a message into the chat container.
 * @param {HTMLElement} container
 * @param {{ name: string, color: string, text: string, isFinal: boolean, timestamp: number }} message
 */
export function renderMessage(container, message) {
  const div = document.createElement("div");
  div.className = "chat-message" + (message.isFinal ? "" : " interim");

  const nameSpan = document.createElement("span");
  nameSpan.className = "chat-name";
  nameSpan.style.color = message.color;
  nameSpan.textContent = message.name + ": ";

  const textSpan = document.createElement("span");
  textSpan.className = "chat-text";
  textSpan.textContent = message.text;

  div.appendChild(nameSpan);
  div.appendChild(textSpan);
  container.appendChild(div);

  // Auto-scroll to bottom
  container.scrollTop = container.scrollHeight;

  return div;
}
