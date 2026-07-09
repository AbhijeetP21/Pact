'use client'

import { useEffect, useRef } from 'react'

/**
 * Traps the browser back gesture/button while `active`, so a swipe-back on
 * mobile doesn't navigate away and kill the call (Zoom/Meet-style: leaving is
 * only via the explicit leave button or closing the tab).
 *
 * Arms by pushing a sentinel history entry for the same URL — a shallow
 * update, so the App Router keeps rendering this page; only the back-gesture
 * target changes. Every pop re-arms the sentinel and invokes `onBack`, which
 * decides what the gesture means (close an overlay, show a hint, …).
 */
export function useBackGestureGuard(active: boolean, onBack: () => void): void {
  // Keep the latest callback without re-arming the guard on every render.
  const onBackRef = useRef(onBack)
  useEffect(() => {
    onBackRef.current = onBack
  }, [onBack])

  useEffect(() => {
    if (!active) return

    // Spread the current entry's state: the App Router stamps its internal
    // tree (__PRIVATE_NEXTJS_INTERNALS_TREE) on every entry and cannot
    // reconcile a popstate onto an entry without it — it falls back to a real
    // navigation, which is exactly what this guard exists to prevent.
    const arm = () =>
      window.history.pushState(
        { ...window.history.state, pactBackGuard: true },
        '',
      )
    arm()

    const onPopState = () => {
      // Re-arm first so a rapid second gesture still lands on the sentinel.
      arm()
      onBackRef.current()
    }
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
      // Disarm: drop the sentinel if it's still the top entry (it isn't when
      // the leave button already navigated away with router.push).
      if (window.history.state?.pactBackGuard) window.history.back()
    }
  }, [active])
}
