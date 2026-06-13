// Shared application types for Pact.

export interface Room {
  id: string
  slug: string
  display_name: string | null
  created_by: string
  created_at: string
  expires_at: string | null
  max_participants: number
  is_active: boolean
}

export interface Participant {
  peerId: string // Unique session ID (nanoid, regenerated each join)
  userId: string // Supabase auth user ID
  displayName: string
  avatarUrl: string | null
  stream: MediaStream | null // null until WebRTC stream arrives
  connectionState: RTCPeerConnectionState
  audioEnabled: boolean
  videoEnabled: boolean
  isLocal: boolean
}

export type SignalMessage = {
  type: 'signal'
  from: string // sender peerId
  to: string // recipient peerId
  data: object // simple-peer signal payload (SDP or ICE candidate)
}

/** A pasted image attached to a chat message (compressed JPEG data URL). */
export type ChatImage = {
  src: string // data:image/jpeg;base64,…
  width: number // intrinsic px (drives the thumbnail aspect ratio)
  height: number
}

export type ChatMessage = {
  id: string
  from: string // sender peerId
  displayName: string
  text: string // may be '' for an image-only message
  image?: ChatImage // optional pasted image (one per message)
  at: number // epoch ms — when it was sent
}

export type MediaFlagsPayload = {
  peerId: string
  audioEnabled: boolean
  videoEnabled: boolean
}

export type PresencePayload = {
  peerId: string
  userId: string
  displayName: string
  avatarUrl: string | null
  joinedAt: string // ISO timestamp — used to determine initiator
}

export type MediaState = {
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharing: boolean
  noiseSuppression: boolean
  backgroundBlur: boolean
  /** Whether a camera/mic device is actually present (drives disabled toggles). */
  hasCamera: boolean
  hasMic: boolean
  /** 2+ cameras present — gates the flip-camera button (like FaceTime/Meet). */
  hasMultipleCameras: boolean
  /** Active camera; the rear camera is shown un-mirrored, like the front isn't. */
  facingMode: 'user' | 'environment'
  localStream: MediaStream | null
  displayStream: MediaStream | null
}

export type CallStatus =
  | 'idle'
  | 'acquiring-media'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
