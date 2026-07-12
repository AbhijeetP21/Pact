'use client'

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 0 SPIKE — throwaway. Not linked from the app; visit /notes-lab directly.
//
// The only question this answers: does running Whisper (WebGPU) during a call
// wreck the call on THIS device? It transcribes your live mic in a Worker while
// an optional synthetic "call load" runs, and reports:
//   • RTF (real-time factor): inference_time / audio_duration. < 1.0 = keeps up.
//   • Render FPS + worst FPS while capturing: proxy for "is video smooth?"
//
// Run it on your laptop AND a phone. Green if RTF stays < ~0.7 and FPS holds
// above ~24 with the synthetic load on. Delete this whole folder afterwards.
//
// Note on RTF: each 5s chunk is padded to Whisper's fixed 30s window, so the
// numbers here are deliberately pessimistic vs a production 30s-chunk pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'

const MODELS = ['onnx-community/whisper-base', 'onnx-community/whisper-small']
const SAMPLE_RATE = 16_000 // Whisper's expected input rate
const CHUNK_SECONDS = 5 // continuous chunking = worst-case stress (always busy)

type ModelState = 'idle' | 'loading' | 'ready' | 'error'

type ChunkStat = {
  id: number
  ms: number
  audioSec: number
  rtf: number
  text: string
}

type RunAgg = { n: number; rtfSum: number; worstRtf: number }

const EMPTY_AGG: RunAgg = { n: 0, rtfSum: 0, worstRtf: 0 }

// Downsample mic audio to Whisper's 16 kHz. Integer ratios (48k/16k = 3) get
// box-filter decimation — the averaging doubles as a crude anti-alias filter;
// fractional ratios (44.1k) fall back to linear interpolation, good enough
// for speech in a spike.
function downsampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === SAMPLE_RATE) return input
  const ratio = inRate / SAMPLE_RATE
  const outLen = Math.floor(input.length / ratio)
  const out = new Float32Array(outLen)
  if (Number.isInteger(ratio)) {
    for (let i = 0; i < outLen; i++) {
      let sum = 0
      const base = i * ratio
      for (let j = 0; j < ratio; j++) sum += input[base + j]!
      out[i] = sum / ratio
    }
  } else {
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio
      const i0 = Math.floor(pos)
      const i1 = Math.min(i0 + 1, input.length - 1)
      const frac = pos - i0
      out[i] = input[i0]! * (1 - frac) + input[i1]! * frac
    }
  }
  return out
}

