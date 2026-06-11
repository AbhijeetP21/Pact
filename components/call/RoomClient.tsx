'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, AudioLines, Loader2, MonitorX, Users } from 'lucide-react'

import { useCall } from '@/hooks/useCall'
import { useAudioLevel } from '@/hooks/useAudioLevel'
import { cn, isWebRTCSupported } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { ControlBar } from '@/components/call/ControlBar'
import { LocalPreview } from '@/components/call/LocalPreview'
import { ParticipantGrid } from '@/components/call/ParticipantGrid'

export type RoomClientProps = {
  slug: string
  roomName: string | null
  maxParticipants: number
  user: {
    id: string
    displayName: string
    avatarUrl: string | null
  }
}

export function RoomClient(props: RoomClientProps) {
  // Resolved after mount to avoid an SSR/client mismatch. null = still checking.
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => setSupported(isWebRTCSupported()), [])

  if (supported === null) {
    return (
      <CenteredMessage
        icon={<Loader2 className="size-6 animate-spin text-primary" />}
        title="Loading…"
        body=""
      />
    )
  }

  if (!supported) {
    return (
      <CenteredMessage
        icon={<MonitorX className="size-6 text-muted-foreground" />}
        title="This browser isn't supported"
        body="Pact needs WebRTC and camera/microphone access. Try the latest Chrome, Edge, Firefox, or Safari."
        action={
          <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            Back to home
          </Link>
        }
      />
    )
  }

  return <CallExperience {...props} />
}

function CallExperience({ slug, roomName, maxParticipants, user }: RoomClientProps) {
  const {
    participants,
    mediaState,
    callStatus,
    inLobby,
    roomFull,
    join,
    toggleAudio,
    toggleVideo,
    toggleNoiseSuppression,
    startScreenShare,
    stopScreenShare,
    leaveCall,
  } = useCall({ slug, maxParticipants, user })

  // Local speaking drives the local tile ring and the mic button pulse.
  const localSpeaking = useAudioLevel(
    mediaState.localStream,
    mediaState.audioEnabled,
  )

  if (callStatus === 'acquiring-media') {
    return (
      <CenteredMessage
        icon={<Loader2 className="size-6 animate-spin text-primary" />}
        title="Setting up your camera and microphone"
        body="Allow access when your browser asks."
      />
    )
  }

  if (callStatus === 'error') {
    return (
      <CenteredMessage
        title="We couldn't start your call"
        body="Camera/microphone access was blocked, or the room signaling channel failed. Check permissions and reload."
        action={
          <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
            Back to home
          </Link>
        }
      />
    )
  }

  // Lobby: media is ready, but we haven't joined the room yet.
  if (inLobby) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold tracking-tight">
              {roomName ?? 'Private room'}
            </h1>
            <p className="text-sm text-muted-foreground">
              Ready when you are, {user.displayName}.
            </p>
          </div>

          <LocalPreview
            mediaState={mediaState}
            displayName={user.displayName}
            avatarUrl={user.avatarUrl}
            onToggleAudio={toggleAudio}
            onToggleVideo={toggleVideo}
          />

          {roomFull ? (
            <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-center">
              <p className="text-sm font-medium text-destructive">
                This room is full ({maxParticipants}/{maxParticipants}{' '}
                participants)
              </p>
              <Link
                href="/"
                className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
              >
                Back to home
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
                <div className="flex items-center gap-2">
                  <AudioLines className="size-4 text-primary" />
                  <div className="text-sm">
                    <p className="font-medium">Noise cancellation</p>
                    <p className="text-xs text-muted-foreground">
                      Removes background noise on-device.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={mediaState.noiseSuppression}
                  onClick={() => void toggleNoiseSuppression()}
                  className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                    mediaState.noiseSuppression ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 size-5 rounded-full bg-white transition-transform',
                      mediaState.noiseSuppression
                        ? 'translate-x-[1.375rem]'
                        : 'translate-x-0.5',
                    )}
                  />
                </button>
              </div>

              <Button
                size="lg"
                className="h-12 w-full text-base"
                onClick={() => void join()}
              >
                Join call
                <ArrowRight className="size-4" />
              </Button>
            </>
          )}
        </div>
      </main>
    )
  }

  // Active call (connecting / connected / reconnecting).
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <h1 className="text-sm font-medium">{roomName ?? 'Private room'}</h1>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users className="size-3.5" />
            {participants.length} / {maxParticipants}
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <span
            className={cn(
              'inline-block size-1.5 rounded-full',
              callStatus === 'connected'
                ? 'bg-green-500'
                : 'animate-pulse bg-amber-500',
            )}
          />
          {callStatus === 'connected'
            ? 'Connected'
            : callStatus === 'reconnecting'
              ? 'Reconnecting…'
              : 'Connecting…'}
        </Badge>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-28">
        <ParticipantGrid
          participants={participants}
          screenSharing={mediaState.screenSharing}
          localSpeaking={localSpeaking}
        />
      </main>

      <ControlBar
        mediaState={mediaState}
        localSpeaking={localSpeaking}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={() => {
          if (mediaState.screenSharing) void stopScreenShare()
          else void startScreenShare()
        }}
        onToggleNoiseSuppression={() => void toggleNoiseSuppression()}
        onLeave={() => void leaveCall()}
      />
    </div>
  )
}

function CenteredMessage({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      {icon}
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
      </div>
      {action}
    </main>
  )
}
