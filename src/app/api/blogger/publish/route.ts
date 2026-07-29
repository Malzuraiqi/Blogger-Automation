// FILE: src/app/api/blogger/publish/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getValidAccessToken, publishPost, publishExistingPost } from "@/lib/blogger";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId, mode, publishAt } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*, article_seo(*)").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  if (!article.html) return NextResponse.json({ error: "Generate the HTML for this article first." }, { status: 400 });

  const { data: label } = await sb.from("labels").select("name").eq("id", article.label_id).single();

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
  // Auto-fill the Blogger label/category from this app's own label if one
  // hasn't been manually set — no more copy-pasting it in by hand.
  const bloggerLabels: string[] = article.blogger_labels?.length ? article.blogger_labels : ([label?.name].filter(Boolean) as string[]);

  try {
    let result: { id: string; url: string };

    if (mode === "publish" && article.blogger_post_id) {
      // Already sitting as a draft — promote that SAME post, don't create
      // a second one.
      result = await publishExistingPost(accessToken, blogId, article.blogger_post_id, publishAt);
    } else {
      result = await publishPost(accessToken, blogId, {
        title: article.title,
        content: article.html,
        labels: bloggerLabels,
        searchDescription: seo?.meta_description || undefined,
        isDraft: mode === "draft",
        publishDate: mode === "schedule" ? publishAt : undefined,
      });
    }

    await sb
      .from("articles")
      .update({
        // The bug: this used to always flip to "published", even for a
        // Blogger DRAFT — which silently removed drafted articles from
        // the Approval Queue. Only a genuine live publish should do that.
        status: mode === "publish" ? "published" : article.status,
        published_url: result.url || article.published_url,
        published_at: mode === "publish" ? new Date().toISOString() : article.published_at,
        blogger_post_id: result.id,
      })
      .eq("id", articleId);

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}