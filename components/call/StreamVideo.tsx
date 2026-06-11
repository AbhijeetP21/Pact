'use client'

import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

/**
 * Binds a MediaStream to a <video> element via ref (never state, to avoid
 * re-render loops). Local self-view must be muted to prevent echo; remote
 * tracks must never be muted.
 *
 * Remote tiles are unmuted, so browsers block their autoplay until a user
 * gesture. We call play() explicitly on stream/metadata changes and register a
 * one-shot gesture fallback so playback resumes the instant the user interacts
 * if the cold-start autoplay was blocked.
 */
export function StreamVideo({
  stream,
  muted,
  mirror,
  objectFit = 'cover',
  className,
}: {
  stream: MediaStream | null
  muted: boolean
  mirror?: boolean
  objectFit?: 'cover' | 'contain'
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (el.srcObject !== stream) {
      el.srcObject = stream
    }
    if (!stream) return

    const play = () => {
      el.play().catch(() => {
        /* autoplay blocked — the gesture fallback below will retry */
      })
    }

    play()
    el.addEventListener('loadedmetadata', play)
    // If the cold-start autoplay was blocked, resume on the first interaction.
    document.addEventListener('pointerdown', play, { once: true })

    return () => {
      el.removeEventListener('loadedmetadata', play)
      document.removeEventListener('pointerdown', play)
    }
  }, [stream])

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={cn(
        'size-full',
        objectFit === 'contain' ? 'object-contain' : 'object-cover',
        mirror && '-scale-x-100',
        className,
      )}
    />
  )
}
