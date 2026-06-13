'use client'

import { useEffect, useRef, useState } from 'react'

import { getSharedAudioContext } from '@/lib/audio/sharedAudioContext'

// Average frequency magnitude (0–255) above which we treat the track as
// "speaking". Tuned to ignore room/keyboard noise but catch normal speech.
const SPEAKING_THRESHOLD = 18
// Keep the indicator lit briefly after the level drops, so it doesn't flicker
// between syllables.
const HOLD_MS = 250

/**
 * Detects whether a stream's audio is currently active ("speaking") using a
 * Web Audio AnalyserNode. Re-renders only when the boolean flips, not per
 * frame. Returns false when there's no audio track or detection is disabled.
 */
export function useAudioLevel(
  stream: MediaStream | null,
  enabled = true,
): boolean {
  const [speaking, setSpeaking] = useState(false)
  const speakingRef = useRef(false)

  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) {
      speakingRef.current = false
      setSpeaking(false)
      return
    }

    // One AudioContext is shared across all tiles (see sharedAudioContext).
    const ctx = getSharedAudioContext()
    if (!ctx) return

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.6
    source.connect(analyser)

    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf = 0
    let lastSpoke = 0

    const tick = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += data[i]!
      const avg = sum / data.length

      const now = performance.now()
      if (avg > SPEAKING_THRESHOLD) lastSpoke = now
      const isSpeaking = now - lastSpoke < HOLD_MS

      if (isSpeaking !== speakingRef.current) {
        speakingRef.current = isSpeaking
        setSpeaking(isSpeaking)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      try {
        source.disconnect()
        analyser.disconnect()
      } catch {
        // already disconnected
      }
      // The context is shared and intentionally left open for other tiles.
    }
  }, [stream, enabled])

  return speaking
}
