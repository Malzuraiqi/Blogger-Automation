// FILE: src/app/api/cron/autopilot/route.ts
// GET: hit by Vercel Cron on schedule. Requires Authorization: Bearer <CRON_SECRET>, which Vercel adds automatically when CRON_SECRET is set as a project env var.

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { runAutopilot } from "@/lib/autopilot";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured — refusing to run unprotected." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = supabaseServer();
  const results = await runAutopilot(req.nextUrl.origin, sb);
  await sb.from("autopilot_runs").insert({ triggered_by: "cron", results });

  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}