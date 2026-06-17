import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env'

/**
 * OAuth / magic-link callback. Supabase redirects here with a `code` that we
 * exchange for a session, then forward the user to their intended destination.
 *
 * The session cookies MUST be written onto the redirect response itself —
 * cookies set through the `next/headers` store are not reliably attached to a
 * manually constructed `NextResponse` in a route handler, which would send the
 * redirect out without the session and leave the user appearing signed out.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // `next` is attacker-controllable (it rides in the link). Only allow a
  // same-origin relative path — reject absolute (`https://evil`) and
  // protocol-relative (`//evil`) values to prevent an open redirect.
  const rawNext = searchParams.get('next') ?? '/'
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  // Build the redirect target up front so the auth cookies can be attached to
  // it. `x-forwarded-host` is set behind Vercel's load balancer.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const isLocal = process.env.NODE_ENV === 'development'
  const base = isLocal
    ? origin
    : forwardedHost
      ? `https://${forwardedHost}`
      : origin
  const response = NextResponse.redirect(`${base}${next}`)

  const cookieStore = await cookies()
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          // Write to both: the request store (so anything later in this
          // request sees the session) and the outgoing redirect response.
          cookieStore.set(name, value, options)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
  }

  return response
}
