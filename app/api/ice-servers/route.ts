// Returns the ICE server list for WebRTC peer connections.
//
// STUN servers are static and public. TURN credentials are minted from
// Cloudflare Realtime server-side so the API token never reaches the client
// bundle (Metered.ca remains as a legacy fallback until the Cloudflare key is
// configured). TURN relays only ever see encrypted DTLS-SRTP packets — it
// cannot decrypt media, so E2E privacy holds even when a call is relayed.
//
// Auth-gated: only signed-in users may obtain credentials.

import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

// Never cache the response at the route level — it is per-user and auth-gated.
export const dynamic = 'force-dynamic'

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

// Credential lifetime; Cloudflare recommends covering the longest expected
// call. Comfortably exceeds the client-side cache window below.
const CLOUDFLARE_TURN_TTL_SECONDS = 86_400

export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // TURN is optional. If no provider is configured (or the mint fails) we
  // degrade gracefully to STUN-only rather than failing the whole call — but
  // report it via `turnAvailable` so the client can warn that calls between
  // some networks may not connect.
  const turnServers =
    (await fetchCloudflareTurnServers()) ?? (await fetchMeteredTurnServers())

  const iceServers: RTCIceServer[] = [...STUN_SERVERS, ...(turnServers ?? [])]
  const turnAvailable = (turnServers ?? []).some(hasTurnUrl)

  return NextResponse.json(
    { iceServers, turnAvailable },
    // Short client cache: quota/credential state can change out from under us,
    // and the client re-fetches on rejoin — stale-for-an-hour defeats that.
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}

function hasTurnUrl(server: RTCIceServer): boolean {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
  return urls.some((u) => typeof u === 'string' && u.startsWith('turn'))
}

/**
 * Mint short-lived TURN credentials from Cloudflare Realtime. Returns null
 * when unconfigured or on any failure (the caller falls back).
 */
async function fetchCloudflareTurnServers(): Promise<RTCIceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN
  if (!keyId || !apiToken) return null

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: CLOUDFLARE_TURN_TTL_SECONDS }),
        cache: 'no-store',
      },
    )

    if (!res.ok) {
      console.warn(`[ice-servers] Cloudflare responded ${res.status}.`)
      return null
    }

    // Response is { iceServers: RTCIceServer[] } (generate-ice-servers) but
    // the older /credentials/generate endpoint returns a single object —
    // accept both shapes.
    const data: unknown = await res.json()
    const raw = (data as { iceServers?: unknown })?.iceServers
    const servers = Array.isArray(raw) ? raw : raw ? [raw] : []
    return servers.length ? (servers as RTCIceServer[]) : null
  } catch (err) {
    console.warn('[ice-servers] Cloudflare TURN mint failed.', err)
    return null
  }
}

/**
 * Legacy: fetch TURN credentials from Metered.ca. Kept as a fallback until the
 * Cloudflare migration is verified, then safe to delete along with the
 * METERED_* env vars. METERED_API_KEY may be either a bare API key (combined
 * with METERED_APP_DOMAIN) or the full credentials URL pasted in directly.
 */
async function fetchMeteredTurnServers(): Promise<RTCIceServer[] | null> {
  const turnUrl = resolveMeteredUrl()
  if (!turnUrl) return null

  try {
    const res = await fetch(turnUrl, { cache: 'no-store' })

    if (!res.ok) {
      console.warn(`[ice-servers] Metered responded ${res.status}.`)
      return null
    }

    const turnServers: unknown = await res.json()
    return Array.isArray(turnServers) && turnServers.length
      ? (turnServers as RTCIceServer[])
      : null
  } catch (err) {
    console.warn('[ice-servers] Failed to fetch Metered TURN credentials.', err)
    return null
  }
}

function resolveMeteredUrl(): string | null {
  const apiKey = process.env.METERED_API_KEY
  const domain = process.env.METERED_APP_DOMAIN
  if (!apiKey) return null

  if (apiKey.startsWith('http://') || apiKey.startsWith('https://')) {
    return apiKey
  }
  if (!domain) return null
  return `https://${domain}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
}
