// FILE: src/app/api/blogger/publish/route.ts
// POST: publishes (or drafts) the article's HTML to Blogger. Hit by "Save draft on Blogger" / "Publish to Blogger".

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getValidAccessToken, publishPost } from "@/lib/blogger";

// Step 8 (optional) of the pipeline: "Publish to Blogger".
// Body: { articleId, mode: "draft" | "publish" | "schedule", publishAt?: ISO string }
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId, mode, publishAt } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*, article_seo(*)").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  if (!article.html) return NextResponse.json({ error: "Generate the HTML for this article first." }, { status: 400 });

  let accessToken: string, blogId: string | null;
  try {
    const valid = await getValidAccessToken();
    accessToken = valid.accessToken;
    blogId = valid.blogId;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (!blogId) {
    return NextResponse.json({ error: "No blog selected yet. Pick one in Advanced Settings > Blogger." }, { status: 400 });
  }

  const seo = Array.isArray(article.article_seo) ? article.article_seo[0] : article.article_seo;

  try {
    const result = await publishPost(accessToken, blogId, {
      title: (seo?.seo_title || article.title) as string,
      content: article.html,
      labels: article.blogger_labels || [],
      searchDescription: seo?.meta_description || undefined,
      isDraft: mode === "draft",
      publishDate: mode === "schedule" ? publishAt : undefined,
      url: article.permalink || undefined,   // <-- add this
    });

    await sb
      .from("articles")
      .update({ status: "published", published_url: result.url, published_at: mode === "publish" ? new Date().toISOString() : article.published_at })
      .eq("id", articleId);

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}