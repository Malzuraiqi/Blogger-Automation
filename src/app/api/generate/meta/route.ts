import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const { data: pastArticles } = await sb
    .from("articles")
    .select("title")
    .eq("label_id", article.label_id)
    .neq("id", articleId);
  const { data: futureIdeas } = await sb
    .from("ideas")
    .select("title")
    .eq("label_id", article.label_id)
    .eq("status", "idea");

  const bodyText = (article.sections || []).map((s: any) => `${s.heading}\n${s.body}`).join("\n\n");

  const prompt = `Article title: ${article.title}
Article body (for context, do not rewrite it):
${article.tldr}
${bodyText}
${article.conclusion}

Past published articles in this label: ${pastArticles?.length ? pastArticles.map((a) => a.title).join("; ") : "none yet"}
Future planned ideas in this label: ${futureIdeas?.length ? futureIdeas.map((i) => i.title).join("; ") : "none yet"}

Produce SEO metadata, an image plan (descriptions only, no image generation), and a link plan. External links must only point to categories: university, museum, scientific organization, or government source (give the source name and category, not a fabricated URL).

Return ONLY JSON exactly shaped as:
{
 "seo": {"primaryKeyword":"...", "secondaryKeywords":["...","..."], "seoTitle":"...", "metaDescription":"...", "keywordInH1": true, "keywordInFirstParagraph": true},
 "images": [{"isFeatured": true, "placement":"...", "description":"...", "purpose":"..."}],
 "links": {
   "internalPast": [{"title":"...", "placementNote":"..."}],
   "internalFuture": [{"title":"...", "placementNote":"..."}],
   "external": [{"name":"...", "category":"university|museum|scientific organization|government", "placementNote":"..."}]
 }
}
Include 1 featured image plus 2-4 section images. Include up to 2 internal past links, 1-2 internal future links, and 2-3 external links.`;

  const raw = await callGemini(prompt, 3072);
  const meta = parseModelJSON<any>(raw);

  await sb.from("article_seo").delete().eq("article_id", articleId);
  await sb.from("article_images").delete().eq("article_id", articleId);
  await sb.from("article_links").delete().eq("article_id", articleId);

  await sb.from("article_seo").insert({
    article_id: articleId,
    primary_keyword: meta.seo.primaryKeyword,
    secondary_keywords: meta.seo.secondaryKeywords || [],
    seo_title: meta.seo.seoTitle,
    meta_description: meta.seo.metaDescription,
    keyword_in_h1: meta.seo.keywordInH1,
    keyword_in_first_paragraph: meta.seo.keywordInFirstParagraph,
  });

  const imageRows = (meta.images || []).map((img: any, i: number) => ({
    article_id: articleId,
    is_featured: !!img.isFeatured,
    placement: img.placement,
    description: img.description,
    purpose: img.purpose,
    sort_order: i,
  }));
  if (imageRows.length) await sb.from("article_images").insert(imageRows);

  const linkRows = [
    ...(meta.links.internalPast || []).map((l: any) => ({
      article_id: articleId,
      link_type: "internal_past",
      target_title: l.title,
      category: null,
      placement_note: l.placementNote,
    })),
    ...(meta.links.internalFuture || []).map((l: any) => ({
      article_id: articleId,
      link_type: "internal_future",
      target_title: l.title,
      category: null,
      placement_note: l.placementNote,
    })),
    ...(meta.links.external || []).map((l: any) => ({
      article_id: articleId,
      link_type: "external",
      target_title: l.name,
      category: l.category,
      placement_note: l.placementNote,
    })),
  ];
  if (linkRows.length) await sb.from("article_links").insert(linkRows);

  return NextResponse.json(meta);
}
