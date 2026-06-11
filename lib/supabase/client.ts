import { createBrowserClient } from '@supabase/ssr'

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env'

/**
 * Browser-side Supabase client. Uses only the public publishable/anon key,
 * which is safe to ship in the client bundle — Row Level Security enforces
 * access control.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}
