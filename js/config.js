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
export const AUDIO_GATE_THRESHOLD = 0.04;
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

// Pitch fingerprint (Feature D). Each phone learns its owner's pitch band
// during enrollment and drops final transcripts whose recent median F0 falls
// outside owner.f0_mean +/- PITCH_TOLERANCE_STDDEV * owner.f0_stddev.
export const PITCH_F0_MIN = 70;            // Hz, below typical adult male F0
export const PITCH_F0_MAX = 500;           // Hz, above typical child F0
export const PITCH_FFT_SIZE = 4096;        // longer buffer needed for low-F0 accuracy
export const PITCH_RING_CAPACITY = 1024;   // ~17s of voiced frames @ 60fps; fits the 12s enrollment with headroom
export const PITCH_WINDOW_MS = 1500;       // window queried at gate time
export const PITCH_MIN_SAMPLES = 8;        // below this, default-allow (insufficient data)
export const PITCH_TOLERANCE_STDDEV = 2.5; // band half-width in stddevs
export const PITCH_VOICED_RMS = 0.025;     // below this RMS, treat the buffer as silence (above ambient, below quiet speech)

// Voice enrollment. A random phrase from ENROLLMENT_PHRASES is shown each
// time; 15s is a comfortable reading window for the shorter ones and gathers
// plenty of F0 samples (longer ones aren't expected to be finished — the
// phrase is a continuous-speech prompt, not a script to complete).
export const ENROLLMENT_DURATION_MS = 15000;
export const ENROLLMENT_MIN_SAMPLES = 24;

// Pool of enrollment prompts. Picked at random per enrollment so the user
// doesn't get bored of the same verse on re-records. \n is preserved by the
// `white-space: pre-line` rule on .enrollment-phrase.
export const ENROLLMENT_PHRASES = [
  `Vamos a festejar con emoción
Su cumpleaños

Vamos a decirle con amor
Que la felicitamos
Y que siga cumpliendo muchos más
Que la Virgen la tiene que cuidar
Que, de mi parte, nada en la vida le faltará`,
  `Solo quien tiene hijos entiende
Que el deber de un padre no acaba jamás
Que el amor de padre y madre, no se cansa de entregar
Que deseamos para ustedes lo que nunca hemos tenido`,
  `Muchos años después, frente al pelotón de fusilamiento, el coronel Aureliano Buendía había de recordar aquella tarde remota en que su padre lo llevó a conocer el hielo. Macondo era entonces una aldea de veinte casas de barro y cañabrava construida a la orilla de un río de aguas diáfanas.`,
  `En pocos años, Macondo fue una aldea más ordenada y laboriosa que cualquiera de las conocidas hasta entonces por sus trescientos habitantes. Era en verdad una aldea feliz, donde nadie era mayor de treinta años y donde nadie había muerto.`,
  `Tomaré tu mano dulcemente
Te hablaré de amor mientras bailamos
Cosas del ayer nos decimos nada
Por qué ahora ha llegado la mirada
Toma mi mano suavemente
Dime que me amas mientras bailas`,
  `Siempre hay cuatro esquinas
Pero entre esquina y esquina
Siempre habrá lo mismo
Para mi no existe el cielo
Ni luna ni estrellas
Para mi no alumbra el sol
Pa’mi todo es tinieblas`,
];

// Password gate. Skip the password screen on reload when validation happened
// less than this long ago. Family devices stay in the room across casual
// reloads without re-entering the password every time.
export const AUTH_FRESH_MS = 60 * 60 * 1000; // 1 hour

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
