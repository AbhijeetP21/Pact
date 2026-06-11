// Wraps simple-peer instances — one per remote peer.
//
// simple-peer is dynamically imported from its self-contained browser bundle
// (`simplepeer.min.js`), which inlines buffer/process/stream shims. This avoids
// the webpack 5 Node-polyfill issues that `import 'simple-peer'` (index.js)
// would otherwise cause, and keeps it out of any server bundle.

import { rtcError, rtcLog } from '@/lib/webrtc/log'

// simple-peer has no first-class ESM types for the min bundle; treat as any.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SimplePeerInstance = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SimplePeerConstructor = any

let SimplePeer: SimplePeerConstructor = null

async function getSimplePeer(): Promise<SimplePeerConstructor> {
  if (!SimplePeer) {
    const mod = await import('simple-peer/simplepeer.min.js')
    SimplePeer = mod.default ?? mod
  }
  return SimplePeer
}

type Callbacks = {
  onStream: (peerId: string, stream: MediaStream) => void
  onConnectionStateChange: (peerId: string, state: RTCPeerConnectionState) => void
  onSignal: (peerId: string, data: object) => void
  onClose: (peerId: string) => void
  onError: (peerId: string, error: Error) => void
}

export class PeerManager {
  private peers = new Map<string, SimplePeerInstance>()
  private localStream: MediaStream | null = null

  constructor(
    private readonly iceServers: RTCIceServer[],
    private readonly callbacks: Callbacks,
  ) {}

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream
  }

  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId)
  }

  async createPeer(peerId: string, initiator: boolean): Promise<void> {
    const Peer = await getSimplePeer()

    // Destroy any existing peer for this id (reconnect scenario).
    if (this.peers.has(peerId)) {
      destroyQuietly(this.peers.get(peerId))
      this.peers.delete(peerId)
    }

    rtcLog('Peer', `creating peer ${peerId} (initiator=${initiator})`)

    const peer: SimplePeerInstance = new Peer({
      initiator,
      stream: this.localStream ?? undefined,
      config: { iceServers: this.iceServers },
      trickle: true, // trickle ICE for faster connection
      objectMode: false,
    })

    peer.on('signal', (data: object) => {
      this.callbacks.onSignal(peerId, data)
    })

    peer.on('stream', (stream: MediaStream) => {
      rtcLog('Peer', `received remote stream from ${peerId}`)
      this.callbacks.onStream(peerId, stream)
    })

    // Tracks added after the initial offer (e.g. a peer enabling video later,
    // or asymmetric audio-only ↔ video negotiation) arrive as 'track' events.
    // Re-emit the stream so the tile re-binds and starts playing the new track.
    peer.on('track', (_track: MediaStreamTrack, stream: MediaStream) => {
      rtcLog('Peer', `received remote track from ${peerId}`)
      this.callbacks.onStream(peerId, stream)
    })

    peer.on('connect', () => {
      rtcLog('Peer', `data channel connected to ${peerId}`)
      this.callbacks.onConnectionStateChange(peerId, 'connected')
    })

    peer.on('close', () => {
      rtcLog('Peer', `peer ${peerId} closed`)
      this.peers.delete(peerId)
      this.callbacks.onClose(peerId)
    })

    peer.on('error', (err: Error) => {
      // simple-peer emits "Close called" / "User-Initiated Abort" when we
      // intentionally destroy a peer (leave, reconnect). That's not a failure.
      if (peer.__closing || /close called|user-initiated abort/i.test(err.message)) {
        rtcLog('Peer', `peer ${peerId} closed during teardown`)
        return
      }
      rtcError('Peer', `peer ${peerId} error: ${err.message}`)
      this.callbacks.onError(peerId, err)
    })

    // Surface granular ICE/connection state for per-tile badges. simple-peer
    // exposes the underlying RTCPeerConnection as `_pc`, available immediately.
    const pc: RTCPeerConnection | undefined = peer._pc
    if (pc) {
      pc.onconnectionstatechange = () => {
        rtcLog('Peer', `${peerId} connectionState=${pc.connectionState}`)
        this.callbacks.onConnectionStateChange(peerId, pc.connectionState)
      }
    }

    this.peers.set(peerId, peer)
  }

  signal(peerId: string, data: object): void {
    const peer = this.peers.get(peerId)
    if (!peer) {
      rtcError('Peer', `signal() for unknown peer: ${peerId}`)
      return
    }
    try {
      peer.signal(data)
    } catch (err) {
      rtcError('Peer', `signal() threw for ${peerId}`, err)
    }
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId)
    if (peer) {
      destroyQuietly(peer)
      this.peers.delete(peerId)
    }
  }

  /** Replace the outgoing video track on every peer (screen share toggle). */
  async replaceVideoTrack(newTrack: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrackOfKind('video', newTrack)
  }

  /** Replace the outgoing audio track on every peer (noise-suppression toggle). */
  async replaceAudioTrack(newTrack: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrackOfKind('audio', newTrack)
  }

  private async replaceTrackOfKind(
    kind: 'audio' | 'video',
    newTrack: MediaStreamTrack | null,
  ): Promise<void> {
    for (const peerId of this.peers.keys()) {
      const pc = this.getRTCPeerConnection(peerId)
      const sender = pc?.getSenders().find((s) => s.track?.kind === kind)
      if (sender) {
        try {
          await sender.replaceTrack(newTrack)
        } catch (err) {
          rtcError('Peer', `replaceTrack(${kind}) failed for ${peerId}`, err)
        }
      }
    }
  }

  destroyAll(): void {
    this.peers.forEach((peer) => destroyQuietly(peer))
    this.peers.clear()
    rtcLog('Peer', 'destroyed all peers')
  }

  getRTCPeerConnection(peerId: string): RTCPeerConnection | null {
    return this.peers.get(peerId)?._pc ?? null
  }

  getPeerCount(): number {
    return this.peers.size
  }

  getPeerIds(): string[] {
    return Array.from(this.peers.keys())
  }
}

/** Mark a peer as intentionally closing (so its error handler stays quiet)
 * and destroy it, swallowing any throw. */
function destroyQuietly(peer: SimplePeerInstance): void {
  try {
    peer.__closing = true
    peer.destroy()
  } catch {
    // already torn down
  }
}
