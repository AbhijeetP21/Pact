'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'

import { PeerManager } from '@/lib/webrtc/PeerManager'
import { SignalingService } from '@/lib/webrtc/SignalingService'
import { useMedia } from '@/hooks/useMedia'
import { useParticipants } from '@/hooks/useParticipants'
import { MAX_DISPLAY_NAME_LENGTH } from '@/lib/utils'
import { sanitizeChatImage } from '@/lib/chat/image'
import { rtcError, rtcLog } from '@/lib/webrtc/log'
import type {
  CallStatus,
  ChatImage,
  ChatMessage,
  MediaState,
  Participant,
  PresencePayload,
} from '@/types'

// Client-side fallback if /api/ice-servers is unavailable — STUN still enables
// most same-network and many NAT-traversal connections.
const FALLBACK_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

// Max characters per chat message (same on send and receive).
const MAX_CHAT_LENGTH = 2000
// Cap on messages retained in memory. Untrusted peers could otherwise flood
// the room and grow this array without bound; we keep only the most recent.
// This is a message count, not a character limit — long messages are untouched.
const MAX_CHAT_MESSAGES = 1000

// Base delay before recreating a peer whose ICE connection failed; doubles on
// each attempt (1s, 2s, 4s, 8s, 16s) so persistent failures back off instead
// of hammering a connection that isn't coming back quickly.
const RECONNECT_BASE_DELAY_MS = 1000

// Cap reconnect attempts so a peer that failed but never fired a presence
// 'leave' (crashed tab / network partition) doesn't loop forever every 2s.
const MAX_RECONNECT_ATTEMPTS = 5

export type UseCallParams = {
  slug: string
  maxParticipants: number
  user: { id: string; displayName: string; avatarUrl: string | null }
}

export type UseCallReturn = {
  participants: Participant[]
  localStream: MediaStream | null
  mediaState: MediaState
  callStatus: CallStatus
  selfPeerId: string
  /** Media ready, lobby shown, but not yet connected to the room. */
  inLobby: boolean
  /** Room is at capacity — joining is blocked. */
  roomFull: boolean
  /** Whether a TURN relay is available; null until the first fetch resolves.
   * false means calls between some networks may not connect. */
  turnAvailable: boolean | null
  /** Ephemeral session chat (not persisted; cleared on leave). */
  chatMessages: ChatMessage[]
  sendChat: (text: string, image?: ChatImage) => void
  join: () => Promise<void>
  toggleAudio: () => void
  toggleVideo: () => void
  switchCamera: () => Promise<void>
  toggleNoiseSuppression: () => Promise<void>
  toggleBackgroundBlur: () => Promise<void>
  startScreenShare: () => Promise<void>
  stopScreenShare: () => void
  leaveCall: () => Promise<void>
}

/** Append a chat message, keeping at most MAX_CHAT_MESSAGES (drops oldest). */
function appendChat(prev: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const next = [...prev, message]
  return next.length > MAX_CHAT_MESSAGES
    ? next.slice(next.length - MAX_CHAT_MESSAGES)
    : next
}

type IceConfig = {
  iceServers: RTCIceServer[]
  /** Whether the list includes a TURN relay (drives the lobby warning). */
  turnAvailable: boolean
}

function hasTurnUrl(server: RTCIceServer): boolean {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
  return urls.some((u) => typeof u === 'string' && u.startsWith('turn'))
}

async function fetchIceServers(): Promise<IceConfig> {
  try {
    const res = await fetch('/api/ice-servers')
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as { iceServers?: RTCIceServer[] }
    const iceServers = data.iceServers?.length ? data.iceServers : FALLBACK_ICE
    return { iceServers, turnAvailable: iceServers.some(hasTurnUrl) }
  } catch (err) {
    rtcError('Call', 'ICE fetch failed; using STUN fallback', err)
    return { iceServers: FALLBACK_ICE, turnAvailable: false }
  }
}

