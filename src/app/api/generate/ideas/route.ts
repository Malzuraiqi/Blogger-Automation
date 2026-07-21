import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { labelId } = await req.json();
  if (!labelId) return NextResponse.json({ error: "labelId is required" }, { status: 400 });

  const { data: label } = await sb.from("labels").select("*").eq("id", labelId).single();
  if (!label) return NextResponse.json({ error: "Label not found" }, { status: 404 });

  const { data: published } = await sb.from("articles").select("title").eq("label_id", labelId).eq("status", "published");
  const { data: existingIdeas } = await sb.from("ideas").select("title").eq("label_id", labelId);

  const prompt = `Label: "${label.name}" (${label.description || "no description"})
Already published in this label: ${published?.length ? published.map((a) => a.title).join("; ") : "nothing yet"}
Already have as ideas: ${existingIdeas?.length ? existingIdeas.map((i) => i.title).join("; ") : "none"}

Generate 15 NEW article ideas for this label, distinct from what's already published or listed. Rank for curiosity factor, SEO potential, audience interest, connection to previous articles, and series potential.

Return ONLY a JSON array, each item shaped exactly like:
{"title":"...", "mainQuestion":"...", "hook":"why a reader would click, one sentence", "seoKeywords":["...","..."], "series":"series name and part, or null if standalone", "curiosity":1-10, "seoScore":1-10, "audience":1-10, "rank":1}
Order the array by rank, best idea first (rank 1). No text before or after the array.`;

  const raw = await callGemini(prompt, 4096);
  const ideas = parseModelJSON<any[]>(raw);

  const rows = ideas.map((idea, i) => ({
    label_id: labelId,
    title: idea.title,
    main_question: idea.mainQuestion,
    hook_reason: idea.hook,
    seo_keywords: idea.seoKeywords || [],
    series_position: idea.series || null,
    curiosity_score: idea.curiosity || null,
    seo_score: idea.seoScore || null,
    audience_score: idea.audience || null,
    rank: idea.rank || i + 1,
    status: "idea" as const,
  }));

  const { data, error } = await sb.from("ideas").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
