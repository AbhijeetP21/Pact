import { rtcError, rtcLog } from '@/lib/webrtc/log'

// MediaPipe Selfie Segmentation runs entirely in-browser. The model + WASM are
// self-hosted from /public/mediapipe, so nothing (code or video) leaves the
// device — consistent with Pact's privacy model.
const ASSET_PATH = '/mediapipe'
const BLUR_PX = 12
const FPS = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySegmentation = any

// The MediaPipe bundle is a Closure-compiled script that assigns its
// `SelfieSegmentation` constructor onto the global object rather than ES-
// exporting it. So we load the self-hosted script once and read it off window.
let scriptPromise: Promise<unknown> | null = null

function loadSelfieSegmentation(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  if (w.SelfieSegmentation) return Promise.resolve(w.SelfieSegmentation)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${ASSET_PATH}/selfie_segmentation.js`
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      if (w.SelfieSegmentation) resolve(w.SelfieSegmentation)
      else reject(new Error('SelfieSegmentation global not found after load'))
    }
    script.onerror = () => reject(new Error('Failed to load selfie_segmentation.js'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * Replaces a camera video track with one whose background is blurred, using
 * person segmentation. A hidden <video> feeds frames to the segmenter; each
 * result is composited (sharp person over a blurred copy of the frame) onto a
 * canvas, and the canvas stream becomes the outbound video track.
 */
export class BackgroundProcessor {
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private segmentation: AnySegmentation = null
  private output: MediaStream | null = null
  private raf = 0
  private running = false

  async start(input: MediaStream): Promise<MediaStreamTrack> {
    const track = input.getVideoTracks()[0]
    if (!track) throw new Error('No video track to process')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SelfieSegmentation = (await loadSelfieSegmentation()) as any

    const video = document.createElement('video')
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.srcObject = new MediaStream([track])
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve()
    })
    await video.play().catch(() => {})

    const width = video.videoWidth || 640
    const height = video.videoHeight || 480
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    const segmentation = new SelfieSegmentation({
      locateFile: (file: string) => `${ASSET_PATH}/${file}`,
    })
    segmentation.setOptions({ modelSelection: 1, selfieMode: false })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    segmentation.onResults((results: any) => {
      ctx.save()
      ctx.clearRect(0, 0, width, height)
      // Mask → keep the person, then paint the blurred frame behind them.
      ctx.drawImage(results.segmentationMask, 0, 0, width, height)
      ctx.globalCompositeOperation = 'source-in'
      ctx.drawImage(results.image, 0, 0, width, height)
      ctx.globalCompositeOperation = 'destination-over'
      ctx.filter = `blur(${BLUR_PX}px)`
      ctx.drawImage(results.image, 0, 0, width, height)
      ctx.restore()
    })

    this.video = video
    this.canvas = canvas
    this.segmentation = segmentation
    this.running = true

    const pump = async () => {
      if (!this.running || !this.video) return
      try {
        await segmentation.send({ image: this.video })
      } catch {
        // transient frame error — keep going
      }
      if (this.running) this.raf = requestAnimationFrame(() => void pump())
    }
    void pump()

    this.output = canvas.captureStream(FPS)
    const out = this.output.getVideoTracks()[0]
    if (!out) throw new Error('Background blur produced no track')
    rtcLog('Media', 'background blur active')
    return out
  }

  stop(): void {
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.output?.getTracks().forEach((t) => t.stop())
    try {
      this.segmentation?.close?.()
    } catch {
      // ignore
    }
    if (this.video) this.video.srcObject = null
    this.video = null
    this.canvas = null
    this.segmentation = null
    this.output = null
  }
}

/**
 * Try to build a blurred-background track from `input`. Returns the track +
 * processor, or null if the model fails to load (caller keeps the raw camera).
 */
export async function tryCreateBlur(
  input: MediaStream,
): Promise<{ track: MediaStreamTrack; processor: BackgroundProcessor } | null> {
  if (input.getVideoTracks().length === 0) return null
  try {
    const processor = new BackgroundProcessor()
    const track = await processor.start(input)
    return { track, processor }
  } catch (err) {
    rtcError('Media', 'background blur unavailable; using raw camera', err)
    return null
  }
}
