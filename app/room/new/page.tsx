import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { createServerClient } from '@/lib/supabase/server'
import { CreateRoomForm } from '@/components/room/CreateRoomForm'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default async function NewRoomPage() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Middleware already guards /room/*, but re-check so this page never renders
  // without a user (and TypeScript gets a non-null id).
  if (!user) {
    redirect('/login?next=/room/new')
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Start a call</CardTitle>
            <CardDescription>
              Create a private room and share the link. Up to five people, fully
              end-to-end encrypted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateRoomForm userId={user.id} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
