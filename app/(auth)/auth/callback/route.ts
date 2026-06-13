import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

/**
 * OAuth / magic-link callback. Supabase redirects here with a `code` that we
 * exchange for a session, then forward the user to their intended destination.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // `next` is attacker-controllable (it rides in the link). Only allow a
  // same-origin relative path — reject absolute (`https://evil`) and
  // protocol-relative (`//evil`) values to prevent an open redirect.
  const rawNext = searchParams.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  if (code) {
    const supabase = await createServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // `x-forwarded-host` is set behind Vercel's load balancer.
      const forwardedHost = request.headers.get('x-forwarded-host')
      const isLocal = process.env.NODE_ENV === 'development'

      if (isLocal) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
