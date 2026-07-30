// FILE: src/lib/audioStorage.ts
// uploadToSupabaseStorage(mp3, articleId): saves the mp3 to Supabase Storage immediately after TTS generation, BEFORE attempting archive.org — this is what guarantees the audio is never lost even if archive.org throttles or rejects the upload.

import { supabaseServer } from "@/lib/supabase";

const BUCKET = process.env.ARCHIVE_AUDIO_BUCKET || "article-audio";

export async function uploadToSupabaseStorage(mp3: Buffer, articleId: string): Promise<string> {
  const sb = supabaseServer();
  const path = `${articleId}.mp3`;

  const { error } = await sb.storage.from(BUCKET).upload(path, mp3, {
    contentType: "audio/mpeg",
    upsert: true, // regenerating audio for the same article just overwrites its file
  });
  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function fetchStoredAudio(articleId: string): Promise<Buffer> {
  const sb = supabaseServer();
  const path = `${articleId}.mp3`;
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`No stored audio found for this article (${error?.message || "not found"}).`);
  return Buffer.from(await data.arrayBuffer());
}