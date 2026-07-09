'use client'

import { useLayoutEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { Participant } from '@/types'
import { VideoTile } from '@/components/call/VideoTile'

/**
 * Responsive grid for 1–5 participants.
 *
 * Desktop/tablet: Meet-style computed layout. The container is measured with a
 * ResizeObserver and, for every possible column count, we compute how large a
 * tile could be; the arrangement with the largest tiles wins. Tiles prefer
 * 16:9 but may narrow to 4:3 to spend more of the screen on video before
 * letterboxing (the video itself is object-cover, so any shape looks right).
 * Rows are centered, so odd tail tiles (3rd of 3, 5th of 5) sit centered.
 *
 * Phones (narrow containers) keep the FaceTime/Meet fill-the-screen behavior:
 * equal-height rows, stacking 1–2 people vertically and using 2 columns for
 * 3–5 (the odd last tile spans the full width). This avoids tiny letterboxed
 * tiles with a dead black void below.
 */

const GAP_PX = 12 // matches gap-3
// Tile aspect-ratio bounds for the computed layout.
const MAX_TILE_AR = 16 / 9
const MIN_TILE_AR = 4 / 3
// Below this container width, use the phone layout (Tailwind's sm breakpoint).
const PHONE_MAX_WIDTH_PX = 640

type Layout = { cols: number; tileW: number; tileH: number }

/** Pick the column count that yields the largest tiles for this container. */
function bestLayout(count: number, width: number, height: number): Layout {
  let best: Layout = { cols: 1, tileW: 0, tileH: 0 }
  let bestArea = -1
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const cellW = (width - GAP_PX * (cols - 1)) / cols
    const cellH = (height - GAP_PX * (rows - 1)) / rows
    if (cellW <= 0 || cellH <= 0) continue
    // Fit the largest aspect-clamped tile inside the cell.
    const cellAR = cellW / cellH
    const tileAR = Math.min(Math.max(cellAR, MIN_TILE_AR), MAX_TILE_AR)
    const tileW = cellAR >= tileAR ? cellH * tileAR : cellW
    const tileH = cellAR >= tileAR ? cellH : cellW / tileAR
    const area = tileW * tileH
    if (area > bestArea) {
      bestArea = area
      best = { cols, tileW: Math.floor(tileW), tileH: Math.floor(tileH) }
    }
  }
  return best
}

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
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () =>
      setSize((prev) => {
        const w = el.clientWidth
        const h = el.clientHeight
        return prev && prev.w === w && prev.h === h ? prev : { w, h }
      })
    measure()
    // ResizeObserver covers container-driven changes; the window listener is a
    // fallback for environments where RO notifications are frame-throttled.
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const renderTile = (p: Participant) => (
    <VideoTile
      participant={p}
      mirror={p.isLocal && mirrorLocal}
      localSpeaking={p.isLocal ? localSpeaking : undefined}
      onExpand={onFocus ? () => onFocus(p.peerId) : undefined}
    />
  )

  // Measure on the first committed frame; children render right after.
  if (size === null) {
    return <div ref={containerRef} className="size-full" />
  }

  if (size.w < PHONE_MAX_WIDTH_PX) {
    return (
      <div ref={containerRef} className="size-full">
        <div
          className={cn(
            'grid size-full auto-rows-fr gap-3',
            count <= 2 ? 'grid-cols-1' : 'grid-cols-2',
          )}
        >
          {participants.map((p, i) => (
            <div
              key={p.peerId}
              className={cn(
                'min-h-0',
                // Odd tail tile (3rd of 3, 5th of 5) gets its own full row.
                count % 2 === 1 && count > 1 && i === count - 1 && 'col-span-2',
              )}
            >
              {renderTile(p)}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const { cols, tileW, tileH } = bestLayout(count, size.w, size.h)
  const rows: Participant[][] = []
  for (let i = 0; i < count; i += cols) rows.push(participants.slice(i, i + cols))

  return (
    <div ref={containerRef} className="size-full">
      <div
        className="flex size-full flex-col items-center justify-center"
        style={{ gap: GAP_PX }}
      >
        {rows.map((row) => (
          <div
            key={row[0].peerId}
            className="flex justify-center"
            style={{ gap: GAP_PX }}
          >
            {row.map((p) => (
              <div key={p.peerId} style={{ width: tileW, height: tileH }}>
                {renderTile(p)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
