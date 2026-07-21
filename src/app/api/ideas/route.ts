import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

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
