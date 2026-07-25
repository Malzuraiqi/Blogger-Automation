// FILE: src/app/api/ideas/route.ts
// GET/PATCH/DELETE for ideas (list by label, update status, delete).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const labelId = req.nextUrl.searchParams.get("labelId");
  let query = sb.from("ideas").select("*").order("rank", { ascending: true });
  if (labelId) query = query.eq("label_id", labelId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const sb = supabaseServer();
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { data, error } = await sb
    .from("ideas")
    .update({ status: body.status })
    .eq("id", body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// Deletes an idea outright. If an article was already drafted from it, the
// article is kept (idea_id is set to null via the FK's ON DELETE SET NULL)
// rather than being silently deleted too.
export async function DELETE(req: NextRequest) {
  const sb = supabaseServer();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { error } = await sb.from("ideas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}