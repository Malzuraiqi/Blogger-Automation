import { createClient } from "@supabase/supabase-js";

// Server-only client. Never import this from a "use client" component —
// it uses the service role key, which must stay off the browser bundle.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Copy .env.local.example to .env.local and fill in your project's URL and service role key."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
