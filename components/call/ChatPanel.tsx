'use client'

import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/types'
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
 * the call ends.
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
  onSend: (text: string) => void
}) {
  const [text, setText] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, open])

  if (!open) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }

  return (
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
                  <span className="font-medium">{mine ? 'You' : m.displayName}</span>
                  <span>{formatTime(m.at)}</span>
                </div>
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
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t p-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the room"
          aria-label="Chat message"
          maxLength={2000}
          autoComplete="off"
        />
        <Button
          type="submit"
          size="icon"
          className="size-10 shrink-0"
          disabled={!text.trim()}
          aria-label="Send message"
        >
          <Send className="size-4" />
        </Button>
      </form>

      <p className="px-3 pb-3 text-center text-[11px] text-muted-foreground">
        Chat isn&apos;t stored. It disappears when the call ends.
      </p>
    </aside>
  )
}
