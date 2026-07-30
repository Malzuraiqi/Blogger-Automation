// FILE: src/lib/archiveOrg.ts
// uploadToArchiveOrg(mp3, articleTitle, slug): uploads an mp3 to archive.org via its S3-compatible API and returns the permanent public download link (same link shape as https://archive.org/download/<identifier>/<filename>).

import { safeFetch } from "@/lib/net";

function slugifyForIdentifier(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

export function isArchiveOrgConfigured(): boolean {
  return !!(process.env.ARCHIVE_ORG_ACCESS_KEY && process.env.ARCHIVE_ORG_SECRET_KEY);
}

// Archive.org's abuse-detection throttles uploads that come in too close
// together from the same account — it responds 503 with an XML body whose
// <Code> is "SlowDown" (sometimes phrased as "appears to be spam", which
// is just their wording for the same rate-limit, not an actual account
// flag). This is unrelated to the 429 handling in src/lib/net.ts, so it
// gets its own longer backoff here: 20s, 45s, 90s, 180s. In practice this
// clears within the first 1-2 retries unless uploads are genuinely being
// fired in a tight loop.
const SLOWDOWN_WAITS_MS = [15_000, 30_000];

// Additionally, enforce a minimum gap between the START of one upload and
// the next within this same server process — this is what actually
// prevents the SlowDown in the first place when "Run Full Pipeline" or
// Autopilot processes several articles' audio back-to-back. A module-level
// variable is fine here since this is a single-user app with one server
// process (per the project's scope).
const MIN_GAP_MS = 15_000;
let lastUploadStartedAt = 0;

async function waitForUploadSlot(): Promise<void> {
  const elapsed = Date.now() - lastUploadStartedAt;
  if (elapsed < MIN_GAP_MS) {
    await new Promise((r) => setTimeout(r, MIN_GAP_MS - elapsed));
  }
  lastUploadStartedAt = Date.now();
}

function isSlowDown(status: number, bodyText: string): boolean {
  return status === 503 && /SlowDown|appears to be spam/i.test(bodyText);
}

// archive.org's upload API is S3-compatible: PUT straight to
// https://s3.us.archive.org/<new-identifier>/<filename> and it creates the
// "item" on the fly (x-amz-auto-make-bucket:1). The download link is
// deterministic from identifier + filename — no separate "create item"
// call or polling. Note: the file can take a few minutes to finish
// processing on archive.org's side after the PUT returns 200, so a
// freshly-generated link may briefly 404 before it's ready.
export async function uploadToArchiveOrg(mp3: Buffer, articleTitle: string, slug: string): Promise<string> {
  const accessKey = process.env.ARCHIVE_ORG_ACCESS_KEY;
  const secretKey = process.env.ARCHIVE_ORG_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error("Missing ARCHIVE_ORG_ACCESS_KEY / ARCHIVE_ORG_SECRET_KEY. Get an S3-like keypair at https://archive.org/account/s3.php");
  }
  const collection = process.env.ARCHIVE_ORG_COLLECTION || "opensource_audio";

  const identifier = `synapse-snaps-${slugifyForIdentifier(slug || articleTitle)}-${Date.now()}`;
  const filename = `${slugifyForIdentifier(articleTitle) || "article"}.mp3`;
  const url = `https://s3.us.archive.org/${identifier}/${encodeURIComponent(filename)}`;

  await waitForUploadSlot();

  let lastErrorText = "";
  for (let attempt = 0; attempt <= SLOWDOWN_WAITS_MS.length; attempt++) {
    const res = await safeFetch("Archive.org", url, {
      method: "PUT",
      headers: {
        Authorization: `LOW ${accessKey}:${secretKey}`,
        "Content-Type": "audio/mpeg",
        "x-amz-auto-make-bucket": "1",
        "x-archive-meta-mediatype": "audio",
        "x-archive-meta-collection": collection,
        "x-archive-meta-title": articleTitle,
        // Tells archive.org's backend not to queue this item for full
        // derivation processing (waveform, alternate formats, etc), which
        // isn't needed here and reduces the load their abuse-detection is
        // reacting to.
        "x-archive-queue-derive": "0",
      },
      body: new Uint8Array(mp3),
    });

    if (res.ok) return `https://archive.org/download/${identifier}/${encodeURIComponent(filename)}`;

    const text = await res.text().catch(() => "");
    lastErrorText = text;

    if (isSlowDown(res.status, text) && attempt < SLOWDOWN_WAITS_MS.length) {
      const wait = SLOWDOWN_WAITS_MS[attempt];
      console.warn(`[archiveOrg] Got SlowDown (attempt ${attempt + 1}/${SLOWDOWN_WAITS_MS.length + 1}), waiting ${wait / 1000}s before retrying...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    throw new Error(`Archive.org upload failed ${res.status}: ${text.slice(0, 400)}`);
  }

  throw new Error(`Archive.org upload failed after repeated SlowDown responses: ${lastErrorText.slice(0, 400)}`);
}