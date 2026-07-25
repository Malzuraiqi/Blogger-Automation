// FILE: src/app/api/blogger/blogs/route.ts
// GET: lists the connected account's Blogger blogs. POST: saves which blog to publish to. Hit by "Load my blogs" and the blog picker dropdown.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getValidAccessToken, listBlogs } from "@/lib/blogger";

export async function GET() {
  try {
    const { accessToken } = await getValidAccessToken();
    const blogs = await listBlogs(accessToken);
    return NextResponse.json(blogs);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// Save which blog to publish to going forward.
export async function POST(req: NextRequest) {
  const { blogId, blogUrl } = await req.json();
  if (!blogId) return NextResponse.json({ error: "blogId is required" }, { status: 400 });
  const sb = supabaseServer();
  const { data: creds } = await sb.from("blogger_credentials").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!creds) return NextResponse.json({ error: "No Blogger account connected yet." }, { status: 400 });
  const { error } = await sb.from("blogger_credentials").update({ blog_id: blogId, blog_url: blogUrl || null }).eq("id", creds.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}