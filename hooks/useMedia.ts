'use client'

import { useCallback, useRef, useState } from 'react'

import { MediaManager } from '@/lib/webrtc/MediaManager'
import type { MediaState } from '@/types'

const INITIAL_STATE: MediaState = {
  audioEnabled: true,
  videoEnabled: true,
  screenSharing: false,
  // RNNoise is CPU-intensive and can cause robotic/dropout artifacts for the
  // listener on slower machines, so it's opt-in. The browser's native noise
  // suppression (always on via getUserMedia) handles most cases cleanly.
  noiseSuppression: false,
  backgroundBlur: false,
  hasCamera: true,
  hasMic: true,
  hasMultipleCameras: false,
  facingMode: 'user',
  localStream: null,
  displayStream: null,
}

/**
 * Manages the local camera/mic and screen-share state. Track replacement on
 * peer connections is orchestrated by useCall (which owns the senders); this
 * hook owns the streams and the user-facing on/off state.
 */
export function useMedia() {
  const managerRef = useRef<MediaManager | null>(null)
  if (!managerRef.current) {
    managerRef.current = new MediaManager()
  }
  const manager = managerRef.current

  const [mediaState, setMediaState] = useState<MediaState>(INITIAL_STATE)
  const noiseRef = useRef(false)
  const blurRef = useRef(false)

  const acquireLocalStream = useCallback(async () => {
    const stream = await manager.acquireLocalStream(noiseRef.current)
    // Camera count is only reliable once permission has been granted.
    const hasMultipleCameras = manager.hasVideo()
      ? await manager.hasMultipleCameras()
      : false
    setMediaState((prev) => ({
      ...prev,
      localStream: stream,
      audioEnabled: manager.hasAudio(),
      videoEnabled: manager.hasVideo(),
      hasCamera: manager.hasVideo(),
      hasMic: manager.hasAudio(),
      hasMultipleCameras,
      facingMode: manager.getFacingMode(),
    }))
    return stream
  }, [manager])

  /**
   * Toggle RNNoise. Returns the new active audio track so the caller can swap
   * it on its peer connections.
   */
  const toggleNoiseSuppression = useCallback(async () => {
    const next = !noiseRef.current
    noiseRef.current = next
    const track = await manager.setNoiseSuppression(next)
    setMediaState((prev) => ({ ...prev, noiseSuppression: next }))
    return track
  }, [manager])

  /**
   * Toggle background blur. Returns the new active video track so the caller
   * can swap it on its peer connections.
   */
  const toggleBackgroundBlur = useCallback(async () => {
    const next = !blurRef.current
    blurRef.current = next
    const track = await manager.setBackgroundBlur(next)
    setMediaState((prev) => ({ ...prev, backgroundBlur: next }))
    return track
  }, [manager])

  const toggleAudio = useCallback(() => {
    setMediaState((prev) => {
      const next = !prev.audioEnabled
      manager.setTrackEnabled('audio', next)
      return { ...prev, audioEnabled: next }
    })
  }, [manager])

  const toggleVideo = useCallback(() => {
    // No camera → nothing to toggle (avoids a "video on" state with no track).
    if (!manager.hasVideo()) return
    setMediaState((prev) => {
      const next = !prev.videoEnabled
      manager.setTrackEnabled('video', next)
      return { ...prev, videoEnabled: next }
    })
  }, [manager])

  /**
   * Set camera on/off to a specific state (not a toggle) — for callers that
   * change it from the outside (e.g. background-tab auto-pause), so the local
   * UI reflects reality. No-op if already in that state.
   */
  const setVideoEnabled = useCallback(
    (enabled: boolean) => {
      if (!manager.hasVideo()) return
      setMediaState((prev) => {
        if (prev.videoEnabled === enabled) return prev
        manager.setTrackEnabled('video', enabled)
        return { ...prev, videoEnabled: enabled }
      })
    },
    [manager],
  )

  /**
   * Flip between front and rear camera (mobile). Returns the new video track so
   * the caller can swap it on its peer connections.
   */
  const switchCamera = useCallback(async () => {
    const track = await manager.switchCamera()
    if (track) {
      // Same MediaStream object, swapped track — bump state so the preview
      // re-binds reliably across browsers.
      setMediaState((prev) => ({
        ...prev,
        localStream: manager.getLocalStream(),
        facingMode: manager.getFacingMode(),
      }))
    } else if (!manager.hasVideo()) {
      // Total flip failure: the old track was stopped and nothing replaced it.
      // Reflect reality — camera off/gone — so the local tile shows the avatar,
      // the media-flags broadcast tells peers, and the dead controls disappear
      // instead of silently no-oping.
      setMediaState((prev) => ({
        ...prev,
        videoEnabled: false,
        hasCamera: false,
        hasMultipleCameras: false,
      }))
    }
    return track
  }, [manager])

  /** Begin screen sharing; returns the display video track for sender swap. */
  const startScreenShare = useCallback(async () => {
    const display = await manager.getDisplayStream()
    setMediaState((prev) => ({
      ...prev,
      screenSharing: true,
      displayStream: display,
    }))
    return display.getVideoTracks()[0]!
  }, [manager])

  const stopScreenShare = useCallback(() => {
    manager.stopDisplayStream()
    setMediaState((prev) => ({
      ...prev,
      screenSharing: false,
      displayStream: null,
    }))
  }, [manager])

  const stopAll = useCallback(() => {
    manager.stopAll()
    setMediaState({ ...INITIAL_STATE })
  }, [manager])

  return {
    managerRef,
    mediaState,
    acquireLocalStream,
    toggleAudio,
    toggleVideo,
    setVideoEnabled,
    switchCamera,
    toggleNoiseSuppression,
    toggleBackgroundBlur,
    startScreenShare,
    stopScreenShare,
    stopAll,
  }
}

export type UseMediaReturn = ReturnType<typeof useMedia>
