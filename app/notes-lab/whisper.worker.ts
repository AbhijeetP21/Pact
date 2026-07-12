/// <reference lib="webworker" />
//
// Phase 0 spike — throwaway. Runs Whisper (transformers.js / WebGPU) in a
// Worker so transcription never blocks the main thread, matching the real
// design. The page measures whether GPU contention still hurts render FPS.
//
// All messages are serialized through a promise chain: onnxruntime-web's
// WebGPU backend hard-throws ("Session already started") if two inferences
// overlap, and a model reload must not race in-flight chunks. Serialization
// also guarantees results arrive in submission order.

import { pipeline, type AutomaticSpeechRecognitionPipeline, type ProgressInfo } from '@huggingface/transformers'

// pipeline()'s typed overloads exceed tsc's union-complexity limit (TS2590)
// when called with a non-literal model id — pin the one signature we use.
const loadAsrPipeline = pipeline as unknown as (
  task: 'automatic-speech-recognition',
  model: string,
  options: {
    device: 'webgpu'
    dtype: Record<string, string>
    progress_callback: (p: ProgressInfo) => void
  },
) => Promise<AutomaticSpeechRecognitionPipeline>

type LoadMsg = { type: 'load'; model: string }
type TranscribeMsg = {
  type: 'transcribe'
  id: number
  gen: number // run generation — page drops results from a superseded run
  audio: Float32Array
  audioSec: number
}
type InMsg = LoadMsg | TranscribeMsg

let transcriber: AutomaticSpeechRecognitionPipeline | null = null
let currentModel = ''
let queue: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data
  queue = queue.then(() => handle(msg)).catch((err) => {
    // handle() catches everything today, so this is unreachable — but a
    // rejection here would otherwise kill the queue silently forever.
    // Reply anyway so the page's queue accounting stays correct.
    if (msg.type === 'transcribe') {
      self.postMessage({ type: 'error', scope: 'transcribe', id: msg.id, gen: msg.gen, message: errText(err) })
    } else {
      self.postMessage({ type: 'error', scope: 'load', message: errText(err) })
    }
  })
}

async function handle(msg: InMsg): Promise<void> {
  if (msg.type === 'load') await handleLoad(msg)
  else if (msg.type === 'transcribe') await handleTranscribe(msg)
}

async function handleLoad(msg: LoadMsg): Promise<void> {
  if (transcriber && currentModel === msg.model) {
    self.postMessage({ type: 'ready', model: msg.model })
    return
  }
  // Free the previous model's ORT sessions / GPU buffers before loading
  // another — two Whisper models resident at once can OOM a phone's WebGPU
  // device. Any in-flight chunks already finished (queue is serialized).
  if (transcriber) {
    try {
      await transcriber.dispose()
    } catch {
      // best effort — proceed with the reload either way
    }
    transcriber = null
    currentModel = ''
  }
  try {
    transcriber = await loadAsrPipeline('automatic-speech-recognition', msg.model, {
      device: 'webgpu',
      // Mixed precision that the official Whisper-WebGPU demo uses: full
      // precision encoder, 4-bit decoder — the speed/quality sweet spot.
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      progress_callback: (p) => {
        self.postMessage({ type: 'progress', data: p })
      },
    })
    currentModel = msg.model
    self.postMessage({ type: 'ready', model: msg.model })
  } catch (err) {
    self.postMessage({ type: 'error', scope: 'load', message: errText(err) })
  }
}

async function handleTranscribe(msg: TranscribeMsg): Promise<void> {
  if (!transcriber) {
    // Never drop a chunk silently — the page's queue-depth accounting
    // depends on every transcribe getting exactly one reply.
    self.postMessage({
      type: 'error',
      scope: 'transcribe',
      id: msg.id,
      gen: msg.gen,
      message: 'No model loaded (a reload may have failed); chunk dropped.',
    })
    return
  }
  const t0 = performance.now()
  try {
    const out = await transcriber(msg.audio, {
      language: 'english',
      // Chunks are short (~a few seconds); no internal chunking needed.
    })
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) ?? ''
    self.postMessage({
      type: 'result',
      id: msg.id,
      gen: msg.gen,
      text: text.trim(),
      ms: performance.now() - t0,
      audioSec: msg.audioSec,
    })
  } catch (err) {
    self.postMessage({
      type: 'error',
      scope: 'transcribe',
      id: msg.id,
      gen: msg.gen,
      message: errText(err),
    })
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
