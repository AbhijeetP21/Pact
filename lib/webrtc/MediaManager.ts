import {
  BackgroundProcessor,
  tryCreateBlur,
} from '@/lib/webrtc/BackgroundProcessor'
import {
  NoiseSuppressor,
  tryCreateSuppressor,
} from '@/lib/webrtc/NoiseSuppressor'
import { rtcError, rtcLog } from '@/lib/webrtc/log'

// Always request the browser's built-in DSP (echo cancellation, noise
// suppression, auto gain) on the mic. Stronger ML-based suppression (RNNoise)
// is layered on top by the NoiseSuppressor when enabled.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

// Constraint sets tried in order, most-capable first. getUserMedia falls back
// gracefully so a user with no camera (or who denies video) can still join
// with audio only.
const CONSTRAINT_FALLBACKS: MediaStreamConstraints[] = [
  {
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: AUDIO_CONSTRAINTS,
  },
  { video: true, audio: AUDIO_CONSTRAINTS },
  { video: false, audio: AUDIO_CONSTRAINTS },
  { video: true, audio: false },
]

/**
 * Owns the local media: the raw camera/mic stream, an optional RNNoise-cleaned
 * audio track, the composed outbound stream, and the screen-share display
 * stream. Track toggling uses `track.enabled` (no renegotiation); screen share
 * and noise-suppression toggling swap tracks via the caller's RTCRtpSenders.
 */
export class MediaManager {
  private rawStream: MediaStream | null = null
  private localStream: MediaStream | null = null
  private displayStream: MediaStream | null = null
  private suppressor: NoiseSuppressor | null = null
  private cleanedTrack: MediaStreamTrack | null = null
  private blurProcessor: BackgroundProcessor | null = null
  private blurredTrack: MediaStreamTrack | null = null
  private audioEnabled = true
  private videoEnabled = true

  /**
   * Acquire camera/mic, optionally routing the mic through RNNoise, and return
   * the composed outbound stream (cleaned-or-raw audio + camera video).
   */
  async acquireLocalStream(noiseSuppression = true): Promise<MediaStream> {
    const raw = await this.getUserMediaWithFallback()
    this.rawStream = raw

    const composed = new MediaStream()

    const rawAudio = raw.getAudioTracks()[0] ?? null
    if (rawAudio) {
      let audioTrack = rawAudio
      if (noiseSuppression) {
        const result = await tryCreateSuppressor(raw)
        if (result) {
          this.suppressor = result.suppressor
          this.cleanedTrack = result.track
          audioTrack = result.track
        }
      }
      audioTrack.enabled = this.audioEnabled
      composed.addTrack(audioTrack)
    }

    for (const video of raw.getVideoTracks()) composed.addTrack(video)

    this.localStream = composed
    rtcLog(
      'Media',
      `local stream ready (${composed.getVideoTracks().length}v/${composed.getAudioTracks().length}a, rnnoise=${Boolean(this.cleanedTrack)})`,
    )
    return composed
  }

