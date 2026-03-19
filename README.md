# Memora (Windows MVP Foundation)

Memora is a Windows-first desktop app for AI-powered screen memory and recall.

This repository currently includes:

- Electron desktop shell
- Secure preload bridge
- Privacy-safe recording controls (manual start/stop)
- Basic screen capture to WebM file
- Local transcript generation via Whisper (audio ASR)

## Current Phase

Phase 1 foundation and a first Phase 2 capture implementation are complete.

## Run Locally

```bash
npm install
npm run dev
```

## Optional: Supabase Auth (Cross-Device Login)

Memora supports Supabase email/password auth when configured. If Supabase is not configured, the app falls back to local-only account auth.

1. Copy `.env.example` to `.env`
1. Set your Supabase values:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
# or
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

1. Restart the app (`npm run dev`)

### Security Settings (Recommended)

In Supabase dashboard:

1. Auth -> Providers -> Email:
	1. Enable Email provider
	1. Enable "Confirm email"
1. Auth -> Multi-factor:
	1. Enable TOTP MFA
	1. Require MFA for users who enroll factors

Memora now enforces verified email for Supabase logins and supports MFA code challenge/verification during sign-in.

Note: The first transcript run downloads the Whisper tiny model to local cache, which can take a minute depending on network speed.

## Build

```bash
npm run build
```

## Project Structure

- `electron/main.ts`: Electron app entry and IPC handlers
- `electron/preload.ts`: secure renderer bridge
- `app/index.html`: desktop UI shell
- `app/renderer.js`: recording UI logic and MediaRecorder integration
- `app/styles.css`: dark-mode UI styles

## Next Planned Steps

1. Add local session metadata storage (SQLite)
2. Add OCR processing pipeline on captured keyframes
3. Add transcript pipeline for optional audio
4. Add searchable session library
5. Add AI summarization and cited Q&A
