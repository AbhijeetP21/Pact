import { createServerClient as createSupabaseServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env'

/**
 * Server-side Supabase client backed by the request cookie store.
 *
 * In Next.js 15 `cookies()` is async, so this factory is async and every
 * caller must `await` it. Only the public anon key is used here; the
 * service-role key is never instantiated through this path.
 */
export async function createServerClient() {
  const cookieStore = await cookies()

  return createSupabaseServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        // In Server Components, setting cookies throws — Supabase tolerates
        // this when a middleware refresh path exists, so we swallow it.
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Called from a Server Component without a mutable cookie store.
        }
      },
    },
  })
}
