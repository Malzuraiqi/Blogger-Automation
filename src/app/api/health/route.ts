// FILE: src/app/api/health/route.ts
// GET: checks required/optional env vars are set. Called once on app load to surface a misconfigured .env.local immediately instead of on first API failure.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const REQUIRED = [
  { key: "NEXT_PUBLIC_SUPABASE_URL", note: "Supabase project URL" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", note: "Supabase service role key" },
  { key: "GEMINI_API_KEY", note: "Gemini API key" },
];

const OPTIONAL = [
  { key: "IMAGE_PROVIDER", note: "no auto image generation without it" },
  { key: "IMGBB_API_KEY", note: "images won't be permanently hosted" },
  { key: "GOOGLE_CLIENT_ID", note: "can't connect Blogger" },
  { key: "GOOGLE_CLIENT_SECRET", note: "can't connect Blogger" },
  { key: "BLOGGER_REDIRECT_URI", note: "can't connect Blogger" },
];

export async function GET() {
  const missingRequired = REQUIRED.filter((v) => !process.env[v.key]).map((v) => `${v.key} (${v.note})`);
  const missingOptional = OPTIONAL.filter((v) => !process.env[v.key]).map((v) => `${v.key} — ${v.note}`);

  return NextResponse.json({
    ok: missingRequired.length === 0,
    missingRequired,
    missingOptional,
  });
}