# Pact: Privacy-First P2P Video Calls

Pact is a serverless, end-to-end encrypted video calling app for small private groups (up to 5 people). Audio and video never touch a server. All media travels directly peer-to-peer over WebRTC, which is encrypted with DTLS-SRTP at the protocol level by default. A server is only involved in connection setup, authentication, and room management.

> Share a link and join instantly. Familiar like FaceTime, private by architecture.

## Principles

- **True P2P mesh.** No SFU, no media relay. No server ever decrypts your media.
- **DTLS-SRTP by default.** Encryption is the protocol, not a feature you switch on.
- **Supabase for signaling and auth only.** It never sees the media stream.
- **On-device processing.** Noise suppression and background blur run in the browser. Your audio and video are processed locally and nowhere else.
- **No recording. No transcription. No ads. No analytics on call content.**

## Features

- Google OAuth and magic-link sign-in (Supabase)
- Create a room, share a link, join instantly
- Pre-join lobby with camera and mic preview, plus noise and blur toggles
- 1 to 5 participant mesh with an adaptive grid that computes the best tile size for any screen
- Mic, camera, screen share, and leave controls
- Live speaking indicators (Web Audio level detection)
- Live mic and camera state across peers, so you can see when someone mutes
- Session chat that lives only for the call and disappears when it ends
- On-device background blur (MediaPipe selfie segmentation)
- On-device RNNoise suppression, optional and off by default
- Per-tile connection status, ICE-failure auto-reconnect, and network-drop recovery
- Mobile back-gesture guard, so a swipe-back closes the chat or shows a hint instead of dropping you from the call
- Max-participant enforcement and room expiry

A note on noise suppression: the browser's native suppression is light and always on. RNNoise is a heavier ML pass that can strain a slower machine and introduce robotic artifacts for the people listening, so it stays off by default and is there if you want it.

## Tech Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript strict) |
| UI | React 19, Tailwind CSS v4, shadcn/ui (Base UI), lucide-react |
| WebRTC | `simple-peer` for peer connections, STUN plus Cloudflare TURN |
| Noise suppression | `@sapphi-red/web-noise-suppressor` (RNNoise WASM AudioWorklet) |
| Background blur | `@mediapipe/selfie_segmentation` (self-hosted WASM) |
| Backend | Supabase: Auth, Realtime (Presence and Broadcast), PostgreSQL with RLS |
| Deploy | Vercel |

> The project pins Next.js 15 but otherwise tracks the current `create-next-app` and `shadcn` toolchain (React 19, Tailwind v4, Base UI). The signaling and WebRTC architecture is independent of the UI stack.

## Architecture

```
Browser A  ----------  DTLS-SRTP media (P2P)  ----------  Browser B
    |                                                         |
    +----------  Supabase Realtime (signaling only)  ---------+
             Presence  = who's in the room
             Broadcast = SDP offers/answers, ICE candidates,
                         chat, and mic/camera state
```

