import { notFound, redirect } from 'next/navigation'

import { createServerClient } from '@/lib/supabase/server'
import type { Room } from '@/types'
import { RoomClient } from '@/components/call/RoomClient'

type RoomPageProps = {
  params: Promise<{ slug: string }>
}

export default async function RoomPage({ params }: RoomPageProps) {
  const { slug } = await params
  const supabase = await createServerClient()

  // RLS ("read active rooms") already filters out inactive/expired rooms, so a
  // missing row covers all of: not found, deactivated, expired.
  const { data: room } = await supabase
    .from('rooms')
    .select('*')
    .eq('slug', slug)
    .maybeSingle<Room>()

  const isExpired = room?.expires_at
    ? new Date(room.expires_at).getTime() <= Date.now()
    : false

  if (!room || !room.is_active || isExpired) {
    notFound()
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Middleware guards this route, but re-check so props are never null-typed.
  if (!user) {
    redirect(`/login?next=/room/${slug}`)
  }

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email?.split('@')[0] ??
    'Guest'
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ?? null

  return (
    <RoomClient
      slug={room.slug}
      roomName={room.display_name}
      maxParticipants={room.max_participants}
      user={{ id: user.id, displayName, avatarUrl }}
    />
  )
}
