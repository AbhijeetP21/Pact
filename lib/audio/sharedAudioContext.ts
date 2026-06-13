// A single, process-wide AudioContext shared by every speaking-level analyser.
//
// Browsers cap the number of concurrent AudioContexts (~6), and a 5-person mesh
// would otherwise open one per tile. Sharing one context keeps us well under
// the cap and cuts per-tile overhead. Consumers create their own source +
// analyser nodes off this context and disconnect them on cleanup, but must NOT
// close the context — it outlives any individual tile.

let sharedCtx: AudioContext | null = null

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AudioCtx) return null

  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioCtx()
  }
  // Contexts created before a user gesture start suspended; resume best-effort.
  void sharedCtx.resume().catch(() => {})
  return sharedCtx
}
