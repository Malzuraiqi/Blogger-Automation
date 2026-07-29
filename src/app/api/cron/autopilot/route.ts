// FILE: src/app/api/cron/autopilot/route.ts
// GET: designed to be hit by a scheduled cron (Vercel Cron or any external
// scheduler). For each label, tops up the idea queue if it's running low,
// auto-promotes the top-ranked idea if nothing is currently mid-pipeline,
// runs the full generation pipeline, and leaves the result as a Blogger
// DRAFT (never publishes live) for review in the Approval Queue.
//
// Protect this: set CRON_SECRET in your env vars, and have your scheduler
// send `Authorization: Bearer <CRON_SECRET>`. Vercel Cron Jobs do this
// automatically if CRON_SECRET is set as a project env var.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

const MIN_IDEA_QUEUE = 3;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured — refusing to run unprotected." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = supabaseServer();
  const origin = req.nextUrl.origin;
  const { data: labels } = await sb.from("labels").select("*");
  const results: any[] = [];

  for (const label of labels || []) {
    const actions: string[] = [];

    const { data: openIdeas } = await sb.from("ideas").select("id").eq("label_id", label.id).eq("status", "idea");
    if ((openIdeas?.length || 0) < MIN_IDEA_QUEUE) {
      try {
        const res = await fetch(`${origin}/api/generate/ideas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ labelId: label.id }),
        });
        if (!res.ok) throw new Error(await res.text());
        actions.push("Generated new ideas (queue was low).");
      } catch (e: any) {
        actions.push(`Idea generation failed: ${e.message}`);
        results.push({ label: label.name, actions });
        continue;
      }
    }

    const { data: inProgress } = await sb.from("articles").select("id").eq("label_id", label.id).neq("status", "published").is("html", null);
    if (inProgress?.length) {
      actions.push("Skipped promotion — an article is already mid-pipeline.");
      results.push({ label: label.name, actions });
      continue;
    }

    const { data: topIdea } = await sb
      .from("ideas").select("*").eq("label_id", label.id).eq("status", "idea")
      .order("rank", { ascending: true }).limit(1).maybeSingle();
    if (!topIdea) {
      actions.push("No idea available to promote.");
      results.push({ label: label.name, actions });
      continue;
    }

    let articleId: string;
    try {
      const { data: existingArticle } = await sb.from("articles").select("id").eq("idea_id", topIdea.id).maybeSingle();
      if (existingArticle) {
        articleId = existingArticle.id;
      } else {
        await sb.from("ideas").update({ status: "drafting" }).eq("id", topIdea.id);
        const { data: newArticle, error } = await sb
          .from("articles")
          .insert({ idea_id: topIdea.id, label_id: topIdea.label_id, title: topIdea.title, status: "drafting", content_type: topIdea.content_type || "factual" })
          .select().single();
        if (error || !newArticle) throw new Error(error?.message || "Could not create article draft.");
        articleId = newArticle.id;
      }
      actions.push(`Promoted "${topIdea.title}".`);
    } catch (e: any) {
      actions.push(`Promotion failed: ${e.message}`);
      results.push({ label: label.name, actions });
      continue;
    }

    const steps: [string, string, any][] = [
      ["Generate Article", "/api/generate/article", { articleId }],
      ["Generate Images", "/api/generate/images", { articleId }],
      ["Generate Captions", "/api/generate/captions", { articleId }],
      ["Insert Internal Links", "/api/generate/links", { articleId, type: "internal" }],
      ["Insert External Links", "/api/generate/links", { articleId, type: "external" }],
      ["Generate HTML", "/api/generate/html", { articleId }],
    ];
    for (const [stepLabel, path, body] of steps) {
      try {
        const res = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
        actions.push(`${stepLabel}: done.`);
      } catch (e: any) {
        actions.push(`${stepLabel} failed: ${e.message}`);
      }
    }

    try {
      const { data: finalArticle } = await sb.from("articles").select("html").eq("id", articleId).single();
      if (finalArticle?.html) {
        const res = await fetch(`${origin}/api/blogger/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId, mode: "draft" }),
        });
        if (!res.ok) throw new Error(await res.text());
        actions.push("Saved as a Blogger draft — ready for review in the Approval Queue.");
      } else {
        actions.push("Skipped Blogger draft — HTML generation didn't succeed.");
      }
    } catch (e: any) {
      actions.push(`Blogger draft failed: ${e.message} (article is still saved locally — publish manually from the Approval Queue.)`);
    }

    results.push({ label: label.name, actions });
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}