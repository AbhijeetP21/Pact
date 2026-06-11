'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2, Video } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import {
  cn,
  generateSlug,
  getRoomUrl,
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeDisplayName,
} from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShareLinkCard } from '@/components/room/ShareLinkCard'

// Rooms expire 12 hours after creation so stale links stop working.
const ROOM_TTL_MS = 12 * 60 * 60 * 1000
const MAX_SLUG_ATTEMPTS = 5

type Created = { slug: string; url: string }

export function CreateRoomForm({ userId }: { userId: string }) {
  const supabase = createClient()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<Created | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)

    const displayName = sanitizeDisplayName(name)
    const expiresAt = new Date(Date.now() + ROOM_TTL_MS).toISOString()

    // Slug collisions are astronomically unlikely but cheap to retry against
    // the UNIQUE constraint, so we loop on the duplicate-key error.
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      const slug = generateSlug()
      const { error } = await supabase.from('rooms').insert({
        slug,
        display_name: displayName,
        created_by: userId,
        expires_at: expiresAt,
      })

      if (!error) {
        setCreated({ slug, url: getRoomUrl(slug) })
        setSubmitting(false)
        return
      }

      if (error.code !== '23505') {
        toast.error(error.message || 'Could not create the room.')
        setSubmitting(false)
        return
      }
      // 23505 = unique_violation → try a fresh slug.
    }

    toast.error('Could not generate a unique room link. Please try again.')
    setSubmitting(false)
  }

  if (created) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Your room is ready</p>
          <p className="text-sm text-muted-foreground">
            Share this link with up to four other people. Anyone with the link
            can join after signing in.
          </p>
        </div>

        <ShareLinkCard url={created.url} />

        <Link
          href={`/room/${created.slug}`}
          className={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full text-base')}
        >
          Enter room
          <ArrowRight className="size-4" />
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="room-name">Room name (optional)</Label>
        <Input
          id="room-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Friday standup"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          Shown to people in the room. Leave blank for an unnamed room.
        </p>
      </div>

      <Button
        type="submit"
        size="lg"
        className="h-11 w-full text-base"
        disabled={submitting}
      >
        {submitting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Video className="size-4" />
        )}
        Create room
      </Button>
    </form>
  )
}
