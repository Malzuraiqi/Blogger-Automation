// FILE: src/app/api/generate/article/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON, scanBannedWords, countWords, buildSystemInstruction } from "@/lib/gemini";
import { getStyleProfile } from "@/lib/styleProfile";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80).replace(/-$/, "");
}

// 150-CHARACTER cap (search engines truncate by characters, not words),
// cutting on a whole word so it doesn't end mid-word.
function capChars(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, "") + "...";
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article, error: articleErr } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (articleErr || !article) {
    return NextResponse.json({ error: articleErr?.message || "Article not found" }, { status: 404 });
  }

  const { data: label } = await sb.from("labels").select("*").eq("id", article.label_id).single();
  const styleProfile = await getStyleProfile(sb);
  const systemInstruction = buildSystemInstruction(article.content_type, styleProfile);

  const prompt = `Write the full article for "${article.title}"${label ? ` in the "${label.name}" label (${label.description || "no description"})` : ""}.

Produce:
- subtitle: a short one-line subtitle
- tldr: a 1-2 sentence summary a reader sees before the article
- sections: 4-7 sections, each with a heading and a substantial body (multiple sentences of real content, not a placeholder)
- conclusion: a short "wrapping up" paragraph
- permalink: a short, SEO-friendly URL slug (lowercase, hyphen-separated, 3-6 words, NOT just the full title reworded) that captures the core topic — e.g. for a title like "Why Do Cats Purr? The Science Behind the Sound" a good permalink is "why-cats-purr-science"
- metaDescription: a search-engine meta description, plain text, no markdown, under 150 characters, written to make someone click from a search results page

Target 1000-1500 words total across the tldr, all section bodies, and the conclusion combined.

Return ONLY JSON exactly shaped as:
{"subtitle":"...", "tldr":"...", "sections":[{"heading":"...", "body":"..."}], "conclusion":"...", "permalink":"...", "metaDescription":"..."}
No text before or after the JSON.`;

  let draft: any;
  try {
    const raw = await callGemini(prompt, 8192, systemInstruction);
    draft = parseModelJSON<any>(raw);
  } catch (e: any) {
    return NextResponse.json({ error: `Article generation failed: ${e.message}` }, { status: 502 });
  }

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
  const readingTimeMinutes = Math.max(1, Math.round(wordCount / 130));
  const bannedWordHits = scanBannedWords(fullText);

  const permalink =
    typeof draft.permalink === "string" && draft.permalink.trim() ? slugify(draft.permalink) : slugify(article.title);

  const metaDescription =
    typeof draft.metaDescription === "string" && draft.metaDescription.trim()
      ? capChars(draft.metaDescription, 150)
      : capChars(draft.tldr, 150);

  const now = new Date().toISOString();

  if (article.sections?.length) {
    await sb.from("article_versions").insert({
      article_id: articleId,
      title: article.title,
      subtitle: article.subtitle,
      tldr: article.tldr,
      sections: article.sections,
      conclusion: article.conclusion,
      reason: "regenerate",
    });
  }

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
      permalink,
      updated_at: now,
      content_generated_at: now,
    })
    .eq("id", articleId)
    .select()
    .single();

  if (error) {
    console.error("[generate/article] Database update failed:", error.message);
    return NextResponse.json({ error: `Database error saving the article: ${error.message}` }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "The update ran but no row came back — double check this articleId still exists." }, { status: 500 });
  }

  const { error: seoErr } = await sb
    .from("article_seo")
    .upsert({ article_id: articleId, meta_description: metaDescription }, { onConflict: "article_id" });
  if (seoErr) console.error("[generate/article] Failed to upsert meta_description:", seoErr.message);

  return NextResponse.json({ ...updated, permalink, meta_description: metaDescription });
}