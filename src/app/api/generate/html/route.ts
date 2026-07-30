// FILE: src/app/api/generate/html/route.ts
// POST: assembles the final Blogger-ready HTML from sections/images/links. Hit by the "Generate HTML" step.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

// Step 6 of the pipeline: "Generate HTML".
// Deterministically assembles clean, Blogger-compatible HTML from the
// article's sections, images, and links. This is done in code (not another
// model call) so the output is predictable and never invents content.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { articleId } = await req.json();
  if (!articleId) return NextResponse.json({ error: "articleId is required" }, { status: 400 });

  const { data: article } = await sb.from("articles").select("*").eq("id", articleId).single();
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });
  if (!article.sections?.length) {
    return NextResponse.json({ error: "This article has no content yet. Run Generate Article first." }, { status: 400 });
  }

  const { data: images } = await sb.from("article_images").select("*").eq("article_id", articleId).order("sort_order");
  const { data: links } = await sb.from("article_links").select("*").eq("article_id", articleId);

  const html = buildBloggerHtml(article, images || [], links || []);

  const { data: updated, error } = await sb.from("articles").update({ html }).eq("id", articleId).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(updated);
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Very small markdown-ish -> HTML converter for paragraph bodies: supports
// **bold**, *italic*, "- " bullet lists, and "> " blockquotes. Everything
// else is emitted as plain <p> paragraphs. No inline styles, no scripts.
function inlineFormat(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function paragraphsToHtml(body: string): string {
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  let listBuffer: string[] = [];
  let quoteBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length) {
      out.push(`<ul>\n${listBuffer.map((li) => `    <li>${inlineFormat(li)}</li>`).join("\n")}\n</ul>`);
      listBuffer = [];
    }
  };
  const flushQuote = () => {
    if (quoteBuffer.length) {
      out.push(`<blockquote>\n    ${quoteBuffer.map(inlineFormat).join("<br>\n    ")}\n</blockquote>`);
      quoteBuffer = [];
    }
  };

  for (const line of lines) {
    if (/^[-*]\s+/.test(line)) {
      flushQuote();
      listBuffer.push(line.replace(/^[-*]\s+/, ""));
    } else if (/^>\s?/.test(line)) {
      flushList();
      quoteBuffer.push(line.replace(/^>\s?/, ""));
    } else {
      flushList();
      flushQuote();
      out.push(`<p>${inlineFormat(line)}</p>`);
    }
  }
  flushList();
  flushQuote();
  return out.join("\n\n");
}

function imageBlock(img: any, index: number): string {
  const src = img.image_url || `IMAGE_URL_${index + 1}`;
  return `<img src="${esc(src)}" alt="${esc(img.caption || img.placement || "")}">\n\n<p><em>${inlineFormat(img.caption || "")}</em></p>`;
}

function formatMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

function audioPlayerBlock(article: any): string {
  if (!article.audio_url) return "";
  const durationLabel = article.audio_duration_seconds ? `${formatMinutes(article.audio_duration_seconds)} min` : null;
  return `<div style="margin: 22px 0; padding: 16px 20px; background: #f4f2ec; border: 1px solid #e3e0d6; border-radius: 12px; text-align: center;">
  <div style="font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #8a8677; margin-bottom: 10px; font-weight: 600;">🎧 Listen to this article${durationLabel ? ` — ${durationLabel}` : ""}</div>
  <audio controls controlsList="nodownload" style="width: 100%; max-width: 480px; height: 38px; border-radius: 8px;">
    <source src="${esc(article.audio_url)}" type="audio/mpeg">
    Your browser does not support the audio element.
  </audio>
</div>`;
}

// `placement_note` (e.g. "Use this to explain the biological process of how
// taste receptors function") is guidance written for whoever's assembling
// the article, not reader-facing copy — it must never be printed verbatim
// into the published HTML. This generates a short, natural lead-in instead
// and ignores placement_note entirely for the visible text.
function linkParagraph(link: any): string {
  const lead = link.link_type === "external" ? "Learn more from" : "You might also like:";
  return `<p>${lead} <a href="${esc(link.target_url)}">${esc(link.target_title)}</a>.</p>`;
}

function buildBloggerHtml(article: any, images: any[], links: any[]): string {
  const featured = images.find((i) => i.is_featured);
  const rest = images.filter((i) => !i.is_featured);
  // Only link things that actually have a real destination. A "future idea"
  // internal link has no article published yet (target_url is null) — until
  // that piece exists, linking to it would just be a dead "#" href, so it's
  // left out of the published HTML (it still shows in the Links tab for
  // your own planning).
  const internalLinks = links.filter((l) => l.link_type === "internal_past" && l.target_url);
  const externalLinks = links.filter((l) => l.link_type === "external" && l.target_url);

  const parts: string[] = [];

  // Reading time leads the post so readers know what they're signing up
  // for before they start, rather than finding out at the very end.
  if (article.reading_time_minutes) {
    const listenPart = article.audio_duration_seconds
      ? ` &middot; <strong>Listening time:</strong> ${formatMinutes(article.audio_duration_seconds)} minutes`
      : "";
    parts.push(`<p><strong>Estimated reading time:</strong> ${article.reading_time_minutes} minutes${listenPart}</p>`);
  }
  if (article.tldr) parts.push(`<p><strong>TL;DR:</strong> ${inlineFormat(article.tldr)}</p>`);
  parts.push(audioPlayerBlock(article)); // right after TL;DR, before the featured image
  if (featured) parts.push(imageBlock(featured, images.indexOf(featured)));

  const sections: { heading: string; body: string }[] = article.sections || [];
  // Spread the remaining images and the link paragraphs evenly across the
  // sections so nothing is bunched at the top or bottom.
  const imageSlots = distributeSlots(sections.length, rest.length);
  const internalSlot = sections.length > 1 ? 1 : 0;
  const externalSlot = sections.length > 2 ? sections.length - 2 : sections.length - 1;

  sections.forEach((s, i) => {
    parts.push(`<h2>${esc(s.heading)}</h2>`);
    parts.push(paragraphsToHtml(s.body || ""));

    const imgIdx = imageSlots.indexOf(i);
    if (imgIdx !== -1 && rest[imgIdx]) {
      parts.push(imageBlock(rest[imgIdx], images.indexOf(rest[imgIdx])));
    }
    if (i === internalSlot) {
      internalLinks.forEach((l) => parts.push(linkParagraph(l)));
    }
    if (i === externalSlot) {
      externalLinks.forEach((l) => parts.push(linkParagraph(l)));
    }
  });

  if (article.conclusion) {
    parts.push(`<h2>Wrapping up</h2>`);
    parts.push(paragraphsToHtml(article.conclusion));
  }

  return parts.filter(Boolean).join("\n\n");
}

// Picks `count` distinct section indices (favoring even spacing) to drop
// non-featured images into.
function distributeSlots(sectionCount: number, count: number): number[] {
  if (sectionCount === 0 || count === 0) return [];
  const slots: number[] = [];
  const step = sectionCount / (count + 1);
  for (let i = 1; i <= count; i++) {
    slots.push(Math.min(sectionCount - 1, Math.round(step * i)));
  }
  return slots;
}