export default function NotesLabPage() {
  const [webgpu, setWebgpu] = useState<boolean | null>(null)
  const [adapter, setAdapter] = useState<string>('')
  const [model, setModel] = useState(MODELS[0]!)
  const [modelState, setModelState] = useState<ModelState>('idle')
  const [progress, setProgress] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string>('')

  const [capturing, setCapturing] = useState(false)
  const [simLoad, setSimLoad] = useState(true)
  const [stats, setStats] = useState<ChunkStat[]>([]) // rolling display window
  const [agg, setAgg] = useState<RunAgg>(EMPTY_AGG) // whole-run aggregates
  const [queueDepth, setQueueDepth] = useState(0)
  const [fps, setFps] = useState(0)
  const [minFps, setMinFps] = useState<number | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const nodesRef = useRef<{ src: MediaStreamAudioSourceNode; proc: ScriptProcessorNode; sink: GainNode } | null>(null)
  const bufRef = useRef<Float32Array[]>([])
  const bufLenRef = useRef(0)
  const captureRateRef = useRef(SAMPLE_RATE) // actual AudioContext rate
  const nextIdRef = useRef(0)
  const pendingRef = useRef(0)
  const genRef = useRef(0) // bumped on model load / capture start; stale worker replies are dropped
  const capturingRef = useRef(false)
  const unmountedRef = useRef(false)
  const simRef = useRef(true)
  simRef.current = simLoad

  // Reset every per-run metric. Bumps the generation so replies to chunks
  // from the previous run (possibly a different model) can't contaminate
  // this run's stats.
  const resetRun = useCallback(() => {
    genRef.current += 1
    pendingRef.current = 0
    setStats([])
    setAgg(EMPTY_AGG)
    setQueueDepth(0)
    setMinFps(null)
  }, [])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [])

  // ── WebGPU capability probe ────────────────────────────────────────────────
  useEffect(() => {
    const nav = navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }
    if (!nav.gpu) {
      setWebgpu(false)
      return
    }
    nav.gpu
      .requestAdapter()
      .then(async (a: unknown) => {
        setWebgpu(Boolean(a))
        const info = (a as { info?: { vendor?: string; architecture?: string } })?.info
        if (info) setAdapter([info.vendor, info.architecture].filter(Boolean).join(' · '))
      })
      .catch(() => setWebgpu(false))
  }, [])

  // ── Worker wiring ──────────────────────────────────────────────────────────
  useEffect(() => {
    const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url))
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') {
        const p = m.data
        if (p?.status === 'progress' && typeof p.progress === 'number') {
          setProgress(`${p.file ?? ''} — ${Math.round(p.progress)}%`)
        } else if (p?.status) {
          setProgress(`${p.status} ${p.file ?? ''}`.trim())
        }
      } else if (m.type === 'ready') {
        setModelState('ready')
        setProgress('')
      } else if (m.type === 'result' || (m.type === 'error' && m.scope === 'transcribe')) {
        // Replies from a superseded run (model reloaded, capture restarted)
        // must not touch this run's stats or queue accounting.
        if (m.gen !== genRef.current) return
        pendingRef.current = Math.max(0, pendingRef.current - 1)
        setQueueDepth(pendingRef.current)
        if (m.type === 'error') {
          setErrorMsg(m.message ?? 'Unknown worker error')
          return
        }
        const rtf = m.ms / 1000 / m.audioSec
        setAgg((a) => ({ n: a.n + 1, rtfSum: a.rtfSum + rtf, worstRtf: Math.max(a.worstRtf, rtf) }))
        setStats((s) => [
          { id: m.id, ms: m.ms, audioSec: m.audioSec, rtf, text: m.text },
          ...s,
        ].slice(0, 40))
      } else if (m.type === 'error') {
        setErrorMsg(m.message ?? 'Unknown worker error')
        if (m.scope === 'load') setModelState('error')
      }
    }
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const loadModel = useCallback(() => {
    setErrorMsg('')
    setModelState('loading')
    setProgress('starting…')
    resetRun() // a different model's chunks must not mix into the new run
    workerRef.current?.postMessage({ type: 'load', model })
  }, [model, resetRun])

  // ── Mic capture → mono PCM → 16 kHz → chunked to the worker ────────────────
  const flushChunk = useCallback(() => {
    const parts = bufRef.current
    const len = bufLenRef.current
    if (len < captureRateRef.current) return // safety floor; the sub-5s tail at Stop is deliberately discarded, never flushed
    const raw = new Float32Array(len)
    let off = 0
    for (const p of parts) {
      raw.set(p, off)
      off += p.length
    }
    bufRef.current = []
    bufLenRef.current = 0
    const audio = downsampleTo16k(raw, captureRateRef.current)
    const id = nextIdRef.current++
    pendingRef.current += 1
    setQueueDepth(pendingRef.current)
    workerRef.current?.postMessage(
      { type: 'transcribe', id, gen: genRef.current, audio, audioSec: audio.length / SAMPLE_RATE },
      [audio.buffer],
    )
  }, [])

  const startCapture = useCallback(async () => {
    if (capturingRef.current) return
    // Claim immediately — while the permission prompt is up, `capturing` is
    // still false and the Start button is still rendered, so a second click
    // would otherwise run a second capture and orphan the first stream.
    capturingRef.current = true
    setErrorMsg('')
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (unmountedRef.current) {
        // Page went away while the permission prompt was up — don't leave
        // a hot mic behind.
        stream.getTracks().forEach((t) => t.stop())
        capturingRef.current = false
        return
      }
      // Prefer a 16 kHz context (browser-quality resampling). Firefox throws
      // when connecting a mic stream to a context at a non-native rate
      // (bug 1674892), so fall back to the native rate and downsample in
      // flushChunk instead.
      let src: MediaStreamAudioSourceNode
      try {
        ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
        src = ctx.createMediaStreamSource(stream)
      } catch {
        await ctx?.close().catch(() => {})
        if (unmountedRef.current) {
          // Unmounted during the close — effect cleanup already ran with
          // empty refs, so tear down here or the mic leaks.
          stream.getTracks().forEach((t) => t.stop())
          capturingRef.current = false
          return
        }
        ctx = new AudioContext()
        src = ctx.createMediaStreamSource(stream)
      }
      captureRateRef.current = ctx.sampleRate
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      const sink = ctx.createGain()
      sink.gain.value = 0 // silent — capture only, no echo to speakers
      proc.onaudioprocess = (ev) => {
        const ch = ev.inputBuffer.getChannelData(0)
        bufRef.current.push(new Float32Array(ch))
        bufLenRef.current += ch.length
        if (bufLenRef.current >= captureRateRef.current * CHUNK_SECONDS) flushChunk()
      }
      src.connect(proc)
      proc.connect(sink)
      sink.connect(ctx.destination)
      streamRef.current = stream
      audioCtxRef.current = ctx
      nodesRef.current = { src, proc, sink }
      resetRun() // fresh metrics per capture session
      setCapturing(true)
    } catch (err) {
      // Tear down whatever got created before the failure — otherwise the
      // mic stays live with no UI able to stop it.
      stream?.getTracks().forEach((t) => t.stop())
      if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {})
      capturingRef.current = false
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }, [flushChunk, resetRun])

  const stopCapture = useCallback(() => {
    nodesRef.current?.proc.disconnect()
    nodesRef.current?.src.disconnect()
    nodesRef.current?.sink.disconnect()
    nodesRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    bufRef.current = []
    bufLenRef.current = 0
    capturingRef.current = false
    setCapturing(false)
  }, [])

  useEffect(() => () => stopCapture(), [stopCapture])

  // ── Render-FPS meter + optional synthetic "call load" ───────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    let frames = 0
    let last = performance.now()
    let phase = 0
    const scratch = document.createElement('canvas')
    scratch.width = 640
    scratch.height = 360
    const sctx = scratch.getContext('2d', { willReadFrequently: true })!

    // rAF pauses in hidden tabs; without this, the first frame after the tab
    // is re-shown computes FPS ≈ 0 and poisons minFps for the whole run.
    const onVisibility = () => {
      if (!document.hidden) {
        frames = 0
        last = performance.now()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const loop = () => {
      const now = performance.now()
      frames++
      const elapsed = now - last
      if (elapsed >= 500) {
        const f = Math.round((frames * 1000) / elapsed)
        setFps(f)
        // Windows stretched by a stall (tab switch, debugger pause) measure
        // the stall, not render throughput — don't let them set minFps.
        if (capturing && elapsed < 1500) setMinFps((m) => (m === null ? f : Math.min(m, f)))
        frames = 0
        last = now
      }

      // Synthetic per-frame pixel work to mimic the blur/video pipeline load,
      // so FPS contention here approximates a real call.
      if (simRef.current) {
        const img = sctx.getImageData(0, 0, scratch.width, scratch.height)
        const d = img.data
        for (let i = 0; i < d.length; i += 4) {
          d[i] = (d[i]! + phase) & 255
          d[i + 1] = (d[i + 1]! + phase * 2) & 255
          d[i + 2] = (d[i + 2]! + phase * 3) & 255
        }
        sctx.putImageData(img, 0, 0)
      }

      const canvas = canvasRef.current
      if (canvas) {
        const c = canvas.getContext('2d')!
        c.fillStyle = '#0b1220'
        c.fillRect(0, 0, canvas.width, canvas.height)
        c.fillStyle = '#38bdf8'
        const x = (phase % canvas.width)
        c.fillRect(x, 10, 40, 40)
      }
      phase = (phase + 4) % 100000
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [capturing])

  // ── Derived metrics ─────────────────────────────────────────────────────────
  const avgRtf = agg.n ? agg.rtfSum / agg.n : 0
  const worstRtf = agg.worstRtf
  const transcript = [...stats].reverse().map((s) => s.text).filter(Boolean).join(' ')

  const verdict = (() => {
    if (!agg.n) return null
    const fpsOk = minFps !== null && minFps >= 24
    const rtfOk = avgRtf < 0.7
    if (fpsOk && rtfOk) return { ok: true, msg: 'Looks viable on this device — RTF < 0.7 and FPS held ≥ 24.' }
    return {
      ok: false,
      msg: `Marginal: ${rtfOk ? '' : `avg RTF ${avgRtf.toFixed(2)} (want < 0.7). `}${fpsOk ? '' : `min FPS ${minFps ?? '—'} (want ≥ 24).`} Try the smaller model or the distributed approach.`,
    }
  })()

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6 font-mono text-sm">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Pact Notes — Phase 0 load spike</h1>
        <p className="text-muted-foreground">
          Throwaway. Does on-device Whisper survive next to a live call on this hardware?
          Load the model, start your mic, talk, and watch RTF + FPS.
        </p>
      </header>

      {/* Environment */}
      <section className="rounded-lg border p-4">
        <div className="grid grid-cols-2 gap-2">
          <span>WebGPU</span>
          <span className={webgpu === false ? 'text-red-500' : webgpu ? 'text-green-500' : ''}>
            {webgpu === null ? 'checking…' : webgpu ? `available${adapter ? ` (${adapter})` : ''}` : 'NOT available — feature would be disabled here'}
          </span>
        </div>
      </section>

      {/* Model */}
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded border bg-transparent px-2 py-1"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={modelState === 'loading'}
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            onClick={loadModel}
            disabled={webgpu === false || modelState === 'loading'}
            className="rounded bg-sky-600 px-3 py-1 text-white disabled:opacity-40"
          >
            {modelState === 'ready' ? 'Reload model' : 'Load model'}
          </button>
          <span className="text-muted-foreground">
            {modelState === 'ready' ? '✓ ready' : modelState === 'loading' ? progress || 'loading…' : modelState === 'error' ? 'error' : 'not loaded'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          First load downloads weights from HuggingFace (base ≈ 150 MB, small ≈ 500 MB), cached afterwards.
          Loading a model resets the run&apos;s metrics.
        </p>
      </section>

      {/* Capture controls */}
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-3">
          {!capturing ? (
            <button
              onClick={startCapture}
              disabled={modelState !== 'ready'}
              className="rounded bg-green-600 px-3 py-1 text-white disabled:opacity-40"
            >
              Start mic
            </button>
          ) : (
            <button onClick={stopCapture} className="rounded bg-red-600 px-3 py-1 text-white">
              Stop
            </button>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={simLoad} onChange={(e) => setSimLoad(e.target.checked)} />
            Simulate call load (per-frame pixel work)
          </label>
        </div>
        <canvas ref={canvasRef} width={320} height={60} className="w-full rounded border" />
        <p className="text-xs text-muted-foreground">
          Keep this tab visible during a run — a hidden tab pauses rendering and its FPS samples are discarded.
        </p>
      </section>

      {/* Live metrics */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="FPS now" value={String(fps)} good={fps >= 24} />
        <Metric label="min FPS" value={minFps === null ? '—' : String(minFps)} good={minFps === null || minFps >= 24} />
        <Metric label="avg RTF" value={avgRtf ? avgRtf.toFixed(2) : '—'} good={!avgRtf || avgRtf < 0.7} />
        <Metric label="worst RTF" value={worstRtf ? worstRtf.toFixed(2) : '—'} good={!worstRtf || worstRtf < 1} />
        <Metric label="queue depth" value={String(queueDepth)} good={queueDepth <= 2} />
        <Metric label="chunks done" value={String(agg.n)} good />
      </section>

      {verdict && (
        <section className={`rounded-lg border p-4 ${verdict.ok ? 'border-green-600 text-green-600' : 'border-amber-600 text-amber-600'}`}>
          {verdict.ok ? '✓ ' : '⚠ '}{verdict.msg}
          <span className="mt-1 block text-xs opacity-70">
            RTF here is worst-case: every {CHUNK_SECONDS}s chunk pays Whisper&apos;s full 30s-window cost.
          </span>
        </section>
      )}

      {errorMsg && (
        <section className="rounded-lg border border-red-600 p-4 text-red-500">{errorMsg}</section>
      )}

      {/* Rolling transcript */}
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-bold">Transcript (last 40 chunks)</h2>
        <p className="min-h-16 whitespace-pre-wrap text-muted-foreground">{transcript || '(start talking…)'}</p>
      </section>

      {/* Per-chunk log */}
      <section className="space-y-1 rounded-lg border p-4">
        <h2 className="font-bold">Per-chunk (newest first, last 40)</h2>
        <div className="max-h-64 overflow-auto">
          {stats.map((s) => (
            <div key={s.id} className="grid grid-cols-[auto_auto_auto_1fr] gap-3 border-b py-1">
              <span>{s.audioSec.toFixed(1)}s</span>
              <span>{Math.round(s.ms)}ms</span>
              <span className={s.rtf < 0.7 ? 'text-green-500' : s.rtf < 1 ? 'text-amber-500' : 'text-red-500'}>
                RTF {s.rtf.toFixed(2)}
              </span>
              <span className="truncate text-muted-foreground">{s.text}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${good ? 'text-green-500' : 'text-amber-500'}`}>{value}</div>
    </div>
  )
}
