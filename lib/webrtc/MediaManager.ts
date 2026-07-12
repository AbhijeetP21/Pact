import {
  BackgroundProcessor,
  tryCreateBlur,
} from '@/lib/webrtc/BackgroundProcessor'
import {
  NoiseSuppressor,
  tryCreateSuppressor,
} from '@/lib/webrtc/NoiseSuppressor'
import { isLikelyMobile } from '@/lib/utils'
import { rtcError, rtcLog } from '@/lib/webrtc/log'

// Always request the browser's built-in DSP (echo cancellation, noise
// suppression, auto gain) on the mic. Stronger ML-based suppression (RNNoise)
// is layered on top by the NoiseSuppressor when enabled.
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

type FacingMode = 'user' | 'environment'

/**
 * Ideal video constraints for a given camera. Phones capture at a lower
 * resolution/frame rate: in a mesh each device uploads its stream to up to four
 * peers, so 720p would drain battery and cellular data for little benefit on a
 * small screen.
 */
function videoConstraints(facingMode: FacingMode): MediaTrackConstraints {
  if (isLikelyMobile()) {
    return {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24, max: 30 },
      facingMode: { ideal: facingMode },
    }
  }
  return {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: { ideal: facingMode },
  }
}

// Constraint sets tried in order, most-capable first. getUserMedia falls back
// gracefully so a user with no camera (or who denies video) can still join
// with audio only.
function constraintFallbacks(facingMode: FacingMode): MediaStreamConstraints[] {
  return [
    { video: videoConstraints(facingMode), audio: AUDIO_CONSTRAINTS },
    { video: { facingMode: { ideal: facingMode } }, audio: AUDIO_CONSTRAINTS },
    { video: false, audio: AUDIO_CONSTRAINTS },
    { video: { facingMode: { ideal: facingMode } }, audio: false },
  ]
}

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
  private facingMode: FacingMode = 'user'

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
    for (const constraints of constraintFallbacks(this.facingMode)) {
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

  getFacingMode(): FacingMode {
    return this.facingMode
  }

  /**
   * Flip between the front and rear camera (mobile). Returns the new video
   * track so the caller can replaceTrack on its peers, or null when there's no
   * camera at all.
   *
   * The old camera is stopped BEFORE the new one is requested: iOS (and many
   * Android builds) allow only one open camera per page, so acquiring the
   * other lens while the current one is live either fails outright or makes
   * the OS kill the live track — the "flip turns my video off" bug. Because
   * the old track is gone, every failure path here must re-acquire *something*
   * (worst case the camera we started with) rather than returning early.
   *
   * Background blur is hidden on mobile, so this is always the no-blur path.
   */
  async switchCamera(): Promise<MediaStreamTrack | null> {
    if (!this.rawStream || this.rawStream.getVideoTracks().length === 0) {
      return null
    }
    const previous = this.facingMode
    const next: FacingMode = previous === 'user' ? 'environment' : 'user'
    const currentDeviceId = this.rawStream
      .getVideoTracks()[0]
      ?.getSettings().deviceId

    // Enumerate BEFORE stopping (labels/ids are stable while a track is live).
    // Cycling by deviceId is the fallback for phones whose facingMode metadata
    // is missing or wrong (seen on several Samsung/Moto builds).
    let cycleDeviceId: string | undefined
    try {
      const cams = (await this.enumerateDevices()).filter(
        (d) => d.kind === 'videoinput' && d.deviceId,
      )
      if (cams.length > 1 && currentDeviceId) {
        const idx = cams.findIndex((d) => d.deviceId === currentDeviceId)
        cycleDeviceId = cams[(idx + 1) % cams.length]?.deviceId
      }
    } catch {
      // enumeration unsupported — facingMode attempts still apply
    }

    // Release the camera so the OS lets us open the other one.
    for (const t of this.rawStream.getVideoTracks()) {
      this.rawStream.removeTrack(t)
      t.stop()
    }

    // Most-specific first; the second-to-last entry re-acquires the previous
    // camera so a failed flip degrades to "nothing changed", and the last is
    // any camera at all — recovering *some* video beats leaving the user dark.
    const attempts: MediaTrackConstraints[] = [
      { ...videoConstraints(next), facingMode: { exact: next } },
      { ...videoConstraints(next), facingMode: { ideal: next } },
    ]
    if (cycleDeviceId) {
      // deviceId and facingMode conflict — send size constraints only.
      const size = { ...videoConstraints(next) }
      delete size.facingMode
      attempts.push({ ...size, deviceId: { exact: cycleDeviceId } })
    }
    attempts.push({ ...videoConstraints(previous), facingMode: { ideal: previous } })
    attempts.push({})

    let newTrack: MediaStreamTrack | null = null
    for (const video of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video,
          audio: false,
        })
        newTrack = stream.getVideoTracks()[0] ?? null
        if (newTrack) break
      } catch (err) {
        rtcError('Media', `camera switch attempt failed`, err)
      }
    }
    if (!newTrack) {
      // Camera is genuinely gone (grabbed by another app / hardware fault).
      // Strip the ended track from the outbound stream too, so tiles bound to
      // it fall back to the avatar instead of rendering a dead video element.
      if (this.localStream) {
        for (const t of this.localStream.getVideoTracks()) {
          this.localStream.removeTrack(t)
        }
      }
      rtcError('Media', 'camera switch failed and rollback failed; camera lost')
      return null
    }

    // Trust the camera we actually got, not the one we asked for, so the local
    // tile's mirroring stays correct on single-camera devices.
    const actual = newTrack.getSettings().facingMode
    this.facingMode =
      actual === 'user' || actual === 'environment' ? actual : next
    newTrack.enabled = this.videoEnabled

    this.rawStream.addTrack(newTrack)
    if (this.localStream) {
      for (const t of this.localStream.getVideoTracks()) {
        this.localStream.removeTrack(t)
      }
      this.localStream.addTrack(newTrack)
    }

    rtcLog('Media', `switched camera to ${this.facingMode}`)
    return newTrack
  }

  enumerateDevices(): Promise<MediaDeviceInfo[]> {
    return navigator.mediaDevices.enumerateDevices()
  }

  /**
   * Whether the device exposes 2+ cameras (i.e. a flip is meaningful). Call
   * after acquiring the stream — the count is only reliable once camera
   * permission has been granted. Returns false if enumeration fails.
   */
  async hasMultipleCameras(): Promise<boolean> {
    try {
      const devices = await this.enumerateDevices()
      return devices.filter((d) => d.kind === 'videoinput').length > 1
    } catch {
      return false
    }
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
