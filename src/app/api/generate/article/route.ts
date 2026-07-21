import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON, countWords, scanBannedWords } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId, targetWordCount = 1250 } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const { data: idea } = await sb.from("ideas").select("*").eq("id", article.idea_id).maybeSingle();
  const { data: label } = await sb.from("labels").select("*").eq("id", article.label_id).single();

  const prompt = `Write a Synapse Snaps article.
Label: ${label?.name}
Title: ${idea?.title || article.title}
Main question: ${idea?.main_question || "n/a"}
Why readers click: ${idea?.hook_reason || "n/a"}
Series: ${idea?.series_position || "standalone"}

Structure: a strong curiosity-hook TL;DR (2-3 sentences), then 4-6 body sections with H2 headings, using examples and historical context where useful, ending at least one section with an open question. Then a conclusion that connects back to humanity, society, or the universe.
Target length: ${targetWordCount} words total across all sections plus TL;DR and conclusion (aim for the 1000-1500 word range unless a different target was given).

Return ONLY JSON exactly shaped as:
{"title":"...", "subtitle": "short subtitle or null", "tldr":"...", "sections":[{"heading":"...", "body":"..."}], "conclusion":"..."}`;

  const raw = await callGemini(prompt, 8192);
  const draft = parseModelJSON<any>(raw);

  const fullText = [draft.tldr, ...(draft.sections || []).map((s: any) => `${s.heading} ${s.body}`), draft.conclusion].join(" ");
  const wordCount = countWords(fullText);
  const readingTime = Math.max(1, Math.round(wordCount / 200));
  const bannedHits = scanBannedWords(fullText);

  const { data, error } = await sb
    .from("articles")
    .update({
      title: draft.title || article.title,
      subtitle: draft.subtitle || null,
      tldr: draft.tldr,
      sections: draft.sections || [],
      conclusion: draft.conclusion,
      word_count: wordCount,
      reading_time_minutes: readingTime,
      banned_word_hits: bannedHits,
      status: "editing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", articleId)
    .select()
    .single();

  if (idea) await sb.from("ideas").update({ status: "editing" }).eq("id", idea.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
