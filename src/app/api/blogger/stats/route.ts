// FILE: src/app/api/blogger/stats/route.ts
import { NextResponse } from "next/server";
import { getValidAccessToken, getPageViews } from "@/lib/blogger";

export async function GET() {
  try {
    const { accessToken, blogId } = await getValidAccessToken();
    if (!blogId) return NextResponse.json({ error: "No blog selected yet." }, { status: 400 });
    const counts = await getPageViews(accessToken, blogId);
    return NextResponse.json(counts);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}