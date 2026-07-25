// FILE: src/app/api/blogger/callback/route.ts
// GET: Google's OAuth redirect target. Exchanges the code for tokens and stores them. You never call this directly, Google does.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { exchangeCodeForTokens } from "@/lib/blogger";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const errorParam = req.nextUrl.searchParams.get("error");
  const appUrl = new URL("/", req.url);

  if (errorParam) {
    appUrl.searchParams.set("blogger_error", errorParam);
    return NextResponse.redirect(appUrl);
  }
  if (!code) {
    appUrl.searchParams.set("blogger_error", "missing_code");
    return NextResponse.redirect(appUrl);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const sb = supabaseServer();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Single-user app: replace any previously stored credentials.
    await sb.from("blogger_credentials").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await sb.from("blogger_credentials").insert({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: expiresAt,
    });

    appUrl.searchParams.set("blogger_connected", "1");
    return NextResponse.redirect(appUrl);
  } catch (e: any) {
    appUrl.searchParams.set("blogger_error", e.message);
    return NextResponse.redirect(appUrl);
  }
}