import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const labelId = req.nextUrl.searchParams.get("labelId");
  let query = sb.from("articles").select("*, article_seo(*), article_images(*), article_links(*)").order("created_at");
  if (labelId) query = query.eq("label_id", labelId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// Creates a draft article stub from an idea, or returns the existing one.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { ideaId } = await req.json();
  if (!ideaId) return NextResponse.json({ error: "ideaId is required" }, { status: 400 });

  const { data: existing } = await sb.from("articles").select("*").eq("idea_id", ideaId).maybeSingle();
  if (existing) return NextResponse.json(existing);

  const { data: idea, error: ideaErr } = await sb.from("ideas").select("*").eq("id", ideaId).single();
  if (ideaErr || !idea) return NextResponse.json({ error: ideaErr?.message || "Idea not found" }, { status: 404 });

  await sb.from("ideas").update({ status: "drafting" }).eq("id", ideaId);

  const { data, error } = await sb
    .from("articles")
    .insert({ idea_id: ideaId, label_id: idea.label_id, title: idea.title, status: "drafting" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const sb = supabaseServer();
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { id, ...updates } = body;
  const { data, error } = await sb.from("articles").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
