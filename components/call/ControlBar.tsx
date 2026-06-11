'use client'

import {
  AudioLines,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { MediaState } from '@/types'

export type ControlBarProps = {
  mediaState: MediaState
  localSpeaking: boolean
  onToggleAudio: () => void
  onToggleVideo: () => void
  onToggleScreenShare: () => void
  onToggleNoiseSuppression: () => void
  onLeave: () => void
}

/** Fixed, pill-shaped call controls: mic, camera, screen share, leave. */
export function ControlBar({
  mediaState,
  localSpeaking,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleNoiseSuppression,
  onLeave,
}: ControlBarProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-zinc-900/90 p-2 shadow-lg backdrop-blur">
        <ControlButton
          active={!mediaState.audioEnabled}
          speaking={mediaState.audioEnabled && localSpeaking}
          onClick={onToggleAudio}
          label={mediaState.audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          {mediaState.audioEnabled ? (
            <Mic className="size-5" />
          ) : (
            <MicOff className="size-5" />
          )}
        </ControlButton>

        <ControlButton
          active={!mediaState.videoEnabled}
          onClick={onToggleVideo}
          label={mediaState.videoEnabled ? 'Turn camera off' : 'Turn camera on'}
        >
          {mediaState.videoEnabled ? (
            <Video className="size-5" />
          ) : (
            <VideoOff className="size-5" />
          )}
        </ControlButton>

        <ControlButton
          active={mediaState.noiseSuppression}
          highlight
          onClick={onToggleNoiseSuppression}
          label={
            mediaState.noiseSuppression
              ? 'Noise cancellation on'
              : 'Noise cancellation off'
          }
        >
          <AudioLines className="size-5" />
        </ControlButton>

        <ControlButton
          active={mediaState.screenSharing}
          highlight
          onClick={onToggleScreenShare}
          label={mediaState.screenSharing ? 'Stop sharing screen' : 'Share screen'}
        >
          <MonitorUp className="size-5" />
        </ControlButton>

        <div className="mx-1 h-6 w-px bg-white/10" />

        <ControlButton onClick={onLeave} destructive label="Leave call">
          <PhoneOff className="size-5" />
        </ControlButton>
      </div>
    </div>
  )
}

function ControlButton({
  children,
  onClick,
  label,
  active,
  destructive,
  highlight,
  speaking,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  active?: boolean
  destructive?: boolean
  highlight?: boolean
  speaking?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'relative flex size-11 items-center justify-center rounded-full text-white transition-colors',
        'bg-white/5 hover:bg-white/10',
        active && !destructive && 'bg-red-500/90 hover:bg-red-500',
        highlight && active && 'bg-primary hover:bg-primary/90',
        destructive && 'bg-red-500/90 hover:bg-red-500',
        speaking && 'bg-primary/20',
      )}
    >
      {speaking && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
      )}
      <span className="relative">{children}</span>
    </button>
  )
}
