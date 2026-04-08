# Oido

Real-time speech-to-text chat room for the deaf community. Multiple people join a room, speak into their mics, and their speech is transcribed into color-coded messages so a deaf person can follow the conversation visually.

## How It Works

1. Enter the room password
2. Choose your name and a color
3. Tap the microphone button and speak
4. Your speech appears as text in the chat, colored with your chosen color
5. Everyone in the room sees all messages in real-time

## Setup

### 1. Firebase

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project (e.g., "oido")
3. Go to **Realtime Database** > **Create Database** > **Start in test mode**
4. Go to **Project Settings** > **General** > scroll to "Your apps" > **Add web app**
5. Copy the config values into `js/config.js`

### 2. GitHub Pages

Push to the `main` branch and enable GitHub Pages in repo Settings > Pages > Source: GitHub Actions. The included workflow handles deployment automatically.

### 3. Local Development

```bash
npm install
npx serve .
```

Open `http://localhost:3000` in Chrome/Edge.

## Requirements

- **Chrome or Edge** (Speech Recognition API is not supported in Firefox/Safari)
- Each person needs **earbuds/headphones with a mic** when in the same room (to prevent audio bleed between devices)

## Development

```bash
npm test          # Run unit tests
npm run lint      # Run ESLint
npm run lint:fix  # Auto-fix lint issues
```

Pre-commit hooks automatically run lint + tests before each commit.

## Tech Stack

- Vanilla HTML/CSS/JS (no build step)
- Firebase Realtime Database (free tier)
- Web Speech API (browser-native, free)
- GitHub Pages (free hosting)

## License

MIT
