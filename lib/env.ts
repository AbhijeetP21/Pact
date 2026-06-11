// Centralised environment-variable access with fail-fast validation.
//
// Public vars (NEXT_PUBLIC_*) are inlined into the client bundle by Next.js.
// Server-only vars are read at runtime and must never be exposed to the client.

/**
 * The Supabase project URL.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

/**
 * The Supabase client key. Supports both the modern publishable key
 * (`sb_publishable_…`) and the legacy anon JWT — either is passed to
 * supabase-js exactly the same way. RLS enforces access either way.
 */
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ''

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

type Missing = { key: string; hint: string }

/**
 * Validate every required variable. Safe to call from a server context
 * (e.g. the root layout) so the app fails loudly at startup rather than
 * silently at runtime.
 */
export function validateEnv(): void {
  const missing: Missing[] = []

  if (!SUPABASE_URL) {
    missing.push({
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      hint: 'Supabase project URL (Project Settings → API).',
    })
  }
  if (!SUPABASE_ANON_KEY) {
    missing.push({
      key: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      hint: 'Supabase publishable key (or legacy anon key) — Project Settings → API.',
    })
  }
  if (!process.env.NEXT_PUBLIC_APP_URL) {
    missing.push({
      key: 'NEXT_PUBLIC_APP_URL',
      hint: 'Base URL of this deployment, e.g. http://localhost:3000.',
    })
  }

  if (missing.length > 0) {
    const lines = missing.map((m) => `  - ${m.key}: ${m.hint}`).join('\n')
    throw new Error(
      `[Pact] Missing required environment variable(s):\n${lines}\n` +
        `Add them to .env.local (see .env.local.example) and restart.`,
    )
  }
}
