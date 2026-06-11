'use client'

import { Mic, MicOff, Video, VideoOff } from 'lucide-react'

import { useAudioLevel } from '@/hooks/useAudioLevel'
import { cn, initialsFromName } from '@/lib/utils'
import type { MediaState } from '@/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { StreamVideo } from '@/components/call/StreamVideo'

/**
 * Lobby camera/mic preview shown before joining. Lets the user check and toggle
 * their devices, with a live speaking indicator, so they're never surprised by
 * how they appear once in the call.
 */
export function LocalPreview({
  mediaState,
  displayName,
  avatarUrl,
  onToggleAudio,
  onToggleVideo,
}: {
  mediaState: MediaState
  displayName: string
  avatarUrl: string | null
  onToggleAudio: () => void
  onToggleVideo: () => void
}) {
  const speaking = useAudioLevel(mediaState.localStream, mediaState.audioEnabled)
  const showVideo = Boolean(mediaState.videoEnabled && mediaState.localStream)

  return (
    <div
      className={cn(
        'relative aspect-video w-full overflow-hidden rounded-xl border bg-zinc-900 transition-shadow',
        speaking
          ? 'border-primary shadow-[0_0_0_2px_var(--color-primary)]'
          : 'border-white/[0.08]',
      )}
    >
      {showVideo ? (
        <StreamVideo stream={mediaState.localStream} muted mirror />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Avatar className="size-24">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
            <AvatarFallback className="text-3xl">
              {initialsFromName(displayName)}
            </AvatarFallback>
          </Avatar>
        </div>
      )}

      {/* In-preview device toggles. */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/60 to-transparent p-4">
        <PreviewToggle
          off={!mediaState.audioEnabled}
          onClick={onToggleAudio}
          label={mediaState.audioEnabled ? 'Mute microphone' : 'Unmute microphone'}
        >
          {mediaState.audioEnabled ? (
            <Mic className="size-5" />
          ) : (
            <MicOff className="size-5" />
          )}
        </PreviewToggle>
        <PreviewToggle
          off={!mediaState.videoEnabled}
          onClick={onToggleVideo}
          label={mediaState.videoEnabled ? 'Turn camera off' : 'Turn camera on'}
        >
          {mediaState.videoEnabled ? (
            <Video className="size-5" />
          ) : (
            <VideoOff className="size-5" />
          )}
        </PreviewToggle>
      </div>
    </div>
  )
}

function PreviewToggle({
  children,
  onClick,
  label,
  off,
}: {
  children: React.ReactNode
  onClick: () => void
  label: string
  off?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-11 items-center justify-center rounded-full text-white transition-colors',
        off ? 'bg-red-500/90 hover:bg-red-500' : 'bg-white/10 hover:bg-white/20',
      )}
    >
      {children}
    </button>
  )
}
