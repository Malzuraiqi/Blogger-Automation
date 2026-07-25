// FILE: src/app/api/generate/article/route.ts
// POST: writes the full article draft (subtitle/tldr/sections/conclusion). Hit by the "Generate Article" step.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON, scanBannedWords, countWords } from "@/lib/gemini";

// Step 1 of the editor pipeline: "Generate Article".
// Writes the full draft (subtitle, TL;DR, sections, conclusion) for an
// existing article stub. Hardened so a truncated/malformed model response
// or a failed database write is surfaced as a real error instead of a
// silent 200 with nothing actually saved.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article, error: articleErr } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (articleErr || !article) {
    return NextResponse.json({ error: articleErr?.message || "Article not found" }, { status: 404 });
  }

  const { data: label } = await sb.from("labels").select("*").eq("id", article.label_id).single();

  const prompt = `Write the full article for "${article.title}"${label ? ` in the "${label.name}" label (${label.description || "no description"})` : ""}.

Produce:
- subtitle: a short one-line subtitle
- tldr: a 1-2 sentence summary a reader sees before the article
- sections: 4-7 sections, each with a heading and a substantial body (multiple sentences of real content, not a placeholder)
- conclusion: a short "wrapping up" paragraph

Target 1000-1500 words total across the tldr, all section bodies, and the conclusion combined.

Return ONLY JSON exactly shaped as:
{"subtitle":"...", "tldr":"...", "sections":[{"heading":"...", "body":"..."}], "conclusion":"..."}
No text before or after the JSON.`;

  let draft: any;
  try {
    const raw = await callGemini(prompt, 8192);
    draft = parseModelJSON<any>(raw);
  } catch (e: any) {
    return NextResponse.json({ error: `Article generation failed: ${e.message}` }, { status: 502 });
  }

  // Validate shape BEFORE writing anything. This is exactly the kind of
  // check that was missing before: a truncated or oddly-shaped model
  // response can parse as valid JSON while still being missing the fields
  // the app actually needs, so it must be checked explicitly rather than
  // trusted.
  if (
    !draft ||
    typeof draft.tldr !== "string" ||
    !Array.isArray(draft.sections) ||
    !draft.sections.length ||
    !draft.sections.every((s: any) => typeof s?.heading === "string" && typeof s?.body === "string" && s.body.length > 0) ||
    typeof draft.conclusion !== "string"
  ) {
    console.error("[generate/article] Unexpected shape from model:", JSON.stringify(draft)?.slice(0, 1500));
    return NextResponse.json(
      { error: "The model's response was missing required article fields (tldr/sections/conclusion). Try generating again — no credits were saved to the database." },
      { status: 502 }
    );
  }

  const fullText = [draft.tldr, ...draft.sections.map((s: any) => s.body), draft.conclusion].join(" ");
  const wordCount = countWords(fullText);
  // 130 words per minute — a more realistic average reading speed than the
  // 200 wpm this used to assume, which was under-reporting reading time.
  const readingTimeMinutes = Math.max(1, Math.round(wordCount / 130));
  const bannedWordHits = scanBannedWords(fullText);

  // updated_at and content_generated_at are stamped to the SAME timestamp
  // here — a fresh generation is by definition not stale. They only drift
  // apart once a manual edit (via PATCH /api/articles) bumps updated_at
  // without touching content_generated_at.
  const now = new Date().toISOString();

  const { data: updated, error } = await sb
    .from("articles")
    .update({
      subtitle: draft.subtitle || null,
      tldr: draft.tldr,
      sections: draft.sections,
      conclusion: draft.conclusion,
      word_count: wordCount,
      reading_time_minutes: readingTimeMinutes,
      banned_word_hits: bannedWordHits,
      updated_at: now,
      content_generated_at: now,
    })
    .eq("id", articleId)
    .select()
    .single();

  // This is the check that prevents the "200 OK but nothing shows up"
  // problem: if Supabase rejects the write (bad column type, constraint
  // violation, RLS, connection issue, etc.), `error` will be set and
  // `updated` will be null. Both cases now return a real error instead of
  // silently reporting success.
  if (error) {
    console.error("[generate/article] Database update failed:", error.message);
    return NextResponse.json({ error: `Database error saving the article: ${error.message}` }, { status: 500 });
  }
  if (!updated) {
    console.error("[generate/article] Update returned no row for articleId:", articleId);
    return NextResponse.json({ error: "The update ran but no row came back — double check this articleId still exists." }, { status: 500 });
  }

  return NextResponse.json(updated);
}