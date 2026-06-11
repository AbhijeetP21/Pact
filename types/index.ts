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
