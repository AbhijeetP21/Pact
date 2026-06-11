import Link from 'next/link'

import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

export default function RoomNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          This room isn&apos;t available
        </h1>
        <p className="max-w-sm text-muted-foreground">
          The link may be wrong, the room may have ended, or it has expired.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
          Go home
        </Link>
        <Link href="/room/new" className={cn(buttonVariants())}>
          Start a new call
        </Link>
      </div>
    </main>
  )
}
