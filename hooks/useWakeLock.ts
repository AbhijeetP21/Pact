'use client'

import { useEffect } from 'react'

type WakeLockSentinelLike = { release: () => Promise<void> }
type WakeLockNavigator = {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

/**
 * Holds a Screen Wake Lock while `active` is true so the device screen doesn't
 * sleep mid-call (important on phones, where a listener may not touch the
 * screen for minutes). The lock is auto-released by the browser when the tab is
 * hidden, so we re-request it when the tab becomes visible again. No-op where
 * the Wake Lock API is unsupported (e.g. older Safari).
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const wakeLock = (navigator as unknown as WakeLockNavigator).wakeLock
    if (!wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const request = async () => {
      try {
        const next = await wakeLock.request('screen')
        if (cancelled) {
          void next.release().catch(() => {})
        } else {
          sentinel = next
        }
      } catch {
        // denied or interrupted — nothing actionable
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request()
    }

    void request()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
