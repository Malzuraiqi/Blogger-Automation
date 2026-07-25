// FILE: src/app/api/generate/images/route.ts
// POST: plans images (placement/caption/prompt) and auto-generates them if IMAGE_PROVIDER is set. Hit by the "Generate Images" step.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { callGemini, parseModelJSON } from "@/lib/gemini";
import { generateImage, getConfiguredProvider } from "@/lib/imageProviders";

// Step 2 of the pipeline: "Generate Images".
// Produces a plan (placement, caption, and an image-generation prompt) for
// 1 featured image + 2-4 section images, then — if an IMAGE_PROVIDER is
// configured — immediately calls that provider to generate the actual
// images and stores the resulting URL/base64 on each row.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const bodyText = (article.sections || []).map((s: any) => `${s.heading}\n${s.body}`).join("\n\n");

  const prompt = `Article title: ${article.title}
Article body (for context only, do not rewrite it):
${article.tldr}
${bodyText}
${article.conclusion}

Produce an image plan for this article: 1 featured image plus 2-4 section images (4-5 total).
For each image give:
- placement: where it goes, e.g. "Below article title" or "After the section on X"
- caption: a short, publishable caption a reader would see under the image (one sentence)
- prompt: a detailed, vivid image-generation prompt (style, subject, lighting) suitable for an AI image generator

Return ONLY a JSON array, each item shaped exactly like:
{"isFeatured": true, "placement":"...", "caption":"...", "prompt":"..."}
No text before or after the array.`;

  let plan: any[];
  try {
    const raw = await callGemini(prompt, 4096);
    const parsed = parseModelJSON<any>(raw);
    // parseModelJSON salvages whatever balanced JSON it can find, which
    // means a badly truncated response can come back as an object (or an
    // array missing fields) instead of the array we asked for. Fail loudly
    // with a clear message rather than crashing on .map().
    if (!Array.isArray(parsed)) {
      throw new Error("Model did not return a JSON array (response may have been truncated). Try again.");
    }
    plan = parsed.filter((img) => img && typeof img.prompt === "string" && typeof img.placement === "string");
    if (!plan.length) {
      throw new Error("Model's image plan had no usable entries (response may have been truncated). Try again.");
    }
  } catch (e: any) {
    return NextResponse.json({ error: `Image plan generation failed: ${e.message}` }, { status: 502 });
  }

  await sb.from("article_images").delete().eq("article_id", articleId);

  const rows = plan.map((img, i) => ({
    article_id: articleId,
    is_featured: !!img.isFeatured,
    placement: img.placement,
    caption: img.caption,
    prompt: img.prompt,
    image_url: null as string | null,
    sort_order: i,
  }));

  const { data: inserted, error } = await sb.from("article_images").insert(rows).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort: auto-generate the actual images if a provider is configured.
  // Failures here don't fail the request — the plan is still useful, and the
  // person can retry image generation per-row or fill in image_url manually.
  //
  // IMPORTANT: this runs one image at a time, not in parallel. Free-tier
  // providers (Pollinations in particular, which caps a single IP at one
  // in-flight request) reject anything beyond the first if they're all
  // fired at once via Promise.all — the fix is to simply wait for each
  // image to finish before starting the next.
  const provider = getConfiguredProvider();
  const generationErrors: string[] = [];
  const finalRows: any[] = [];
  if (provider) {
    for (const row of inserted || []) {
      try {
        const url = await generateImage(row.prompt);
        const { data: updated, error: updateErr } = await sb.from("article_images").update({ image_url: url }).eq("id", row.id).select().single();
        if (updateErr) {
          console.error(`[generate/images] Generated an image but failed to save it for row ${row.id}:`, updateErr.message);
          generationErrors.push(`Image "${row.placement}" generated but failed to save: ${updateErr.message}`);
          finalRows.push(row);
        } else {
          finalRows.push(updated || row);
        }
      } catch (e: any) {
        generationErrors.push(`Image "${row.placement}": ${e.message}`);
        finalRows.push(row);
      }
    }
  } else {
    finalRows.push(...(inserted || []));
  }

  return NextResponse.json({ images: finalRows, provider: provider || null, generationErrors });
}