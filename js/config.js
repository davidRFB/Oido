// Room password stored as SHA-256 hash (not plaintext)
export const ROOM_PASSWORD_HASH = "198ae8c9f3db7d6896c94fe4bdbc2b8c7f22c13d37c950f373b6b98340527df8";

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

// Audio gate (Feature A). RMS amplitude in [0,1]. Drops final speech results
// when local mic was quiet — i.e., the speech came from another phone's owner
// across the room, not this phone's owner.
export const AUDIO_GATE_THRESHOLD = 0.10;
// Window must be longer than the recognizer's silence-before-final delay
// (~1–2s on mobile) so the gate still sees the loud speech that triggered
// the final result.
export const AUDIO_GATE_WINDOW_MS = 3000;
export const AUDIO_RING_CAPACITY = 256;

// Cross-device dedup (Feature B). When a peer's message looks near-identical to
// one received in the last DEDUP_WINDOW_MS from a different user, don't render.
export const DEDUP_WINDOW_MS = 2000;
export const DEDUP_RING_SIZE = 10;
export const DEDUP_LEN_RATIO_MAX = 0.30;
export const DEDUP_LEV_RATIO_MAX = 0.25;

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
