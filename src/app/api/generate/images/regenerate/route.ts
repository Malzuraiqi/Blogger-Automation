// FILE: src/app/api/generate/images/regenerate/route.ts
// POST: regenerates ONE existing article_images row using its stored prompt. Hit by the per-image "Regenerate" button.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { generateImage, getConfiguredProvider } from "@/lib/imageProviders";

// Unlike POST /api/generate/images (which wipes and replans every image for
// an article), this only re-runs image *generation* for one already-planned
// row — the placement/caption/prompt stay exactly as they are, only
// image_url changes. Useful when one image in an otherwise-good plan failed
// or came out looking wrong.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { imageId } = await req.json();
  if (!imageId) return NextResponse.json({ error: "imageId is required" }, { status: 400 });

  const { data: image } = await sb.from("article_images").select("*").eq("id", imageId).single();
  if (!image) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  if (!image.prompt) return NextResponse.json({ error: "This image has no stored prompt to regenerate from." }, { status: 400 });

  const provider = getConfiguredProvider();
  if (!provider) {
    return NextResponse.json({ error: "No IMAGE_PROVIDER configured. Set it in .env.local to generate images." }, { status: 400 });
  }

  try {
    const url = await generateImage(image.prompt);
    const { data: updated, error } = await sb.from("article_images").update({ image_url: url }).eq("id", imageId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}