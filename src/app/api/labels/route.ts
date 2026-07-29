// FILE: src/app/api/labels/route.ts
// GET/POST for labels (list, create new label).

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

// Without this, Next.js's App Router can treat this GET handler as static
// and cache its response, since nothing inside it reads cookies/headers.
// That means a successful write elsewhere could still appear to "not show
// up" in the UI because refreshAll() was served a stale cached snapshot
// instead of hitting the database again. force-dynamic guarantees every
// call actually queries Supabase.
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb.from("labels").select("*").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const body = await req.json();
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Label name is required." }, { status: 400 });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const { data, error } = await sb
    .from("labels")
    .insert({ name, slug, description: body.description || null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// add this export alongside GET/POST
export async function PATCH(req: NextRequest) {
  const sb = supabaseServer();
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { id, ...updates } = body;
  const { data, error } = await sb.from("labels").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}