  private async getUserMediaWithFallback(): Promise<MediaStream> {
    let lastError: unknown = null
    for (const constraints of CONSTRAINT_FALLBACKS) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err) {
        lastError = err
        if (err instanceof DOMException && err.name === 'NotAllowedError') break
      }
    }
    rtcError('Media', 'failed to acquire local media', lastError)
    throw lastError instanceof Error
      ? lastError
      : new Error('Could not access camera or microphone')
  }

  getLocalStream(): MediaStream | null {
    return this.localStream
  }

  /** The active camera-side video track (blurred when enabled, else raw). */
  getCameraVideoTrack(): MediaStreamTrack | null {
    return this.blurredTrack ?? this.rawStream?.getVideoTracks()[0] ?? null
  }

  getActiveAudioTrack(): MediaStreamTrack | null {
    return this.localStream?.getAudioTracks()[0] ?? null
  }

  hasVideo(): boolean {
    return (this.rawStream?.getVideoTracks().length ?? 0) > 0
  }

  hasAudio(): boolean {
    return (this.rawStream?.getAudioTracks().length ?? 0) > 0
  }

  /** Enable/disable a track kind in place. Returns the resulting enabled state. */
  setTrackEnabled(kind: 'audio' | 'video', enabled: boolean): boolean {
    if (kind === 'audio') this.audioEnabled = enabled
    else this.videoEnabled = enabled
    const tracks =
      kind === 'audio'
        ? this.localStream?.getAudioTracks()
        : this.localStream?.getVideoTracks()
    tracks?.forEach((t) => {
      t.enabled = enabled
    })
    return enabled
  }

  /**
   * Toggle RNNoise on/off, swapping the outbound audio track. Returns the new
   * active audio track (so the caller can replaceTrack on its peers), or null
   * if there's no microphone.
   */
  async setNoiseSuppression(enabled: boolean): Promise<MediaStreamTrack | null> {
    if (!this.rawStream || this.rawStream.getAudioTracks().length === 0) {
      return null
    }

    let nextTrack: MediaStreamTrack | null
    if (enabled) {
      if (!this.cleanedTrack) {
        const result = await tryCreateSuppressor(this.rawStream)
        if (result) {
          this.suppressor = result.suppressor
          this.cleanedTrack = result.track
        }
      }
      nextTrack = this.cleanedTrack ?? this.rawStream.getAudioTracks()[0] ?? null
    } else {
      // Tear down the graph and fall back to the raw mic track.
      this.suppressor?.destroy()
      this.suppressor = null
      this.cleanedTrack = null
      nextTrack = this.rawStream.getAudioTracks()[0] ?? null
    }

    if (!nextTrack || !this.localStream) return nextTrack

    for (const t of this.localStream.getAudioTracks()) {
      this.localStream.removeTrack(t)
    }
    nextTrack.enabled = this.audioEnabled
    this.localStream.addTrack(nextTrack)
    rtcLog('Media', `noise suppression ${enabled ? 'on' : 'off'}`)
    return nextTrack
  }

  /**
   * Toggle background blur on/off, swapping the outbound video track. Returns
   * the new active video track (so the caller can replaceTrack on its peers),
   * or null if there's no camera.
   */
  async setBackgroundBlur(enabled: boolean): Promise<MediaStreamTrack | null> {
    const rawVideo = this.rawStream?.getVideoTracks()[0] ?? null
    if (!rawVideo) return null

    let nextTrack: MediaStreamTrack | null
    if (enabled) {
      if (!this.blurredTrack) {
        const result = await tryCreateBlur(new MediaStream([rawVideo]))
        if (result) {
          this.blurProcessor = result.processor
          this.blurredTrack = result.track
        }
      }
      nextTrack = this.blurredTrack ?? rawVideo
    } else {
      this.blurProcessor?.stop()
      this.blurProcessor = null
      this.blurredTrack = null
      nextTrack = rawVideo
    }

    if (!this.localStream) return nextTrack

    for (const t of this.localStream.getVideoTracks()) {
      this.localStream.removeTrack(t)
    }
    nextTrack.enabled = this.videoEnabled
    this.localStream.addTrack(nextTrack)
    rtcLog('Media', `background blur ${enabled ? 'on' : 'off'}`)
    return nextTrack
  }

  /** Acquire a screen-share display stream. */
  async getDisplayStream(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })
    this.displayStream = stream
    rtcLog('Media', 'acquired display stream for screen share')
    return stream
  }

  getCurrentDisplayStream(): MediaStream | null {
    return this.displayStream
  }

  stopDisplayStream(): void {
    this.displayStream?.getTracks().forEach((t) => t.stop())
    this.displayStream = null
  }

  enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return navigator.mediaDevices.enumerateDevices()
  }

  /** Stop all tracks and release every resource. */
  stopAll(): void {
    this.suppressor?.destroy()
    this.suppressor = null
    this.cleanedTrack?.stop()
    this.cleanedTrack = null
    this.blurProcessor?.stop()
    this.blurProcessor = null
    this.blurredTrack = null
    this.rawStream?.getTracks().forEach((t) => t.stop())
    this.localStream?.getTracks().forEach((t) => t.stop())
    this.stopDisplayStream()
    this.rawStream = null
    this.localStream = null
    rtcLog('Media', 'stopped all local media')
  }
}
