// FILE: src/app/api/generate/audio/retry-archive/route.ts
// POST: re-attempts JUST the archive.org upload for an article's already-generated audio, pulling the mp3 back from Supabase Storage. No TTS regeneration needed.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { uploadToArchiveOrg, isArchiveOrgConfigured } from "@/lib/archiveOrg";
import { fetchStoredAudio } from "@/lib/audioStorage";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });
  if (!isArchiveOrgConfigured()) {
    return NextResponse.json({ error: "Archive.org isn't configured (ARCHIVE_ORG_ACCESS_KEY / ARCHIVE_ORG_SECRET_KEY)." }, { status: 400 });
  }

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  let mp3: Buffer;
  try {
    mp3 = await fetchStoredAudio(articleId);
  } catch (e: any) {
    return NextResponse.json({ error: `${e.message} Run "Generate Audio" first.` }, { status: 400 });
  }

  try {
    const archiveUrl = await uploadToArchiveOrg(mp3, article.title, article.permalink || article.title);
    const { data: updated, error } = await sb.from("articles").update({ audio_url: archiveUrl }).eq("id", articleId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: `Archive.org still throttling: ${e.message}` }, { status: 502 });
  }
}