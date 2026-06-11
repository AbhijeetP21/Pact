import Link from 'next/link'
import { Lock, ShieldCheck, Users } from 'lucide-react'

import { createServerClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { JoinWithLink } from '@/components/room/JoinWithLink'
import { AccountMenu } from '@/components/auth/AccountMenu'

export default async function Home() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const account = user
    ? {
        displayName:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          user.email?.split('@')[0] ??
          'You',
        email: user.email ?? null,
        avatarUrl:
          (user.user_metadata?.avatar_url as string | undefined) ?? null,
      }
    : null

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="inline-block size-2.5 rounded-full bg-primary" />
          Pact
        </span>
        {account ? (
          <div className="flex items-center gap-2">
            <Link
              href="/room/new"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              New call
            </Link>
            <AccountMenu user={account} />
          </div>
        ) : (
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Sign in
          </Link>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-10 px-6 py-16 text-center">
        <div className="space-y-6">
          <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Private calls.
            <br />
            For people who trust each other.
          </h1>
          <p className="mx-auto max-w-xl text-balance text-lg text-muted-foreground">
            End-to-end encrypted video for groups of up to five. Your audio and
            video travel directly between devices — never through a server.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <Link
            href="/room/new"
            className={cn(buttonVariants({ size: 'lg' }), 'h-12 px-8 text-base')}
          >
            Start a call
          </Link>
          <JoinWithLink />
        </div>

        <dl className="grid w-full gap-6 pt-6 sm:grid-cols-3">
          <Feature
            icon={<ShieldCheck className="size-5 text-primary" />}
            title="DTLS-SRTP by default"
            body="Encryption is the protocol, not a toggle."
          />
          <Feature
            icon={<Users className="size-5 text-primary" />}
            title="True peer-to-peer mesh"
            body="No SFU, no relay. Media never hits a server."
          />
          <Feature
            icon={<Lock className="size-5 text-primary" />}
            title="No recording, ever"
            body="No transcription, no analytics on call content."
          />
        </dl>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 py-8 text-center text-xs text-muted-foreground">
        Pact — a serverless, end-to-end encrypted calling demo.
      </footer>
    </div>
  )
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 text-center sm:items-start sm:text-left">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
        {icon}
      </div>
      <dt className="text-sm font-medium">{title}</dt>
      <dd className="text-sm text-muted-foreground">{body}</dd>
    </div>
  )
}
