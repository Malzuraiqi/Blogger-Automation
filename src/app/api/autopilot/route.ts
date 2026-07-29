// FILE: src/app/api/autopilot/route.ts
// POST: manually triggers the same autopilot run as the cron job, on demand from the UI. No secret required — this is app-internal, unlike the cron route which is hit from outside.
// GET: returns the last 10 autopilot runs (cron or manual) for the "Autopilot" panel to display.

import { NextResponse, NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { runAutopilot } from "@/lib/autopilot";

export const dynamic = "force-dynamic";

export async function GET() {
  const sb = supabaseServer();
  const { data, error } = await sb.from("autopilot_runs").select("*").order("ran_at", { ascending: false }).limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const results = await runAutopilot(req.nextUrl.origin, sb);
  await sb.from("autopilot_runs").insert({ triggered_by: "manual", results });
  return NextResponse.json({ ranAt: new Date().toISOString(), results });
}