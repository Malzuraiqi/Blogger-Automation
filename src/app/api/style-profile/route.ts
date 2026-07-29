// FILE: src/app/api/style-profile/route.ts
// GET: returns the current extracted style profile, if any.
// POST: extracts a new profile from pasted writing samples via Gemini and saves it.
// PATCH: manually overwrites the profile text (for hand-editing after extraction).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini } from "@/lib/gemini";

export const dynamic = "force-dynamic";

const EXTRACTION_SYSTEM = `You are a writing-style analyst. You will be given one or more samples of a real person's writing. Extract a compact, actionable "voice profile" describing HOW they write, not what they wrote about. Cover: typical sentence length/rhythm, how they open pieces, how they transition between ideas, how blunt vs hedged they are, recurring verbal habits or phrasings, how they use humor/asides, paragraph length habits, and anything else a ghostwriter would need to imitate their voice convincingly. Do not summarize the content or topics of the samples. Return ONLY valid JSON shaped exactly as {"profile": "..."} where profile is the voice profile as plain text. No text before or after the JSON.`;

export async function GET() {
  const sb = supabaseServer();
  const { data } = await sb.from("style_profile").select("*").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json(data || null);
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { samples } = await req.json();
  const cleanSamples: string[] = Array.isArray(samples) ? samples.filter((s: any) => typeof s === "string" && s.trim()) : [];
  if (!cleanSamples.length) {
    return NextResponse.json({ error: "Provide at least one non-empty writing sample." }, { status: 400 });
  }

  const prompt = `Here are ${cleanSamples.length} writing sample(s) from the same author, separated by "---SAMPLE---":\n\n${cleanSamples.join("\n\n---SAMPLE---\n\n")}`;

  let profileText: string;
  try {
    const raw = await callGemini(prompt, 3072, EXTRACTION_SYSTEM);
    const cleaned = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.profile !== "string" || !parsed.profile.trim()) {
      throw new Error("Model did not return a usable profile.");
    }
    profileText = parsed.profile.trim();
  } catch (e: any) {
    return NextResponse.json({ error: `Style extraction failed: ${e.message}` }, { status: 502 });
  }

  const wordCount = cleanSamples.join(" ").trim().split(/\s+/).filter(Boolean).length;
  const now = new Date().toISOString();

  const { data: existing } = await sb.from("style_profile").select("id").limit(1).maybeSingle();
  const { data, error } = existing
    ? await sb.from("style_profile").update({ profile_text: profileText, sample_count: cleanSamples.length, sample_word_count: wordCount, updated_at: now }).eq("id", existing.id).select().single()
    : await sb.from("style_profile").insert({ profile_text: profileText, sample_count: cleanSamples.length, sample_word_count: wordCount, updated_at: now }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const sb = supabaseServer();
  const { profile_text } = await req.json();
  if (typeof profile_text !== "string") return NextResponse.json({ error: "profile_text is required" }, { status: 400 });

  const now = new Date().toISOString();
  const { data: existing } = await sb.from("style_profile").select("id").limit(1).maybeSingle();
  const { data, error } = existing
    ? await sb.from("style_profile").update({ profile_text, updated_at: now }).eq("id", existing.id).select().single()
    : await sb.from("style_profile").insert({ profile_text, updated_at: now }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}