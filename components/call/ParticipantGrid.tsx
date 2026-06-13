'use client'

import { cn } from '@/lib/utils'
import type { Participant } from '@/types'
import { VideoTile } from '@/components/call/VideoTile'

/**
 * Responsive grid for 1–5 participants with the spec's exact layouts:
 *   1 → single        2 → side by side       3 → 2 over 1 (centered)
 *   4 → 2×2           5 → 2 over 3
 * On phones it collapses to a uniform 2-column grid (1 → full width).
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
        'mx-auto grid w-full max-w-6xl gap-3',
        gridClass(count),
        count > 1 && 'max-sm:grid-cols-2',
      )}
    >
      {participants.map((p, i) => (
        <div
          key={p.peerId}
          className={cn('aspect-video min-h-0', tileClass(count, i))}
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
  switch (count) {
    case 1:
      return 'grid-cols-1'
    case 5:
      return 'grid-cols-6'
    default:
      return 'grid-cols-2' // 2, 3, 4
  }
}

function tileClass(count: number, index: number): string {
  // 3 people: third tile centered on its own row at single-column width.
  if (count === 3 && index === 2) {
    return 'col-span-2 w-[calc(50%-0.375rem)] justify-self-center max-sm:col-span-1 max-sm:w-full'
  }
  // 5 people: 2 wide on top (span 3 of 6), 3 on the bottom (span 2 of 6).
  if (count === 5) {
    return index < 2
      ? 'col-span-3 max-sm:col-span-1'
      : 'col-span-2 max-sm:col-span-1'
  }
  return ''
}
