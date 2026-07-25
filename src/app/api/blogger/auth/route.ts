// FILE: src/app/api/blogger/auth/route.ts
// GET: redirects to Google's OAuth consent screen. Hit by the "Connect Google account" button.

import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/blogger";

export async function GET() {
  try {
    return NextResponse.redirect(getAuthUrl());
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}