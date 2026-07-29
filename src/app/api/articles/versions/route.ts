// FILE: src/app/api/articles/versions/route.ts
// GET: lists saved snapshots for an article, newest first.
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = supabaseServer();
  const articleId = req.nextUrl.searchParams.get("articleId");
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });
  const { data, error } = await sb
    .from("article_versions")
    .select("*")
    .eq("article_id", articleId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}