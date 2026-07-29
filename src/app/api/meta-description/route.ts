// FILE: src/app/api/generate/meta-description/route.ts
// POST: regenerates ONLY the search-engine meta description for an already-written article, without touching the article body. Useful for older posts, or just refining SEO copy on its own.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, buildSystemInstruction } from "@/lib/gemini";
import { getStyleProfile } from "@/lib/styleProfile";

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

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  if (!article.sections?.length) {
    return NextResponse.json({ error: "This article has no content yet. Generate the article first." }, { status: 400 });
  }

  const bodyText = (article.sections || []).map((s: any) => `${s.heading}\n${s.body}`).join("\n\n");
  const styleProfile = await getStyleProfile(sb);
  const systemInstruction = buildSystemInstruction(article.content_type, styleProfile);

  const prompt = `Article title: ${article.title}
Article content:
${article.tldr}
${bodyText}
${article.conclusion}

Write ONE search-engine meta description for this article: plain text, no markdown, under 150 characters, written to make someone click from a search results page.

Return ONLY JSON exactly shaped as: {"metaDescription":"..."}
No text before or after the JSON.`;

  let metaDescription: string;
  try {
    const raw = await callGemini(prompt, 512, systemInstruction);
    const cleaned = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.metaDescription !== "string" || !parsed.metaDescription.trim()) {
      throw new Error("Model did not return a usable meta description.");
    }
    metaDescription = capChars(parsed.metaDescription, 150);
  } catch (e: any) {
    return NextResponse.json({ error: `Meta description generation failed: ${e.message}` }, { status: 502 });
  }

  const { data, error } = await sb
    .from("article_seo")
    .upsert({ article_id: articleId, meta_description: metaDescription }, { onConflict: "article_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}