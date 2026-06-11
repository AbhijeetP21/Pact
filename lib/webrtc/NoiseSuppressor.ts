import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'

import { rtcError, rtcLog } from '@/lib/webrtc/log'

// Worklet + wasm are served from /public/noise (copied from the package). The
// whole pipeline runs on-device — no audio ever leaves the browser, which is
// the entire point of Pact.
const WORKLET_URL = '/noise/rnnoiseWorklet.js'
const WASM_URL = '/noise/rnnoise.wasm'
const WASM_SIMD_URL = '/noise/rnnoise_simd.wasm'

// RNNoise is trained at 48 kHz.
const SAMPLE_RATE = 48_000

// `RnnoiseWorkletNode extends AudioWorkletNode`, which is undefined on the
// server. Import the package only in the browser, lazily, to keep SSR safe —
// and cache the wasm binary across instances.
let wasmPromise: Promise<ArrayBuffer> | null = null

/**
 * Routes a microphone stream through RNNoise (ML noise suppression) and exposes
 * the cleaned audio track. Steady background noise (fans, HVAC, hum) is removed
 * while speech is preserved. Entirely local — no server involvement.
 */
export class NoiseSuppressor {
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: RnnoiseWorkletNode | null = null
  private dest: MediaStreamAudioDestinationNode | null = null

  /** Build the graph from `input`'s audio and return the cleaned audio track. */
  async process(input: MediaStream): Promise<MediaStreamTrack> {
    const { loadRnnoise, RnnoiseWorkletNode } = await import(
      '@sapphi-red/web-noise-suppressor'
    )

    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    await ctx.audioWorklet.addModule(WORKLET_URL)
    wasmPromise ??= loadRnnoise({ url: WASM_URL, simdUrl: WASM_SIMD_URL })
    const wasmBinary = await wasmPromise

    const source = ctx.createMediaStreamSource(input)
    const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary })
    const dest = ctx.createMediaStreamDestination()
    source.connect(node).connect(dest)

    // A context created without a user gesture starts suspended — which would
    // make the cleaned track silent. Resume now, and again on the next gesture
    // as a fallback so we never ship silence to peers.
    await ctx.resume().catch(() => {})
    if (ctx.state === 'suspended') {
      const resume = () => void ctx.resume().catch(() => {})
      document.addEventListener('pointerdown', resume, { once: true })
      document.addEventListener('keydown', resume, { once: true })
    }

    this.ctx = ctx
    this.source = source
    this.node = node
    this.dest = dest

    rtcLog('Media', 'RNNoise suppression active')
    const track = dest.stream.getAudioTracks()[0]
    if (!track) throw new Error('RNNoise produced no audio track')
    return track
  }

  destroy(): void {
    try {
      this.source?.disconnect()
      this.node?.disconnect()
      this.node?.destroy?.()
    } catch {
      // already torn down
    }
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.source = null
    this.node = null
    this.dest = null
  }
}

/**
 * Try to build a suppressor for `input`. Returns the cleaned track + the
 * suppressor handle, or null if RNNoise fails to load (caller falls back to the
 * raw mic with the browser's native suppression).
 */
export async function tryCreateSuppressor(
  input: MediaStream,
): Promise<{ track: MediaStreamTrack; suppressor: NoiseSuppressor } | null> {
  if (input.getAudioTracks().length === 0) return null
  try {
    const suppressor = new NoiseSuppressor()
    const track = await suppressor.process(input)
    return { track, suppressor }
  } catch (err) {
    rtcError('Media', 'RNNoise unavailable; using native suppression', err)
    return null
  }
}
