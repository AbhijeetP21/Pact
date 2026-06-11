'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Accepts either a full Pact room URL or a bare slug, extracts the slug, and
 * navigates to the room. Route protection (middleware) handles auth.
 */
function extractSlug(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  // Try to parse a URL and pull the segment after /room/.
  try {
    const url = new URL(value)
    const match = url.pathname.match(/\/room\/([^/]+)/)
    if (match?.[1]) return match[1]
  } catch {
    // Not a URL — fall through and treat the input as a slug.
  }

  // Bare slug: keep only the trailing path segment, strip stray characters.
  const segment = value.split('/').filter(Boolean).pop() ?? value
  const cleaned = segment.replace(/[^a-z0-9]/gi, '')
  return cleaned.length > 0 ? cleaned : null
}

export function JoinWithLink() {
  const router = useRouter()
  const [value, setValue] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const slug = extractSlug(value)
    if (slug) router.push(`/room/${slug}`)
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-md items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste a room link to join"
        aria-label="Room link or code"
        className="h-11"
      />
      <Button
        type="submit"
        variant="outline"
        size="lg"
        className="h-11 shrink-0"
        disabled={extractSlug(value) === null}
      >
        Join
        <ArrowRight className="size-4" />
      </Button>
    </form>
  )
}
