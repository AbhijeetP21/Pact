'use client'

import { useCallback, useRef, useState } from 'react'

import { MediaManager } from '@/lib/webrtc/MediaManager'
import type { MediaState } from '@/types'

const INITIAL_STATE: MediaState = {
  audioEnabled: true,
  videoEnabled: true,
  screenSharing: false,
  noiseSuppression: true,
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
  const noiseRef = useRef(true)

  const acquireLocalStream = useCallback(async () => {
    const stream = await manager.acquireLocalStream(noiseRef.current)
    setMediaState((prev) => ({
      ...prev,
      localStream: stream,
      audioEnabled: manager.hasAudio(),
      videoEnabled: manager.hasVideo(),
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

  const toggleAudio = useCallback(() => {
    setMediaState((prev) => {
      const next = !prev.audioEnabled
      manager.setTrackEnabled('audio', next)
      return { ...prev, audioEnabled: next }
    })
  }, [manager])

  const toggleVideo = useCallback(() => {
    setMediaState((prev) => {
      const next = !prev.videoEnabled
      manager.setTrackEnabled('video', next)
      return { ...prev, videoEnabled: next }
    })
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
    toggleNoiseSuppression,
    startScreenShare,
    stopScreenShare,
    stopAll,
  }
}

export type UseMediaReturn = ReturnType<typeof useMedia>