- **Presence** tracks the participant roster. Each client's presence key is its `peerId`.
- **Broadcast** routes SDP and ICE between named peers (fire and forget), and also carries the ephemeral chat and per-peer mic/camera state.
- **Initiator rule:** the later joiner initiates the offer toward each existing peer (ties broken by `peerId`), so exactly one side of every pair offers and there is no glare.
- **TURN** (Cloudflare Realtime) only relays already-encrypted packets. It cannot decrypt DTLS-SRTP, so end-to-end privacy holds even when traffic is relayed. Credentials are minted server-side via `/api/ice-servers`, so the API key never ships to the client. Metered.ca remains as a legacy fallback when Cloudflare isn't configured.
- **Chat and blur stay on-device.** Chat messages ride the signaling channel and are never stored. Background blur is composited in the browser, so the raw camera frames never leave the machine.

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- A [Supabase](https://supabase.com) project (free tier)
- Optional: a [Cloudflare](https://dash.cloudflare.com) account for TURN (Realtime free tier, 1,000 GB/month)

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
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (Project Settings, API) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable key (`sb_publishable_...`). The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works. |
| `NEXT_PUBLIC_APP_URL` | yes | Base URL, e.g. `http://localhost:3000` |
| `SUPABASE_SERVICE_ROLE_KEY` | no | Server-only. Unused in v1. |
| `CLOUDFLARE_TURN_KEY_ID` | no | Cloudflare Realtime TURN key ID. Both Cloudflare values are needed together. |
| `CLOUDFLARE_TURN_API_TOKEN` | no | Cloudflare Realtime TURN API token. Without TURN, calls fall back to STUN only. |
| `METERED_API_KEY` | no | Legacy Metered.ca fallback, used only when Cloudflare isn't configured. |
| `METERED_APP_DOMAIN` | no | Metered app subdomain (e.g. `pact`). |

The app validates required variables on startup and throws a descriptive error if any are missing.

### 3. Set up Supabase

1. **Run the migration.** In the Supabase SQL Editor, paste and run [`supabase/migrations/20240001_initial.sql`](supabase/migrations/20240001_initial.sql). This creates the `rooms` table and its Row Level Security.
2. **Auth, URL Configuration.** Set Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to Redirect URLs.
3. **Magic link** works out of the box. For **Google OAuth** (optional), create a Google Cloud OAuth client with redirect `https://<project-ref>.supabase.co/auth/v1/callback`, then enable Google under Auth, Providers.

### 4. (Optional) Get a Cloudflare TURN key

1. In the Cloudflare dashboard, go to **Realtime → TURN Server** and create a TURN key.
2. Copy the **Key ID** into `CLOUDFLARE_TURN_KEY_ID` and the **API token** into `CLOUDFLARE_TURN_API_TOKEN`. Both are required — the app treats a partial pair as unconfigured.

Without TURN, calls work over STUN. That is fine on the same network and many NATs, but symmetric-NAT and strict-firewall scenarios may fail to connect. (Metered.ca is still supported as a legacy fallback via `METERED_API_KEY`.)

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
2. Add every environment variable from `.env.local` to the Vercel project. Set `NEXT_PUBLIC_APP_URL` to your production URL. Env var changes only take effect after a redeploy.
3. In Supabase Auth, URL Configuration, add your production URL and `https://<your-domain>/**` to the redirect allow-list.
4. Deploy. Verify that `/api/ice-servers` returns servers when authenticated, then run a full two-device call.

## Project Structure

```
app/
  (auth)/login, (auth)/auth/callback   Auth UI and OAuth/magic-link callback
  room/new, room/[slug]                Create and join rooms
  api/ice-servers                      Server-side TURN/STUN (auth-gated)
components/call/                        VideoTile, ParticipantGrid, ControlBar, ChatPanel, ...
lib/webrtc/                             SignalingService, PeerManager, MediaManager,
                                        NoiseSuppressor, BackgroundProcessor
hooks/                                  useCall, useMedia, useParticipants, useAudioLevel
lib/supabase/                           Browser and server clients (@supabase/ssr)
middleware.ts                          Protects /room/* routes
supabase/migrations/                   rooms table and RLS
public/noise/                          RNNoise worklet and WASM
public/mediapipe/                      Selfie segmentation model and WASM
```

## Security

- All DB access goes through the authenticated client, and RLS enforces room access.
- TURN credentials are fetched server-side only, never in the client bundle.
- Room slugs are `nanoid`-generated, so they are non-guessable and non-sequential.
- Middleware protects all `/room/*` routes.
- No server-side recording, logging, or processing of media.
- Chat is ephemeral. It is never written to a database and is gone when the call ends.
- Room expiry and max-participant limits are enforced.
- Display names are trimmed and length-capped.

## License

Personal and other noncommercial use only, under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and share Pact for personal projects, study, and other noncommercial purposes at no cost.

**Commercial use requires prior written permission from the author.** If you want to use Pact (or a derivative) in or for a business, or in any way primarily intended for commercial advantage, contact Abhijeet Sandip Pachpute to arrange a commercial license.
