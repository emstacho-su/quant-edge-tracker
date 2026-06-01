/**
 * Service-role Supabase client for Vercel API routes.
 *
 * Bypasses RLS. Must only be used server-side (this module imports from
 * `@vercel/node` / `process.env` so it would fail in a browser bundle anyway).
 *
 * Env vars (set in Vercel project + `.env.local` for `vercel dev`):
 *   SUPABASE_URL                  (server) or VITE_SUPABASE_URL (browser, also fine)
 *   SUPABASE_SERVICE_ROLE_KEY     (required, server-only)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function getServiceClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) {
    throw new Error(
      'Missing SUPABASE_URL (or VITE_SUPABASE_URL) in the Vercel environment.',
    )
  }
  if (!key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY in the Vercel environment.',
    )
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return cached
}
