// FILE: src/lib/styleProfile.ts
// getStyleProfile(sb): fetches the singleton style_profile row's text, or null if none exists yet.

import { supabaseServer } from "@/lib/supabase";

export async function getStyleProfile(sb: ReturnType<typeof supabaseServer>): Promise<string | null> {
  const { data } = await sb
    .from("style_profile")
    .select("profile_text")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.profile_text || null;
}