'use client'

import {
  Aperture,
  AudioLines,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  SwitchCamera,
  Video,
  VideoOff,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import type { MediaState } from '@/types'

export type ControlBarProps = {
  mediaState: MediaState
  localSpeaking: boolean
  chatOpen: boolean
  chatUnread: number
  /** Phone/tablet: show flip-camera, hide CPU-heavy effects. */
  isMobile: boolean
  /** Screen capture is supported (hidden on iOS Safari). */
  canScreenShare: boolean
  onToggleAudio: () => void
  onToggleVideo: () => void
  onFlipCamera: () => void
  onToggleScreenShare: () => void
  onToggleNoiseSuppression: () => void
  onToggleBackgroundBlur: () => void
  onToggleChat: () => void
  onLeave: () => void
}

/**
 * Fixed, pill-shaped call controls. The set adapts to the device: phones get a
 * flip-camera button and drop the CPU-heavy effects (blur, noise) and screen
 * share, which keeps the bar from overflowing a narrow screen.
 */
export function ControlBar({
  mediaState,
  localSpeaking,
  chatOpen,
  chatUnread,
  isMobile,
  canScreenShare,
  onToggleAudio,
  onToggleVideo,
  onFlipCamera,
  onToggleScreenShare,
  onToggleNoiseSuppression,
  onToggleBackgroundBlur,
  onToggleChat,
  onLeave,
}: ControlBarProps) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 flex justify-center px-2 sm:px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
    >
      {/* Compact sizing under sm so all controls fit a narrow phone; the
          overflow scroll is a last-resort safety net for tiny viewports. */}
      <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-zinc-900/90 p-1.5 shadow-lg backdrop-blur sm:gap-2 sm:p-2">
        <ControlButton
          active={!mediaState.audioEnabled}
          speaking={mediaState.audioEnabled && localSpeaking}
          disabled={!mediaState.hasMic}
          onClick={onToggleAudio}
          label={mediaState.audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          {mediaState.audioEnabled ? (
            <Mic className="size-4 sm:size-5" />
          ) : (
            <MicOff className="size-4 sm:size-5" />
          )}
        </ControlButton>

        <ControlButton
          active={!mediaState.videoEnabled}
          disabled={!mediaState.hasCamera}
          onClick={onToggleVideo}
          label={mediaState.videoEnabled ? 'Turn camera off' : 'Turn camera on'}
        >
          {mediaState.videoEnabled ? (
            <Video className="size-4 sm:size-5" />
          ) : (
            <VideoOff className="size-4 sm:size-5" />
          )}
        </ControlButton>

        {isMobile && mediaState.hasCamera && mediaState.hasMultipleCameras && (
          <ControlButton onClick={onFlipCamera} label="Flip camera">
            <SwitchCamera className="size-4 sm:size-5" />
          </ControlButton>
        )}

        {/* CPU-heavy effects are desktop-only — they overheat phones in a mesh. */}
        {!isMobile && (
          <>
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
              <AudioLines className="size-4 sm:size-5" />
            </ControlButton>

            <ControlButton
              active={mediaState.backgroundBlur}
              highlight
              onClick={onToggleBackgroundBlur}
              label={
                mediaState.backgroundBlur
                  ? 'Background blur on'
                  : 'Background blur off'
              }
            >
              <Aperture className="size-4 sm:size-5" />
            </ControlButton>
          </>
        )}

        {canScreenShare && (
          <ControlButton
            active={mediaState.screenSharing}
            highlight
            onClick={onToggleScreenShare}
            label={
              mediaState.screenSharing ? 'Stop sharing screen' : 'Share screen'
            }
          >
            <MonitorUp className="size-4 sm:size-5" />
          </ControlButton>
        )}

        <ControlButton
          active={chatOpen}
          highlight
          onClick={onToggleChat}
          label={chatOpen ? 'Close chat' : 'Open chat'}
          badge={chatUnread}
        >
          <MessageSquare className="size-4 sm:size-5" />
        </ControlButton>

        <div className="mx-0.5 h-6 w-px shrink-0 bg-white/10 sm:mx-1" />

        <ControlButton onClick={onLeave} destructive label="Leave call">
          <PhoneOff className="size-4 sm:size-5" />
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
  badge,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  active?: boolean
  destructive?: boolean
  highlight?: boolean
  speaking?: boolean
  badge?: number
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'relative flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-colors sm:size-11',
        'bg-white/5 hover:bg-white/10',
        active && !destructive && 'bg-red-500/90 hover:bg-red-500',
        highlight && active && 'bg-primary hover:bg-primary/90',
        destructive && 'bg-red-500/90 hover:bg-red-500',
        speaking && 'bg-primary/20',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-white/5',
      )}
    >
      {speaking && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
      )}
      <span className="relative">{children}</span>
      {badge && badge > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  )
}
