'use client'

import { useEffect, useState } from 'react'

import { isLikelyMobile } from '@/lib/utils'

export type DeviceCapabilities = {
  /** Phone / small-tablet: trim heavy effects and shrink the control set. */
  isMobile: boolean
  /** Screen capture exists (desktop + Android Chrome; not iOS Safari). */
  canScreenShare: boolean
}

/**
 * Resolves device capabilities after mount (so SSR markup stays stable) and
 * keeps `isMobile` reactive across viewport/orientation changes.
 */
export function useDeviceCapabilities(): DeviceCapabilities {
  const [caps, setCaps] = useState<DeviceCapabilities>({
    isMobile: false,
    canScreenShare: false,
  })

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse) and (max-width: 1024px)')
    const update = () =>
      setCaps({
        isMobile: isLikelyMobile(),
        canScreenShare:
          typeof navigator.mediaDevices?.getDisplayMedia === 'function',
      })
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return caps
}
