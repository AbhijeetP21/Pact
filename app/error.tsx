'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Pact] unhandled error:', error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p className="max-w-sm text-muted-foreground">
          An unexpected error occurred. You can try again. If it persists,
          reload the page.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </main>
  )
}
