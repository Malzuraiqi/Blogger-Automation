// FILE: src/app/api/generate/links/route.ts
// POST: generates + saves internal or external links (type: "internal"|"external"). Hit by "Insert Internal Links" / "Insert External Links".

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON } from "@/lib/gemini";

const APPROVED_EXTERNAL_CATEGORIES = ["university", "museum", "scientific organization", "government"];

function slugify(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// Step 4 ("Insert Internal Links") and step 5 ("Insert External Links") of
// the pipeline. Called once per type from the UI so the two steps stay
// visually distinct, but both funnel through this one route.
// Body: { articleId, type: "internal" | "external" }
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId, type } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });
  if (type !== "internal" && type !== "external") {
    return NextResponse.json({ error: 'type must be "internal" or "external"' }, { status: 400 });
  }

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  if (type === "internal") {
    const { data: pastArticles } = await sb
      .from("articles")
      .select("title, published_at")
      .eq("label_id", article.label_id)
      .eq("status", "published")
      .neq("id", articleId);
    const { data: futureIdeas } = await sb.from("ideas").select("title").eq("label_id", article.label_id).eq("status", "idea");

    const prompt = `Article title: ${article.title}
Article TL;DR: ${article.tldr}

Published articles in this label the reader might click into: ${pastArticles?.length ? pastArticles.map((a) => a.title).join("; ") : "none yet"}
Planned future ideas in this label: ${futureIdeas?.length ? futureIdeas.map((i) => i.title).join("; ") : "none yet"}

Pick UP TO 2 internal links total (mix of past articles and future ideas, prioritizing genuinely relevant past articles first) and a one-sentence note on where in the article each fits naturally.

Return ONLY a JSON array of at most 2 items shaped exactly like:
{"title":"...", "kind":"past|future", "placementNote":"..."}
No text before or after the array.`;

    let picks: any[];
    try {
      const raw = await callGemini(prompt, 3072);
      const parsed = parseModelJSON<any>(raw);
      if (!Array.isArray(parsed)) throw new Error("Model did not return a JSON array (response may have been truncated). Try again.");
      picks = parsed.slice(0, 2);
    } catch (e: any) {
      return NextResponse.json({ error: `Internal link generation failed: ${e.message}` }, { status: 502 });
    }

    await sb.from("article_links").delete().eq("article_id", articleId).in("link_type", ["internal_past", "internal_future"]);

    const rows = picks.map((l) => ({
      article_id: articleId,
      link_type: l.kind === "future" ? "internal_future" : "internal_past",
      target_title: l.title,
      target_url: l.kind === "future" ? null : `/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${slugify(l.title)}.html`,
      category: null,
      placement_note: l.placementNote,
    }));
    const { data, error } = rows.length ? await sb.from("article_links").insert(rows).select() : { data: [], error: null };
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await maybeMarkLinksInserted(sb, articleId);
    return NextResponse.json({ links: data });
  }

  // type === "external"
  const prompt = `Article title: ${article.title}
Article TL;DR: ${article.tldr}

Pick UP TO 2 real, well-known external sources that would be appropriate to cite, ONLY from these categories: university, museum, scientific organization, or government source. Give the source's real, correct homepage or relevant section URL (do not invent a URL), its category, and a one-sentence note on where it fits naturally in the article.

Return ONLY a JSON array of at most 2 items shaped exactly like:
{"name":"...", "url":"https://...", "category":"university|museum|scientific organization|government", "placementNote":"..."}
No text before or after the array.`;

  let picks: any[];
  try {
    const raw = await callGemini(prompt, 3072);
    const parsed = parseModelJSON<any>(raw);
    if (!Array.isArray(parsed)) throw new Error("Model did not return a JSON array (response may have been truncated). Try again.");
    picks = parsed.filter((l) => APPROVED_EXTERNAL_CATEGORIES.includes(l.category)).slice(0, 2);
  } catch (e: any) {
    return NextResponse.json({ error: `External link generation failed: ${e.message}` }, { status: 502 });
  }

  await sb.from("article_links").delete().eq("article_id", articleId).eq("link_type", "external");

  const rows = picks.map((l) => ({
    article_id: articleId,
    link_type: "external",
    target_title: l.name,
    target_url: l.url,
    category: l.category,
    placement_note: l.placementNote,
  }));
  const { data, error } = rows.length ? await sb.from("article_links").insert(rows).select() : { data: [], error: null };
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await maybeMarkLinksInserted(sb, articleId);
  return NextResponse.json({ links: data });
}

async function maybeMarkLinksInserted(sb: ReturnType<typeof supabaseServer>, articleId: string) {
  const { data: links } = await sb.from("article_links").select("link_type").eq("article_id", articleId);
  const hasInternal = links?.some((l) => l.link_type === "internal_past" || l.link_type === "internal_future");
  const hasExternal = links?.some((l) => l.link_type === "external");
  if (hasInternal && hasExternal) {
    await sb.from("articles").update({ links_inserted: true }).eq("id", articleId);
  }
}