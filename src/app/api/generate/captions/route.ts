// FILE: src/app/api/generate/captions/route.ts
// POST: rewrites captions on existing article_images rows. Hit by the "Generate Captions" step.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON } from "@/lib/gemini";

// Step 3 of the pipeline: "Generate Captions".
// "Generate Images" already writes a first-pass caption for each image, so
// this step is for refining/rewriting captions on demand without touching
// placement or the image-generation prompt (and without regenerating images).
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const { data: images } = await sb.from("article_images").select("*").eq("article_id", articleId).order("sort_order");
  if (!images?.length) return NextResponse.json({ error: "No images to caption yet. Run Generate Images first." }, { status: 400 });

  const prompt = `Article title: ${article.title}
Article TL;DR: ${article.tldr}

For each image below, write a short, publishable one-sentence caption a reader would see directly under the image.

Images:
${images.map((img, i) => `${i + 1}. Placement: ${img.placement}. What it depicts: ${img.prompt}`).join("\n")}

Return ONLY a JSON array of ${images.length} strings, one caption per image, in the same order. No text before or after the array.`;

  let captions: string[];
  try {
    const raw = await callGemini(prompt, 4096);
    const parsed = parseModelJSON<any>(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Model did not return a JSON array (response may have been truncated). Try again.");
    }
    captions = parsed;
  } catch (e: any) {
    return NextResponse.json({ error: `Caption generation failed: ${e.message}` }, { status: 502 });
  }

  const updateErrors: string[] = [];
  const updated = await Promise.all(
    images.map(async (img, i) => {
      const caption = captions[i] || img.caption;
      const { data, error } = await sb.from("article_images").update({ caption }).eq("id", img.id).select().single();
      if (error) {
        console.error(`[generate/captions] Failed to update image ${img.id}:`, error.message);
        updateErrors.push(`${img.placement}: ${error.message}`);
        return img; // keep the old row rather than losing it from the response
      }
      return data;
    })
  );

  if (updateErrors.length === images.length) {
    // Every single write failed — this is the "looked like 200 but nothing
    // saved" case. Report it as a real error instead of pretending it worked.
    return NextResponse.json({ error: `All caption updates failed: ${updateErrors.join(" | ")}` }, { status: 500 });
  }

  return NextResponse.json({ images: updated, updateErrors: updateErrors.length ? updateErrors : undefined });
}