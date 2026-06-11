import { clsx, type ClassValue } from 'clsx'
import { customAlphabet } from 'nanoid'
import { twMerge } from 'tailwind-merge'

import { APP_URL } from '@/lib/env'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Lowercase alphanumerics minus easily-confused characters (0/o, 1/l/i).
// Produces clean, unambiguous, non-sequential room slugs.
const slugAlphabet = '23456789abcdefghijkmnpqrstuvwxyz'
const nanoSlug = customAlphabet(slugAlphabet, 8)

/** Generate a URL-safe, non-guessable room slug. */
export function generateSlug(): string {
  return nanoSlug()
}

export const MAX_DISPLAY_NAME_LENGTH = 50

/** Trim and clamp a user-supplied display name. Returns null when empty. */
export function sanitizeDisplayName(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim().slice(0, MAX_DISPLAY_NAME_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

/** Build the absolute shareable URL for a room slug. */
export function getRoomUrl(slug: string): string {
  return `${APP_URL.replace(/\/$/, '')}/room/${slug}`
}

/** Whether the browser supports the WebRTC + getUserMedia APIs Pact needs. */
export function isWebRTCSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.RTCPeerConnection !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

/** Derive up-to-two-letter initials from a name for avatar fallbacks. */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
