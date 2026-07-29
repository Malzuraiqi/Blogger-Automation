// FILE: src/app/api/articles/versions/restore/route.ts
// POST: restores an article's title/subtitle/tldr/sections/conclusion from a saved snapshot.
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { versionId } = await req.json();
  if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

  const { data: version, error: vErr } = await sb.from("article_versions").select("*").eq("id", versionId).single();
  if (vErr || !version) return NextResponse.json({ error: vErr?.message || "Version not found" }, { status: 404 });

  const { data: current } = await sb
    .from("articles")
    .select("title, subtitle, tldr, sections, conclusion")
    .eq("id", version.article_id)
    .single();

  if (current) {
    await sb.from("article_versions").insert({
      article_id: version.article_id,
      title: current.title,
      subtitle: current.subtitle,
      tldr: current.tldr,
      sections: current.sections,
      conclusion: current.conclusion,
      reason: "manual-edit",
    });
  }

  const { data: updated, error } = await sb
    .from("articles")
    .update({
      title: version.title,
      subtitle: version.subtitle,
      tldr: version.tldr,
      sections: version.sections,
      conclusion: version.conclusion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", version.article_id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(updated);
}