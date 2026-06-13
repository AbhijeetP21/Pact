'use client'

import { LayoutGrid } from 'lucide-react'

import type { Participant } from '@/types'
import { VideoTile } from '@/components/call/VideoTile'

/**
 * Speaker/spotlight layout: one participant (or a shared screen) fills the
 * stage with `object-contain` so nothing is cropped, while everyone else sits
 * in a side filmstrip that never obstructs the stage. Click a thumbnail to swap
 * focus.
 */
export function SpotlightView({
  participants,
  focusedPeerId,
  mirrorLocal,
  localSpeaking,
  onFocus,
  onExit,
}: {
  participants: Participant[]
  focusedPeerId: string
  /** Mirror the local tile (front camera, not screen-sharing). */
  mirrorLocal: boolean
  localSpeaking: boolean
  onFocus: (peerId: string) => void
  onExit: () => void
}) {
  const focused = participants.find((p) => p.peerId === focusedPeerId)
  const others = participants.filter((p) => p.peerId !== focusedPeerId)
  if (!focused) return null

  return (
    <div className="flex size-full gap-3">
      <div className="relative min-h-0 min-w-0 flex-1">
        <VideoTile
          participant={focused}
          mirror={focused.isLocal && mirrorLocal}
          localSpeaking={focused.isLocal ? localSpeaking : undefined}
          objectFit="contain"
        />
        <button
          type="button"
          onClick={onExit}
          aria-label="Back to grid"
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-black/55 px-2.5 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-black/75"
        >
          <LayoutGrid className="size-4" />
          Grid
        </button>
      </div>

      {others.length > 0 && (
        <aside className="flex w-36 shrink-0 flex-col gap-2 overflow-y-auto pb-2 sm:w-48">
          {others.map((p) => (
            <button
              key={p.peerId}
              type="button"
              onClick={() => onFocus(p.peerId)}
              aria-label={`Focus ${p.displayName}`}
              className="aspect-video w-full shrink-0 overflow-hidden rounded-lg outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
            >
              <VideoTile
                participant={p}
                mirror={p.isLocal && mirrorLocal}
                localSpeaking={p.isLocal ? localSpeaking : undefined}
                compact
              />
            </button>
          ))}
        </aside>
      )}
    </div>
  )
}
