'use client'

import { MicOff, VideoOff } from 'lucide-react'

import { useAudioLevel } from '@/hooks/useAudioLevel'
import { cn, initialsFromName } from '@/lib/utils'
import type { Participant } from '@/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ConnectionBadge } from '@/components/call/ConnectionBadge'
import { StreamVideo } from '@/components/call/StreamVideo'

/**
 * A single participant tile: live video (or avatar fallback), name overlay,
 * mic/camera status, connection badge, and a speaking ring. The local tile is
 * visually distinct (violet ring + "You") and muted to prevent echo.
 */
export function VideoTile({
  participant,
  mirror,
  localSpeaking,
}: {
  participant: Participant
  mirror: boolean
  /** Pre-computed speaking state for the local tile (avoids a 2nd AudioContext). */
  localSpeaking?: boolean
}) {
  const showVideo = Boolean(participant.videoEnabled && participant.stream)

  // Remote tiles analyse their own incoming audio; the local tile reuses the
  // value computed once by the parent.
  const remoteSpeaking = useAudioLevel(
    participant.isLocal ? null : participant.stream,
    participant.audioEnabled,
  )
  const speaking =
    (participant.isLocal ? localSpeaking : remoteSpeaking) ?? false

  return (
    <div
      className={cn(
        'group relative size-full overflow-hidden rounded-xl border bg-zinc-900 transition-shadow duration-150',
        participant.isLocal && !speaking && 'border-primary/40',
        speaking
          ? 'border-primary shadow-[0_0_0_2px_var(--color-primary)]'
          : !participant.isLocal && 'border-white/[0.08]',
      )}
    >
      {showVideo ? (
        <StreamVideo
          stream={participant.stream}
          muted={participant.isLocal}
          mirror={mirror}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Avatar
            className={cn(
              'size-20 transition-transform',
              speaking && 'ring-2 ring-primary',
            )}
          >
            {participant.avatarUrl ? (
              <AvatarImage src={participant.avatarUrl} alt={participant.displayName} />
            ) : null}
            <AvatarFallback className="text-2xl">
              {initialsFromName(participant.displayName)}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {/* Top-right status: connection (remote) + camera-off indicator. */}
      <div className="absolute right-2 top-2 flex items-center gap-1.5">
        {!participant.videoEnabled && (
          <span className="rounded-md bg-black/55 p-1 backdrop-blur">
            <VideoOff className="size-3.5 text-white/90" />
          </span>
        )}
        {!participant.isLocal && (
          <span className="rounded-md bg-black/55 p-1.5 backdrop-blur">
            <ConnectionBadge state={participant.connectionState} />
          </span>
        )}
      </div>

      {/* Bottom-left: name + mic state. */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-xs text-white backdrop-blur">
        {!participant.audioEnabled && <MicOff className="size-3 text-red-400" />}
        <span className="max-w-[12rem] truncate">
          {participant.displayName}
          {participant.isLocal ? ' (You)' : ''}
        </span>
      </div>
    </div>
  )
}