export function useCall({
  slug,
  maxParticipants,
  user,
}: UseCallParams): UseCallReturn {
  const router = useRouter()
  const media = useMedia()
  const {
    participants,
    upsertFromPresence,
    patch,
    setStream,
    setConnectionState,
    remove,
    clearRemote,
    reset,
  } = useParticipants()

  // Starts in 'acquiring-media'; becomes 'idle' (lobby) once media is ready,
  // then 'connecting' → 'connected' after the user joins.
  const [callStatus, setCallStatus] = useState<CallStatus>('acquiring-media')
  const [roomFull, setRoomFull] = useState(false)
  const [turnAvailable, setTurnAvailable] = useState<boolean | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  // Stable identity for this session.
  const [self] = useState<PresencePayload>(() => ({
    peerId: nanoid(12),
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    joinedAt: new Date().toISOString(),
  }))

  const signalingRef = useRef<SignalingService | null>(null)
  const peerManagerRef = useRef<PeerManager | null>(null)
  const iceServersRef = useRef<RTCIceServer[]>(FALLBACK_ICE)
  const joinedAtRef = useRef<Map<string, string>>(new Map())
  const creatingRef = useRef<Map<string, Promise<void>>>(new Map())
  const pendingStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  )
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map())
  // Guards overlapping rejoin() runs (flapping online events, channel death
  // mid-rejoin) — mirrors the creatingRef pattern for peer creation.
  const rejoiningRef = useRef(false)
  // Late-bound so buildSignaling (defined before rejoin) can trigger a rejoin
  // when the signaling channel dies without a circular dependency.
  const rejoinRef = useRef<() => void>(() => {})
  const cancelledRef = useRef(false)
  // Latest local mic/camera state, mirrored for broadcasting to peers.
  const mediaFlagsRef = useRef({ audioEnabled: true, videoEnabled: true })
  // Last-known remote mic/camera state, kept so flags that arrive before a
  // peer's presence entry registers can be applied once it's admitted.
  const remoteFlagsRef = useRef<
    Map<string, { audioEnabled: boolean; videoEnabled: boolean }>
  >(new Map())

  // Later joiner initiates: I initiate toward a peer iff my joinedAt is later
  // (ties broken by peerId) — exactly one side of each pair initiates.
  const isInitiator = useCallback(
    (theirJoinedAt: string, theirPeerId: string): boolean => {
      if (self.joinedAt !== theirJoinedAt) return self.joinedAt > theirJoinedAt
      return self.peerId > theirPeerId
    },
    [self],
  )

  const flushPendingStream = useCallback(
    (peerId: string) => {
      const stream = pendingStreamsRef.current.get(peerId)
      if (stream) {
        setStream(peerId, stream)
        pendingStreamsRef.current.delete(peerId)
      }
    },
    [setStream],
  )

  const ensurePeer = useCallback(
    async (peerId: string, joinedAt: string | undefined) => {
      const pm = peerManagerRef.current
      if (!pm || pm.hasPeer(peerId)) return

      const inFlight = creatingRef.current.get(peerId)
      if (inFlight) return inFlight

      const initiator = joinedAt ? isInitiator(joinedAt, peerId) : false
      if (joinedAt) joinedAtRef.current.set(peerId, joinedAt)

      const promise = pm.createPeer(peerId, initiator).finally(() => {
        creatingRef.current.delete(peerId)
      })
      creatingRef.current.set(peerId, promise)
      return promise
    },
    [isInitiator],
  )

  const clearReconnect = useCallback((peerId: string) => {
    const timer = reconnectTimersRef.current.get(peerId)
    if (timer) {
      clearTimeout(timer)
      reconnectTimersRef.current.delete(peerId)
    }
    // A peer that recovered gets its reconnect budget back.
    reconnectAttemptsRef.current.delete(peerId)
  }, [])

  // On ICE failure, recreate the peer after a short delay (if it's still in the
  // room). Deterministic initiator roles mean the handshake re-establishes
  // cleanly without glare. Capped so a vanished-without-leaving peer can't loop.
  const scheduleReconnect = useCallback(
    (peerId: string) => {
      if (reconnectTimersRef.current.has(peerId)) return
      const attempts = reconnectAttemptsRef.current.get(peerId) ?? 0
      if (attempts >= MAX_RECONNECT_ATTEMPTS) {
        rtcError(
          'Call',
          `giving up on peer ${peerId} after ${attempts} reconnect attempts`,
        )
        return
      }
      const delay = RECONNECT_BASE_DELAY_MS * 2 ** attempts
      const timer = setTimeout(() => {
        reconnectTimersRef.current.delete(peerId)
        const joinedAt = joinedAtRef.current.get(peerId)
        const pm = peerManagerRef.current
        if (cancelledRef.current || !joinedAt || !pm) return
        reconnectAttemptsRef.current.set(peerId, attempts + 1)
        rtcLog(
          'Call',
          `reconnecting peer ${peerId} after ICE failure (attempt ${attempts + 1}, waited ${delay}ms)`,
        )
        void pm.createPeer(peerId, isInitiator(joinedAt, peerId))
      }, delay)
      reconnectTimersRef.current.set(peerId, timer)
    },
    [isInitiator],
  )

  /** Add/refresh a presence member: roster entry + peer + any pending stream. */
  const admitMember = useCallback(
    (payload: PresencePayload) => {
      upsertFromPresence(payload)
      joinedAtRef.current.set(payload.peerId, payload.joinedAt)
      // Apply any mic/camera state that arrived before this peer was admitted.
      const flags = remoteFlagsRef.current.get(payload.peerId)
      if (flags) patch(payload.peerId, flags)
      flushPendingStream(payload.peerId)
      // A peer can connect *before* its presence entry registers (its offer
      // arrives via broadcast first). Connection-state updates fired before the
      // roster entry existed were dropped, so re-sync from the live pc here.
      const pc = peerManagerRef.current?.getRTCPeerConnection(payload.peerId)
      if (pc) setConnectionState(payload.peerId, pc.connectionState)
      void ensurePeer(payload.peerId, payload.joinedAt)
    },
    [
      upsertFromPresence,
      flushPendingStream,
      setConnectionState,
      ensurePeer,
      patch,
    ],
  )

  const buildPeerManager = useCallback(
    (localStream: MediaStream) => {
      const peerManager = new PeerManager(iceServersRef.current, {
        onSignal: (peerId, data) => {
          void signalingRef.current?.sendSignal(peerId, data)
        },
        onStream: (peerId, stream) => {
          setStream(peerId, stream)
          pendingStreamsRef.current.set(peerId, stream)
        },
        onConnectionStateChange: (peerId, state) => {
          setConnectionState(peerId, state)
          if (state === 'failed') scheduleReconnect(peerId)
          else if (state === 'connected') clearReconnect(peerId)
        },
        onClose: (peerId) => {
          setConnectionState(peerId, 'closed')
        },
        onError: (peerId, err) => {
          rtcError('Call', `peer ${peerId} error`, err.message)
          setConnectionState(peerId, 'failed')
        },
      })
      peerManager.setLocalStream(localStream)
      return peerManager
    },
    [setStream, setConnectionState, scheduleReconnect, clearReconnect],
  )

  // ---- Phase 1: acquire media + prepare managers (lobby), no signaling yet ----
  useEffect(() => {
    cancelledRef.current = false
    setRoomFull(false)

    async function prepare() {
      setCallStatus('acquiring-media')

      let localStream: MediaStream
      try {
        localStream = await media.acquireLocalStream()
      } catch (err) {
        if (cancelledRef.current) return
        rtcError('Call', 'media acquisition failed', err)
        setCallStatus('error')
        return
      }
      if (cancelledRef.current) return

      upsertFromPresence(self, { isLocal: true })
      setStream(self.peerId, localStream)

      const ice = await fetchIceServers()
      if (cancelledRef.current) return
      iceServersRef.current = ice.iceServers
      setTurnAvailable(ice.turnAvailable)

      peerManagerRef.current = buildPeerManager(localStream)

      // Media + managers ready → show the lobby. Capacity is enforced at
      // join time (see the currentRoster check in join()).
      setCallStatus('idle')
    }

    void prepare()

    return () => {
      cancelledRef.current = true
      reconnectTimersRef.current.forEach((t) => clearTimeout(t))
      reconnectTimersRef.current.clear()
      reconnectAttemptsRef.current.clear()
      peerManagerRef.current?.destroyAll()
      peerManagerRef.current = null
      void signalingRef.current?.leave()
      signalingRef.current = null
      media.stopAll()
      joinedAtRef.current.clear()
      creatingRef.current.clear()
      pendingStreamsRef.current.clear()
      remoteFlagsRef.current.clear()
      reset()
      setChatMessages([])
      setCallStatus('acquiring-media')
    }
    // Run once per room mount; all dependencies are stable refs/callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  // Announce our current mic/camera state to peers. No-op until we've joined.
  const broadcastMediaFlags = useCallback(() => {
    void signalingRef.current?.sendMediaFlags({
      peerId: self.peerId,
      audioEnabled: mediaFlagsRef.current.audioEnabled,
      videoEnabled: mediaFlagsRef.current.videoEnabled,
    })
  }, [self.peerId])

  const buildSignaling = useCallback(() => {
    return new SignalingService(self.peerId, {
      onPresenceSync: (existing) => existing.forEach(admitMember),
      onParticipantJoined: (participant) => {
        admitMember(participant)
        // A newcomer doesn't know our current mic/camera state — tell them.
        broadcastMediaFlags()
      },
      onParticipantLeft: (peerId) => {
        clearReconnect(peerId)
        peerManagerRef.current?.removePeer(peerId)
        joinedAtRef.current.delete(peerId)
        pendingStreamsRef.current.delete(peerId)
        remoteFlagsRef.current.delete(peerId)
        remove(peerId)
      },
      onSignalReceived: async (fromPeerId, data) => {
        // Guard the signal-before-presence race: a peer may broadcast an offer
        // to us before our presence sync registers them. They are the
        // initiator, so we create our (non-initiator) side on demand.
        await ensurePeer(fromPeerId, joinedAtRef.current.get(fromPeerId))
        peerManagerRef.current?.signal(fromPeerId, data)
      },
      onChatMessage: (message) =>
        setChatMessages((prev) =>
          // Inbound payloads are untrusted: clamp the length-bearing fields and
          // cap retention so a peer can't flood us out of memory.
          appendChat(prev, {
            ...message,
            text: String(message.text ?? '').slice(0, MAX_CHAT_LENGTH),
            displayName: String(message.displayName ?? '').slice(
              0,
              MAX_DISPLAY_NAME_LENGTH,
            ),
            image: sanitizeChatImage(message.image),
          }),
        ),
      onMediaFlags: ({ peerId, audioEnabled, videoEnabled }) => {
        remoteFlagsRef.current.set(peerId, { audioEnabled, videoEnabled })
        patch(peerId, { audioEnabled, videoEnabled })
      },
      onChannelDied: () => {
        // The Realtime channel dropped server-side (not a local network blip,
        // which the 'online' listener covers). Without this, presence and
        // signaling silently stop while everyone thinks the room is healthy.
        rtcLog('Call', 'signaling channel dropped — rejoining room')
        rejoinRef.current()
      },
    })
  }, [
    self,
    admitMember,
    ensurePeer,
    remove,
    clearReconnect,
    patch,
    broadcastMediaFlags,
  ])

  const sendChat = useCallback(
    (text: string, image?: ChatImage) => {
      const trimmed = text.trim()
      // Allow an image-only message (no text), but require at least one.
      if ((!trimmed && !image) || !signalingRef.current) return
      const message: ChatMessage = {
        id: nanoid(8),
        from: self.peerId,
        displayName: self.displayName,
        text: trimmed.slice(0, MAX_CHAT_LENGTH),
        ...(image ? { image } : {}),
        at: Date.now(),
      }
      // broadcast { self: false } means we won't receive our own — append now.
      setChatMessages((prev) => appendChat(prev, message))
      void signalingRef.current.sendChat(message)
    },
    [self],
  )

  // ---- Phase 2: join the room signaling channel (called from the lobby) ----
  const join = useCallback(async () => {
    if (signalingRef.current || !peerManagerRef.current) return

    const signaling = buildSignaling()
    // Assign the ref *before* joining: presence sync fires during join() and
    // triggers initiator-side offers whose 'signal' callback reads
    // signalingRef.current. Assigning only after the await let a fast
    // (module-cached) handshake emit an offer while the ref was still null,
    // silently dropping it. Null it back out on every early-return path below.
    signalingRef.current = signaling

    setCallStatus('connecting')
    try {
      await signaling.join(slug, self)
    } catch (err) {
      signalingRef.current = null
      // Release the half-open channel (e.g. on subscribe timeout) so it doesn't
      // linger subscribed until the page reloads.
      void signaling.leave()
      if (cancelledRef.current) return
      rtcError('Call', 'signaling join failed', err)
      setCallStatus('error')
      return
    }
    if (cancelledRef.current) {
      signalingRef.current = null
      void signaling.leave()
      return
    }

    // Join-time safeguard against the headcount race: if the room filled while
    // we were connecting, back out cleanly.
    if (signaling.currentRoster().length >= maxParticipants) {
      signalingRef.current = null
      await signaling.leave()
      setRoomFull(true)
      setCallStatus('idle')
      return
    }

    setCallStatus('connected')
    // Announce our current mic/camera state to peers already in the room.
    broadcastMediaFlags()
    rtcLog('Call', `joined room ${slug} as ${self.peerId}`)
  }, [slug, self, maxParticipants, buildSignaling, broadcastMediaFlags])

  // ---- Network resilience: rejoin on reconnect ----
  const rejoin = useCallback(async () => {
    if (rejoiningRef.current || !peerManagerRef.current) return
    rejoiningRef.current = true
    try {
      setCallStatus('reconnecting')

      // Refresh ICE servers: TURN credentials may have expired — or recovered —
      // since mount, and recreated peers should get the current set rather than
      // retrying forever with a stale one.
      const ice = await fetchIceServers()
      // The room may unmount while we awaited (leave/navigation).
      if (cancelledRef.current || !peerManagerRef.current) return
      iceServersRef.current = ice.iceServers
      setTurnAvailable(ice.turnAvailable)
      peerManagerRef.current.setIceServers(ice.iceServers)

      reconnectTimersRef.current.forEach((t) => clearTimeout(t))
      reconnectTimersRef.current.clear()
      reconnectAttemptsRef.current.clear()
      peerManagerRef.current.destroyAll()
      joinedAtRef.current.clear()
      creatingRef.current.clear()
      pendingStreamsRef.current.clear()
      remoteFlagsRef.current.clear()
      clearRemote()

      await signalingRef.current?.leave()
      signalingRef.current = null
      await join()
    } finally {
      rejoiningRef.current = false
    }
  }, [join, clearRemote])

  // Keep the late-bound handle (used by onChannelDied) pointing at the latest
  // rejoin closure.
  useEffect(() => {
    rejoinRef.current = () => void rejoin()
  }, [rejoin])

  useEffect(() => {
    function onOnline() {
      // Only act if we were actually in a call.
      if (!signalingRef.current) return
      rtcLog('Call', 'network back online — rejoining room')
      void rejoin()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [rejoin])

  // Keep the local participant's media flags + preview stream in sync.
  useEffect(() => {
    const previewStream =
      media.mediaState.screenSharing && media.mediaState.displayStream
        ? media.mediaState.displayStream
        : media.mediaState.localStream
    patch(self.peerId, {
      audioEnabled: media.mediaState.audioEnabled,
      videoEnabled: media.mediaState.videoEnabled,
      stream: previewStream,
    })
    // Mirror + announce our mic/camera state so peers' tiles reflect it.
    mediaFlagsRef.current = {
      audioEnabled: media.mediaState.audioEnabled,
      videoEnabled: media.mediaState.videoEnabled,
    }
    broadcastMediaFlags()
  }, [
    media.mediaState.audioEnabled,
    media.mediaState.videoEnabled,
    media.mediaState.screenSharing,
    media.mediaState.displayStream,
    media.mediaState.localStream,
    patch,
    self.peerId,
    broadcastMediaFlags,
  ])

  const stopScreenShareInternal = useCallback(async () => {
    const cameraTrack = media.managerRef.current?.getCameraVideoTrack() ?? null
    await peerManagerRef.current?.replaceVideoTrack(cameraTrack)
    media.stopScreenShare()
  }, [media])

  const startScreenShare = useCallback(async () => {
    try {
      const track = await media.startScreenShare()
      await peerManagerRef.current?.replaceVideoTrack(track)
      // Browser "Stop sharing" button ends the track → revert.
      track.addEventListener('ended', () => void stopScreenShareInternal())
    } catch (err) {
      rtcError('Call', 'screen share failed', err)
    }
  }, [media, stopScreenShareInternal])

  const switchCamera = useCallback(async () => {
    const newTrack = await media.switchCamera()
    if (!newTrack) {
      // Every acquisition attempt failed (camera busy/removed mid-switch). The
      // old track is already stopped, so the local tile falls back to the
      // avatar — tell the user rather than leaving them silently dark.
      toast.error('Couldn’t switch camera. Try again.')
      return
    }
    // Don't disturb the video sender while a screen share owns it.
    if (!media.mediaState.screenSharing) {
      await peerManagerRef.current?.replaceVideoTrack(newTrack)
    }
  }, [media])

  // Backgrounding the app (phone home screen, app switch) freezes the camera —
  // peers would stare at a frozen frame while the stale video keeps eating
  // uplink that the audio needs. Pause the camera while hidden (others see the
  // avatar) and restore it when the app returns. Screen shares are exempt:
  // presenting from another app/tab is the whole point of a share.
  const hiddenPausedVideoRef = useRef(false)
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        if (
          callStatus === 'connected' &&
          media.mediaState.videoEnabled &&
          !media.mediaState.screenSharing
        ) {
          hiddenPausedVideoRef.current = true
          media.setVideoEnabled(false)
        }
      } else if (hiddenPausedVideoRef.current) {
        hiddenPausedVideoRef.current = false
        media.setVideoEnabled(true)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [callStatus, media])

  const toggleNoiseSuppression = useCallback(async () => {
    const newTrack = await media.toggleNoiseSuppression()
    // Swap the cleaned/raw audio track on every peer connection.
    if (newTrack) await peerManagerRef.current?.replaceAudioTrack(newTrack)
  }, [media])

  const toggleBackgroundBlur = useCallback(async () => {
    const newTrack = await media.toggleBackgroundBlur()
    // Only swap on peers when we're actually sending the camera (a screen
    // share owns the video sender until it stops, then reverts to this track).
    if (newTrack && !media.mediaState.screenSharing) {
      await peerManagerRef.current?.replaceVideoTrack(newTrack)
    }
  }, [media])

  const leaveCall = useCallback(async () => {
    reconnectTimersRef.current.forEach((t) => clearTimeout(t))
    reconnectTimersRef.current.clear()
    reconnectAttemptsRef.current.clear()
    peerManagerRef.current?.destroyAll()
    peerManagerRef.current = null
    await signalingRef.current?.leave()
    signalingRef.current = null
    media.stopAll()
    reset()
    router.push('/')
  }, [media, reset, router])

  return {
    participants,
    localStream: media.mediaState.localStream,
    mediaState: media.mediaState,
    callStatus,
    selfPeerId: self.peerId,
    inLobby: callStatus === 'idle',
    roomFull,
    turnAvailable,
    chatMessages,
    sendChat,
    join,
    toggleAudio: media.toggleAudio,
    toggleVideo: media.toggleVideo,
    switchCamera,
    toggleNoiseSuppression,
    toggleBackgroundBlur,
    startScreenShare,
    stopScreenShare: stopScreenShareInternal,
    leaveCall,
  }
}
