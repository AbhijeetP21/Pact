# Pact — Privacy-First P2P Video Calls

Pact is a serverless, end-to-end encrypted video calling app for small private groups (up to 5 people). **Audio and video never touch a server** — all media travels directly peer-to-peer over WebRTC, which is encrypted with DTLS-SRTP at the protocol level by default. A server is used only for connection-setup metadata, authentication, and room management.

> Share a link, join instantly — familiar like FaceTime, private by architecture.

## Principles

- **True P2P mesh** — no SFU, no media relay. Media is never decrypted by any server.
- **DTLS-SRTP by default** — encryption is the protocol, not a feature toggle.
- **Supabase for signaling + auth only** — it never sees the media stream.
- **On-device noise suppression** — RNNoise runs in the browser; your audio is cleaned locally.
- **No recording. No transcription. No ads. No analytics on call content.**

## Features

- Google OAuth + magic-link auth (Supabase)
- Create a room, share a link, join instantly
- Pre-join lobby with camera/mic preview and device toggles
- 1–5 participant mesh with responsive grid layouts
- Mic / camera / screen-share / leave controls
- Live speaking indicators (Web Audio level detection)
- **RNNoise** ML noise suppression, on-device (toggleable)
- Per-tile connection status, ICE-failure auto-reconnect, network-drop recovery
- Max-participant enforcement and room expiry

## Tech Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript strict) |
| UI | React 19, Tailwind CSS v4, shadcn/ui (Base UI), lucide-react |
| WebRTC | `simple-peer` (peer connections), STUN + Metered.ca TURN |
| Noise suppression | `@sapphi-red/web-noise-suppressor` (RNNoise WASM AudioWorklet) |
| Backend | Supabase — Auth, Realtime (Presence + Broadcast), PostgreSQL + RLS |
| Deploy | Vercel |

> Note: the project pins **Next.js 15** but otherwise tracks the current `create-next-app`/`shadcn` toolchain (React 19, Tailwind v4, Base UI). The signaling/WebRTC architecture is independent of the UI stack.

## Architecture

```
Browser A  ──────────  DTLS-SRTP media (P2P)  ──────────  Browser B
    │                                                          │
    └──────────  Supabase Realtime (signaling only)  ──────────┘
              Presence = who's in the room
              Broadcast = SDP offers/answers + ICE candidates
```

- **Presence** tracks the participant roster (each client's presence key is its `peerId`).
- **Broadcast** routes SDP and ICE between named peers (fire-and-forget).
- **Initiator rule:** the *later* joiner initiates the offer toward each existing peer (ties broken by `peerId`), so exactly one side of every pair offers — no glare.
- **TURN** (Metered.ca) only relays already-encrypted packets; it cannot decrypt DTLS-SRTP, so end-to-end privacy holds even when relayed. Credentials are fetched server-side via `/api/ice-servers`, so the API key never ships to the client.

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- A [Supabase](https://supabase.com) project (free tier)
- Optional: a [Metered.ca](https://www.metered.ca) account for TURN (free tier)

### 1. Install

```bash
npm install
```

### 2. Configure environment

Copy the example and fill in your values:

```bash
cp .env.local.example .env.local
```

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL (Project Settings → API) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ | Supabase publishable key (`sb_publishable_…`). The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works. |
| `NEXT_PUBLIC_APP_URL` | ✅ | Base URL, e.g. `http://localhost:3000` |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Server-only. Unused in v1. |
| `METERED_API_KEY` | — | Metered API key, **or** the full credentials URL. Without it, calls fall back to STUN-only. |
| `METERED_APP_DOMAIN` | — | Metered app subdomain (e.g. `pact`). |

The app validates required variables on startup and throws a descriptive error if any are missing.

### 3. Set up Supabase

1. **Run the migration** — in the Supabase SQL Editor, paste and run [`supabase/migrations/20240001_initial.sql`](supabase/migrations/20240001_initial.sql) (creates the `rooms` table + Row Level Security).
2. **Auth → URL Configuration:** set Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to Redirect URLs.
3. **Magic link** works out of the box. For **Google OAuth** (optional): create a Google Cloud OAuth client with redirect `https://<project-ref>.supabase.co/auth/v1/callback`, then enable Google under Auth → Providers.

### 4. (Optional) Get a Metered.ca TURN key

1. Sign up at [metered.ca](https://www.metered.ca) and create a TURN app.
2. Copy the API key (or the full credentials URL) into `METERED_API_KEY` and set `METERED_APP_DOMAIN` to your subdomain.

Without TURN, calls work over STUN — fine on the same network and many NATs, but symmetric-NAT scenarios may fail to connect.

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> Testing two participants on one machine? Use two different browsers, or launch a second Chrome with a fake camera so both have video:
> ```
> chrome --user-data-dir=/tmp/pact-test --use-fake-device-for-media-stream --use-fake-ui-for-media-stream http://localhost:3000
> ```

## Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm run start       # serve the production build
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```

## Deploy to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Add all environment variables from `.env.local` to the Vercel project. Set `NEXT_PUBLIC_APP_URL` to your production URL.
3. In Supabase Auth → URL Configuration, add your production URL and `https://<your-domain>/**` to the redirect allow-list.
4. Deploy. Verify the `/api/ice-servers` route returns servers (when authenticated) and run a full two-device call.

## Project Structure

```
app/
  (auth)/login, (auth)/auth/callback   Auth UI + OAuth/magic-link callback
  room/new, room/[slug]                Create + join rooms
  api/ice-servers                      Server-side TURN/STUN (auth-gated)
components/call/                        VideoTile, ParticipantGrid, ControlBar, …
lib/webrtc/                             SignalingService, PeerManager, MediaManager, NoiseSuppressor
hooks/                                  useCall, useMedia, useParticipants, useAudioLevel
lib/supabase/                           Browser + server clients (@supabase/ssr)
middleware.ts                          Protects /room/* routes
supabase/migrations/                   rooms table + RLS
public/noise/                          RNNoise worklet + WASM
```

## Security

- All DB access goes through the authenticated client; RLS enforces room access.
- TURN credentials are fetched server-side only; never in the client bundle.
- Room slugs are `nanoid`-generated (non-guessable, non-sequential).
- Middleware protects all `/room/*` routes.
- No server-side recording, logging, or processing of media.
- Room expiry and max-participant limits are enforced.
- Display names are trimmed and length-capped.

## License

MIT
