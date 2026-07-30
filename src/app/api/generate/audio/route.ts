// FILE: src/app/api/generate/audio/route.ts
// POST: narrates the article (sections + conclusion only), synthesizes it via TTS_PROVIDER, uploads the mp3 to archive.org, and saves audio_url + audio_duration_seconds. Hit by the "Generate Audio" step.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { buildNarrationText, generateSpeech, getConfiguredTtsProvider } from "@/lib/tts";
import { uploadToArchiveOrg, isArchiveOrgConfigured } from "@/lib/archiveOrg";
import { uploadToSupabaseStorage } from "@/lib/audioStorage";
import { parseBuffer } from "music-metadata";

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  if (!article.sections?.length) {
    return NextResponse.json({ error: "This article has no content yet. Run Generate Article first." }, { status: 400 });
  }
  if (!getConfiguredTtsProvider()) {
    return NextResponse.json({ error: 'No TTS_PROVIDER configured. Set TTS_PROVIDER="gtts" or "edge-tts" in .env.local.' }, { status: 400 });
  }
  if (!isArchiveOrgConfigured()) {
    return NextResponse.json({ error: "Missing ARCHIVE_ORG_ACCESS_KEY / ARCHIVE_ORG_SECRET_KEY — get a keypair at https://archive.org/account/s3.php" }, { status: 400 });
  }

  const narrationText = buildNarrationText(article);

  let mp3: Buffer;
  try {
    mp3 = await generateSpeech(narrationText);
  } catch (e: any) {
    return NextResponse.json({ error: `Narration failed: ${e.message}` }, { status: 502 });
  }

  let durationSeconds: number | null = null;
  try {
    const meta = await parseBuffer(mp3, "audio/mpeg");
    durationSeconds = meta.format.duration ? Math.round(meta.format.duration) : null;
  } catch (e: any) {
    console.warn("[generate/audio] Could not read mp3 duration:", e.message);
  }

  // Save to Supabase Storage FIRST, unconditionally — this is the mp3's
  // durable home. Whatever happens with archive.org next, this URL always
  // works and the audio is never lost.
  let storageUrl: string;
  try {
    storageUrl = await uploadToSupabaseStorage(mp3, articleId);
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to save the generated audio: ${e.message}` }, { status: 500 });
  }

  // Archive.org is the preferred final host (matches the pattern from your
  // other embeds), but it's now best-effort on top of an already-saved
  // file — if it's throttling, the Supabase Storage link still works fine
  // as the audio_url and can be upgraded later via retry-archive.
  let finalUrl = storageUrl;
  let archiveWarning: string | undefined;
  if (isArchiveOrgConfigured()) {
    try {
      finalUrl = await uploadToArchiveOrg(mp3, article.title, article.permalink || article.title);
    } catch (e: any) {
      archiveWarning = `Archive.org upload didn't go through (${e.message}) — using the Supabase-hosted copy for now. Try "Retry Archive.org upload" later, or just leave it as-is; the audio works either way.`;
    }
  }

  const { data: updated, error } = await sb
    .from("articles")
    .update({ audio_url: finalUrl, audio_duration_seconds: durationSeconds })
    .eq("id", articleId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ...updated, archiveWarning });
}