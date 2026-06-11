import { Suspense } from 'react'
import Link from 'next/link'

import { AuthForm } from '@/components/auth/AuthForm'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="inline-block size-2.5 rounded-full bg-primary" />
          Pact
        </Link>

        <Card>
          <CardHeader className="text-center">
            <CardTitle>Sign in to Pact</CardTitle>
            <CardDescription>
              Private, end-to-end encrypted video calls for your small group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<div className="h-48" />}>
              <AuthForm />
            </Suspense>
          </CardContent>
        </Card>

        <p className="px-6 text-center text-xs text-muted-foreground">
          By continuing you agree that media is shared peer-to-peer. Pact never
          records or stores your audio or video.
        </p>
      </div>
    </main>
  )
}
