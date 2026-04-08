// Room password stored as SHA-256 hash (not plaintext)
export const ROOM_PASSWORD_HASH = "847fe1747b326c60628b88e280ef4daa791b448c86e222ac08d1983e36486720";

// Color palette for users to choose from
export const COLOR_PALETTE = [
  { name: "Rojo", value: "#ef4444" },
  { name: "Azul", value: "#3b82f6" },
  { name: "Verde", value: "#22c55e" },
  { name: "Amarillo", value: "#eab308" },
  { name: "Morado", value: "#a855f7" },
  { name: "Naranja", value: "#f97316" },
  { name: "Rosa", value: "#ec4899" },
  { name: "Celeste", value: "#06b6d4" },
];

// Firebase configuration - REPLACE with your own config
// See CLAUDE.md for setup instructions
export const firebaseConfig = {
  apiKey: "AIzaSyCxptNs4b3i0q2_PcGB4OG0qXy85mSbmAs",
  authDomain: "oido-955b5.firebaseapp.com",
  databaseURL: "https://oido-955b5-default-rtdb.firebaseio.com",
  projectId: "oido-955b5",
  storageBucket: "oido-955b5.firebasestorage.app",
  messagingSenderId: "326130246775",
  appId: "1:326130246775:web:b633c91825de5ecde25272",
};
