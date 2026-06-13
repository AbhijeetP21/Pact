'use client'

import { cn } from '@/lib/utils'
import type { Participant } from '@/types'
import { VideoTile } from '@/components/call/VideoTile'

/**
 * Responsive grid for 1–5 participants.
 *
 * Desktop (sm+) keeps the spec's exact layouts at a capped width with 16:9
 * tiles, vertically centered:
 *   1 → single        2 → side by side       3 → 2 over 1 (centered)
 *   4 → 2×2           5 → 2 over 3
 *
 * Phones (portrait) instead fill the whole screen, FaceTime/Meet style: the
 * grid takes the full available height with equal-height rows, stacking 1–2
 * people vertically and using 2 columns for 3–5 (the odd last tile spans the
 * full width). This avoids tiny letterboxed tiles with a dead black void below.
 */
export function ParticipantGrid({
  participants,
  mirrorLocal,
  localSpeaking,
  onFocus,
}: {
  participants: Participant[]
  /** Mirror the local tile (front camera, not screen-sharing). */
  mirrorLocal: boolean
  localSpeaking: boolean
  onFocus?: (peerId: string) => void
}) {
  const count = participants.length

  return (
    <div
      className={cn(
        'mx-auto grid w-full gap-3',
        // Mobile: fill height with equal rows. Desktop: natural height, capped.
        'h-full auto-rows-fr sm:h-auto sm:max-w-6xl sm:auto-rows-auto',
        gridClass(count),
      )}
    >
      {participants.map((p, i) => (
        <div
          key={p.peerId}
          className={cn('min-h-0 sm:aspect-video', tileClass(count, i))}
        >
          <VideoTile
            participant={p}
            mirror={p.isLocal && mirrorLocal}
            localSpeaking={p.isLocal ? localSpeaking : undefined}
            onExpand={onFocus ? () => onFocus(p.peerId) : undefined}
          />
        </div>
      ))}
    </div>
  )
}

function gridClass(count: number): string {
  // Mobile (base): stack ≤2, otherwise 2 columns.
  const mobile = count <= 2 ? 'grid-cols-1' : 'grid-cols-2'
  // Desktop: the spec's exact column counts.
  const desktop =
    count === 1 ? 'sm:grid-cols-1' : count === 5 ? 'sm:grid-cols-6' : 'sm:grid-cols-2'
  return `${mobile} ${desktop}`
}

function tileClass(count: number, index: number): string {
  // 3 people: third tile spans the full width on mobile (its own row), and is
  // centered at single-column width on desktop.
  if (count === 3 && index === 2) {
    return 'col-span-2 sm:w-[calc(50%-0.375rem)] sm:justify-self-center'
  }
  // 5 people: desktop is 2 wide on top (span 3 of 6) and 3 on the bottom (span
  // 2 of 6). On mobile it's a plain 2-col grid; the lone 5th tile goes full width.
  if (count === 5) {
    if (index < 2) return 'sm:col-span-3'
    if (index === 4) return 'col-span-2 sm:col-span-2'
    return 'sm:col-span-2'
  }
  return ''
}
