// FILE: src/app/api/blogger/sync/route.ts
// POST: catches up local status/published_at for every article that has a
// blogger_post_id, against Blogger's OWN current state. Needed because
// publishing a saved draft directly from Blogger's dashboard (instead of
// this app's "Publish live" button) never reaches our database otherwise.
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getValidAccessToken, getPost } from "@/lib/blogger";

export async function POST() {
    const sb = supabaseServer();
    const { accessToken, blogId } = await getValidAccessToken();
    if (!blogId) return NextResponse.json({ error: "No blog selected yet." }, { status: 400 });

    const { data: articles } = await sb.from("articles").select("id, status, published_at, blogger_post_id").not("blogger_post_id", "is", null);
    let updated = 0;
    const errors: string[] = [];

    let promoted = 0, corrected = 0;

    // src/app/api/blogger/sync/route.ts — replace the loop body
    for (const a of articles || []) {
        try {
            const post = await getPost(accessToken, blogId, a.blogger_post_id);
            const isLive = post.status === "LIVE";

            if (isLive && (a.status !== "published" || !a.published_at)) {
                await sb.from("articles").update({
                    status: "published",
                    published_url: post.url,
                    published_at: post.published || new Date().toISOString(),
                }).eq("id", a.id);
                promoted++;
            } else if (!isLive && a.status === "published") {
                // Leftover from the earlier bug that marked drafts as "published"
                // locally even though they were never actually live — put it back
                // so it reappears in the Approval Queue.
                await sb.from("articles").update({ status: "drafting", published_at: null }).eq("id", a.id);
                corrected++;
            }
        } catch (e: any) {
            errors.push(`${a.id}: ${e.message}`);
        }
    }

    return NextResponse.json({ promoted, corrected, errors });
}