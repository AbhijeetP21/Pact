'use client'

import { useEffect, useRef, useState } from 'react'
import { ImageUp, Loader2, Send, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { compressImage } from '@/lib/chat/image'
import type { ChatImage, ChatMessage } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Ephemeral in-call chat. Messages ride the room's broadcast channel and live
 * only in component state — nothing is persisted, and everything vanishes when
 * the call ends. A pasted image (Ctrl/Cmd+V) is compressed client-side and sent
 * as one attachment per message; click a thumbnail to view it full-size.
 */
export function ChatPanel({
  open,
  onClose,
  messages,
  selfPeerId,
  onSend,
}: {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  selfPeerId: string
  onSend: (text: string, image?: ChatImage) => void
}) {
  const [text, setText] = useState('')
  const [stagedImage, setStagedImage] = useState<ChatImage | null>(null)
  const [pasting, setPasting] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  // Close the lightbox with Escape.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  if (!open) return null

  async function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      // It's an image — take it over the default (which would paste nothing
      // useful into the text input anyway).
      e.preventDefault()
      setImageError(null)
      setPasting(true)
      try {
        setStagedImage(await compressImage(file))
      } catch {
        setImageError('That image is too large to send.')
      } finally {
        setPasting(false)
      }
      return
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed && !stagedImage) return
    onSend(trimmed, stagedImage ?? undefined)
    setText('')
    setStagedImage(null)
    setImageError(null)
  }

  return (
    <>
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l bg-card shadow-xl">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">In-call chat</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <p className="pt-8 text-center text-sm text-muted-foreground">
              No messages yet. Say hello.
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.from === selfPeerId
              return (
                <div
                  key={m.id}
                  className={cn('flex flex-col', mine && 'items-end')}
                >
                  <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium">
                      {mine ? 'You' : m.displayName}
                    </span>
                    <span>{formatTime(m.at)}</span>
                  </div>

                  {m.image && (
                    <button
                      type="button"
                      onClick={() => setLightbox(m.image!.src)}
                      aria-label="View image full size"
                      className="mb-1 block max-w-[80%] overflow-hidden rounded-lg border bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.image.src}
                        width={m.image.width}
                        height={m.image.height}
                        alt="Shared image"
                        className="max-h-52 w-auto object-contain"
                      />
                    </button>
                  )}

                  {m.text && (
                    <div
                      className={cn(
                        'max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm',
                        mine
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      {m.text}
                    </div>
                  )}
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Staged paste preview + any paste error. */}
        {(stagedImage || pasting || imageError) && (
          <div className="border-t px-3 py-2">
            {pasting ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Preparing image…
              </div>
            ) : imageError ? (
              <p className="text-xs text-destructive">{imageError}</p>
            ) : stagedImage ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stagedImage.src}
                  alt="Image to send"
                  className="max-h-24 w-auto rounded-md border object-contain"
                />
                <button
                  type="button"
                  onClick={() => setStagedImage(null)}
                  aria-label="Remove image"
                  className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}
          </div>
        )}

        <form onSubmit={submit} className="flex items-center gap-2 border-t p-3">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={handlePaste}
            placeholder="Message the room — or paste an image"
            aria-label="Chat message"
            maxLength={2000}
            autoComplete="off"
          />
          <Button
            type="submit"
            size="icon"
            className="size-10 shrink-0"
            disabled={(!text.trim() && !stagedImage) || pasting}
            aria-label="Send message"
          >
            <Send className="size-4" />
          </Button>
        </form>

        <p className="flex items-center justify-center gap-1.5 px-3 pb-3 text-center text-[11px] text-muted-foreground">
          <ImageUp className="size-3" />
          Paste an image to share it. Chat isn&apos;t stored.
        </p>
      </aside>

      {/* Full-size image lightbox. */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setLightbox(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close image"
            className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Shared image, full size"
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </>
  )
}
