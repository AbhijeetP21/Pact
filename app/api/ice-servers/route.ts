// Returns the ICE server list for WebRTC peer connections.
//
// STUN servers are static and public. TURN credentials are fetched from
// Metered.ca server-side so the API key never reaches the client bundle.
// TURN relays only ever see encrypted DTLS-SRTP packets — it cannot decrypt
// media, so E2E privacy holds even when a call is relayed.
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

export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const turnUrl = resolveTurnUrl()

  const iceServers: RTCIceServer[] = [...STUN_SERVERS]

  // TURN is optional. If it isn't configured (or the fetch fails) we degrade
  // gracefully to STUN-only rather than failing the whole call — STUN alone is
  // sufficient on most same-network and many NAT scenarios.
  if (turnUrl) {
    try {
      const res = await fetch(turnUrl, { next: { revalidate: 3600 } }) // cache 1h

      if (res.ok) {
        const turnServers: unknown = await res.json()
        if (Array.isArray(turnServers)) {
          iceServers.push(...(turnServers as RTCIceServer[]))
        }
      } else {
        console.warn(
          `[ice-servers] Metered responded ${res.status}; serving STUN only.`,
        )
      }
    } catch (err) {
      console.warn(
        '[ice-servers] Failed to fetch TURN credentials; serving STUN only.',
        err,
      )
    }
  }

  return NextResponse.json(
    { iceServers },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  )
}

/**
 * Build the Metered credentials URL. METERED_API_KEY may be either a bare API
 * key (combined with METERED_APP_DOMAIN) or the full credentials URL pasted in
 * directly — both are supported. Returns null when TURN isn't configured.
 */
function resolveTurnUrl(): string | null {
  const apiKey = process.env.METERED_API_KEY
  const domain = process.env.METERED_APP_DOMAIN
  if (!apiKey) return null

  if (apiKey.startsWith('http://') || apiKey.startsWith('https://')) {
    return apiKey
  }
  if (!domain) return null
  return `https://${domain}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
}
