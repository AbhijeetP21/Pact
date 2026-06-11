// Lightweight, scoped console logger for the WebRTC + signaling layers.
// Verbose by default during development so the connection handshake is easy to
// trace across browser tabs; silenced in production builds.

const ENABLED =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_RTC_DEBUG === 'true'

const SCOPE_COLORS: Record<string, string> = {
  Signaling: '#8b5cf6', // violet
  Peer: '#22c55e', // green
  Media: '#0ea5e9', // sky
  Call: '#f59e0b', // amber
}

export function rtcLog(scope: string, message: string, ...args: unknown[]): void {
  if (!ENABLED || typeof window === 'undefined') return
  const color = SCOPE_COLORS[scope] ?? '#a1a1aa'
  console.log(
    `%c[${scope}]%c ${message}`,
    `color:${color};font-weight:600`,
    'color:inherit',
    ...args,
  )
}

export function rtcWarn(scope: string, message: string, ...args: unknown[]): void {
  if (typeof window === 'undefined') return
  console.warn(`[${scope}] ${message}`, ...args)
}

export function rtcError(scope: string, message: string, ...args: unknown[]): void {
  if (typeof window === 'undefined') return
  console.error(`[${scope}] ${message}`, ...args)
}
