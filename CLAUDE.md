# Oido - Speech-to-Text Chat Room

## Purpose
Real-time speech-to-text chat room for the deaf community. Multiple users join a room, speak into their mics, and speech is transcribed into color-coded messages. A deaf family member can follow conversations visually.

## Architecture
- **Frontend-only** SPA hosted on GitHub Pages
- **Firebase Realtime Database** for real-time message sync
- **Web Speech API** (`webkitSpeechRecognition`) for Spanish speech-to-text (free, browser-native)
- **Vanilla HTML/CSS/JS** - no build step, no framework

## Quick Start
```bash
# Install dev dependencies (tests, lint, hooks)
npm install

# Run tests
npm test

# Run linter
npm run lint

# Serve locally
npx serve .
# Then open http://localhost:3000
```

## File Responsibilities
| File | Purpose |
|------|---------|
| `js/config.js` | Firebase config (placeholder) + hardcoded room password |
| `js/auth.js` | Password gate, name/color selection, sessionStorage |
| `js/speech.js` | Web Speech API wrapper, Spanish, continuous + interim results |
| `js/chat.js` | Message rendering + Firebase send/receive |
| `js/app.js` | Main orchestrator, wires modules together |
| `css/styles.css` | Dark theme, mobile-first responsive layout |
| `index.html` | Single page with 3 screens: password → setup → chat |

## Conventions
- Vanilla JS with ES modules (`type="module"` in script tags)
- No build step - files served as-is
- Mobile-first responsive design
- Dark theme
- Spanish language for speech recognition (`es-ES`)
- Tests use vitest + jsdom

## Firebase Setup
1. Go to https://console.firebase.google.com
2. Create a new project named "oido"
3. Go to Realtime Database → Create Database → Start in test mode
4. Go to Project Settings → General → scroll to "Your apps" → Add web app
5. Copy the `firebaseConfig` object into `js/config.js`

## Manual Test Checklist
- [ ] Password screen rejects wrong password
- [ ] Password screen accepts correct password
- [ ] Name input + color picker work
- [ ] User info persists in sessionStorage
- [ ] Speech recognition starts in Spanish
- [ ] Interim results show with lower opacity
- [ ] Final results appear as solid text
- [ ] Messages sync across two browser tabs
- [ ] Each user's messages show in their chosen color
- [ ] Mobile responsive layout works on phone
- [ ] Mic toggle starts/stops recognition
