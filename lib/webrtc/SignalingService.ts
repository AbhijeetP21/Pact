import type {
  RealtimeChannel,
  RealtimePresenceState,
} from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/client'
import { rtcError, rtcLog } from '@/lib/webrtc/log'
import type {
  ChatMessage,
  MediaFlagsPayload,
  PresencePayload,
  SignalMessage,
} from '@/types'

type Callbacks = {
  /** Full roster of peers already present (excludes self). Fires on every sync. */
  onPresenceSync: (existing: PresencePayload[]) => void
  /** A peer that joined after us. */
  onParticipantJoined: (participant: PresencePayload) => void
  /** A peer left. Argument is their peerId (the presence key). */
  onParticipantLeft: (peerId: string) => void
  /** A signaling payload (SDP/ICE) addressed to us arrived from `fromPeerId`. */
  onSignalReceived: (fromPeerId: string, data: object) => void
  /** A session chat message arrived from another participant. */
  onChatMessage: (message: ChatMessage) => void
  /** A peer announced its mic/camera on-off state. */
  onMediaFlags: (payload: MediaFlagsPayload) => void
}

/**
 * Wraps a single Supabase Realtime channel that does double duty:
 *   - Presence: who is in the room (join/leave/sync).
 *   - Broadcast: routes SDP offers/answers and ICE candidates between peers.
 *
 * Each client tracks itself under its `peerId` as the presence key, so the
 * presence key IS the peerId throughout.
 */
export class SignalingService {
  private channel: RealtimeChannel | null = null
  private readonly supabase = createClient()

  constructor(
    private readonly myPeerId: string,
    private readonly callbacks: Callbacks,
  ) {}

  /** Map the raw presence state to payloads, excluding our own entry. */
  private rosterFromState(
    state: RealtimePresenceState<PresencePayload>,
  ): PresencePayload[] {
    return Object.entries(state)
      .filter(([key]) => key !== this.myPeerId)
      .map(([, presences]) => presences[0])
      .filter((p): p is PresencePayload & { presence_ref: string } => Boolean(p))
  }

  async join(slug: string, payload: PresencePayload): Promise<void> {
    const channel = this.supabase.channel(`room:${slug}`, {
      config: {
        presence: { key: this.myPeerId },
        broadcast: { self: false, ack: false },
      },
    })
    this.channel = channel

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresencePayload>()
        const existing = this.rosterFromState(state)
        rtcLog(
          'Signaling',
          `presence sync — ${existing.length} other peer(s):`,
          existing.map((p) => p.peerId),
        )
        this.callbacks.onPresenceSync(existing)
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === this.myPeerId) return
        const joined = newPresences[0] as unknown as PresencePayload | undefined
        if (!joined) return
        rtcLog('Signaling', `peer joined: ${key}`, joined)
        this.callbacks.onParticipantJoined(joined)
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key === this.myPeerId) return
        rtcLog('Signaling', `peer left: ${key}`)
        this.callbacks.onParticipantLeft(key)
      })
      .on(
        'broadcast',
        { event: 'signal' },
        ({ payload }: { payload: SignalMessage }) => {
          if (payload.to !== this.myPeerId) return
          rtcLog(
            'Signaling',
            `signal received from ${payload.from}`,
            describeSignal(payload.data),
          )
          this.callbacks.onSignalReceived(payload.from, payload.data)
        },
      )
      .on(
        'broadcast',
        { event: 'chat' },
        ({ payload }: { payload: ChatMessage }) => {
          this.callbacks.onChatMessage(payload)
        },
      )
      .on(
        'broadcast',
        { event: 'media-flags' },
        ({ payload }: { payload: MediaFlagsPayload }) => {
          this.callbacks.onMediaFlags(payload)
        },
      )

    await new Promise<void>((resolve, reject) => {
      // Once we've successfully subscribed, later status changes (notably
      // CLOSED during leave()) are normal teardown — not failures.
      let settled = false
      channel.subscribe(async (status, err) => {
        rtcLog('Signaling', `channel status: ${status}`)
        if (status === 'SUBSCRIBED') {
          settled = true
          await channel.track(payload)
          rtcLog('Signaling', `tracking self as ${this.myPeerId}`)
          resolve()
        } else if (
          !settled &&
          (status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED')
        ) {
          rtcError('Signaling', `subscription failed: ${status}`, err)
          reject(new Error(`Signaling subscription failed: ${status}`))
        }
      })
    })
  }

  async sendSignal(to: string, data: object): Promise<void> {
    if (!this.channel) {
      rtcError('Signaling', 'sendSignal called before join')
      return
    }
    rtcLog('Signaling', `sending signal to ${to}`, describeSignal(data))
    await this.channel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        type: 'signal',
        from: this.myPeerId,
        to,
        data,
      } satisfies SignalMessage,
    })
  }

  /** Broadcast an ephemeral chat message to everyone in the room. */
  async sendChat(message: ChatMessage): Promise<void> {
    if (!this.channel) return
    await this.channel.send({
      type: 'broadcast',
      event: 'chat',
      payload: message,
    })
  }

  /** Announce our mic/camera on-off state to everyone in the room. */
  async sendMediaFlags(payload: MediaFlagsPayload): Promise<void> {
    if (!this.channel) return
    await this.channel.send({
      type: 'broadcast',
      event: 'media-flags',
      payload,
    })
  }

  /** Current roster (excluding self) from the live presence state. */
  currentRoster(): PresencePayload[] {
    if (!this.channel) return []
    return this.rosterFromState(this.channel.presenceState<PresencePayload>())
  }

  async leave(): Promise<void> {
    if (!this.channel) return
    rtcLog('Signaling', 'leaving channel')
    try {
      await this.channel.untrack()
    } catch {
      // Channel may already be torn down — ignore.
    }
    await this.supabase.removeChannel(this.channel)
    this.channel = null
  }
}

/** Compact, log-friendly description of a simple-peer signal payload. */
function describeSignal(data: unknown): string {
  if (data && typeof data === 'object' && 'type' in data) {
    return String((data as { type: unknown }).type)
  }
  if (data && typeof data === 'object' && 'candidate' in data) {
    return 'ice-candidate'
  }
  return 'signal'
}
