import type { ChatImage } from '@/types'

// Pasted images ride the same Supabase broadcast channel as text chat, which
// has a per-message payload ceiling. We compress aggressively so the base64
// data URL stays comfortably under that, leaving headroom for the rest of the
// message JSON. (chars ≈ bytes for a base64 ASCII string.)
const MAX_DATA_URL_BYTES = 180 * 1024
// Longest edge after downscaling. A screenshot rarely needs more on a call.
const MAX_EDGE_PX = 1280

/** Scale (w, h) down to fit within a max longest-edge, preserving aspect. */
function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { w, h }
  const scale = max / longest
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

/** Decode a Blob to something drawable, with a fallback for older browsers. */
async function decode(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not decode image'))
      el.src = url
    })
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}

/**
 * Downscale + JPEG-compress a pasted image until its data URL fits the chat
 * payload budget. Drops quality first, then dimensions. Throws if it can't be
 * made small enough (e.g. an enormous image) or the browser lacks canvas.
 */
export async function compressImage(file: Blob): Promise<ChatImage> {
  const { source, width: rawW, height: rawH, release } = await decode(file)
  try {
    if (!rawW || !rawH) throw new Error('Image has no dimensions')
    let { w, h } = fitWithin(rawW, rawH, MAX_EDGE_PX)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not supported')

    // Up to a few passes: each pass tries decreasing quality, then shrinks.
    for (let pass = 0; pass < 6; pass++) {
      canvas.width = w
      canvas.height = h
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(source, 0, 0, w, h)
      for (let quality = 0.8; quality >= 0.4; quality -= 0.15) {
        const src = canvas.toDataURL('image/jpeg', quality)
        if (src.length <= MAX_DATA_URL_BYTES) {
          return { src, width: w, height: h }
        }
      }
      w = Math.round(w * 0.8)
      h = Math.round(h * 0.8)
      if (w < 64 || h < 64) break
    }
    throw new Error('Image is too large to send')
  } finally {
    release()
  }
}

/**
 * Validate an inbound (untrusted) image payload. Returns a safe ChatImage or
 * undefined — guards against a malicious peer sending a non-image or an
 * oversized data URL that would bloat memory.
 */
export function sanitizeChatImage(value: unknown): ChatImage | undefined {
  if (!value || typeof value !== 'object') return undefined
  const img = value as Partial<ChatImage>
  if (typeof img.src !== 'string' || !img.src.startsWith('data:image/')) {
    return undefined
  }
  // Allow some headroom over the send budget, but cap hard.
  if (img.src.length > MAX_DATA_URL_BYTES * 2) return undefined
  const width = Number(img.width)
  const height = Number(img.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  return {
    src: img.src,
    width: Math.min(Math.max(Math.round(width), 1), 8192),
    height: Math.min(Math.max(Math.round(height), 1), 8192),
  }
}
