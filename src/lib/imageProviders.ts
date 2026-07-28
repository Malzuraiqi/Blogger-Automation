// FILE: src/lib/imageProviders.ts
// generateImage(prompt): calls whichever IMAGE_PROVIDER you configured (huggingface/pollinations/stability/gemini/openai), then uploads to ImgBB if configured. Used by generate/images/route.ts.

// Thin abstraction so the app can generate real images from a text prompt
// without caring which provider is configured. Configure via env:
//   IMAGE_PROVIDER = "huggingface" | "pollinations" | "stability" | "gemini" | "openai" | "" (unset = skip)
// and the matching API key/token (huggingface and pollinations are free):
//   HF_TOKEN (huggingface — free, get one at https://huggingface.co/settings/tokens)
//   (pollinations needs no key at all)
//   STABILITY_API_KEY
//   GEMINI_API_KEY / OPENAI_API_KEY (paid — only needed if you use those)
//
// If IMGBB_API_KEY is also set, every generated image is uploaded to ImgBB
// (https://api.imgbb.com — free API key, no OAuth) and the returned hosted
// link is used instead of the raw provider output. This matters because:
// (a) some providers return a large base64 data: URL, which is unwieldy to
// store and paste around, and (b) some providers' hosted URLs (e.g.
// OpenAI's, or Pollinations' live-generation URL) aren't guaranteed to stay
// valid forever, which would silently break the post later. An ImgBB link
// is small, permanent (with default "never expire" setting), and drops
// straight into <img src="...">.
//
// If ImgBB isn't configured, or the upload fails for any reason, this falls
// back to returning the provider's raw result so image generation still
// works end to end — just without the extra hosting step.

export type ImageProvider = "huggingface" | "pollinations" | "stability" | "gemini" | "openai" | "";

export function getConfiguredProvider(): ImageProvider {
  return (process.env.IMAGE_PROVIDER as ImageProvider) || "";
}

export function isImageHostConfigured(): boolean {
  return !!process.env.IMGBB_API_KEY;
}

// fetch() throws a bare `TypeError: fetch failed` on any network-level
// failure (DNS lookup failed, connection refused, TLS handshake failed,
// blocked by a firewall/corporate proxy, etc.) — the actually useful detail
// lives one or more levels down in `error.cause`, which Node doesn't surface
// by default. This wrapper unwraps that chain and names which service/URL
// was being called, so "failed to fetch" turns into something like
// "Hugging Face: network request to https://api-inference.huggingface.co/... 
// failed (ENOTFOUND -> getaddrinfo ENOTFOUND api-inference.huggingface.co)"
// — actionable instead of a dead end.
async function safeFetch(service: string, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e: any) {
    const chain: string[] = [];
    let cur: any = e;
    let depth = 0;
    while (cur && depth < 5) {
      if (cur.code) chain.push(String(cur.code));
      else if (cur.message) chain.push(String(cur.message));
      cur = cur.cause;
      depth++;
    }
    const detail = chain.length ? chain.join(" -> ") : String(e);
    throw new Error(
      `${service}: network request to ${url} never got a response (${detail}). This means the server process couldn't reach that host at all — check the server's internet connection, and any firewall, antivirus, or corporate/VPN proxy that might be blocking outbound HTTPS to this domain.`
    );
  }
}

// Free-tier image providers (Pollinations especially, which caps a single
// IP at one in-flight request) return 429 under any load at all — including
// briefly overlapping requests even when the app is already calling them
// one at a time. This retries a 429 a few times with increasing delay
// before giving up, which clears the great majority of these.
async function fetchWithRetry(service: string, url: string, init: RequestInit | undefined, maxAttempts = 4): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await safeFetch(service, url, init);
    if (res.status !== 429) return res;
    lastRes = res;
    if (attempt < maxAttempts) {
      const waitMs = 3000 * attempt; // 3s, 6s, 9s...
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  return lastRes as Response;
}

export async function generateImage(prompt: string): Promise<string> {
  const provider = getConfiguredProvider();
  if (!provider) {
    throw new Error("No IMAGE_PROVIDER configured. Set IMAGE_PROVIDER (e.g. \"huggingface\" or \"stability\") and its token in .env.local to auto-generate images.");
  }

  let result: string;
  switch (provider) {
    case "huggingface":
      result = await generateWithHuggingFace(prompt);
      break;
    case "pollinations":
      result = await generateWithPollinations(prompt);
      break;
    case "stability":
      result = await generateWithStability(prompt);
      break;
    case "gemini":
      result = await generateWithGemini(prompt);
      break;
    case "openai":
      result = await generateWithOpenAI(prompt);
      break;
    default:
      throw new Error(`Unknown IMAGE_PROVIDER "${provider}"`);
  }

  if (!isImageHostConfigured()) return result;

  try {
    return await uploadToImgbb(result);
  } catch (e: any) {
    // Hosting is a nice-to-have on top of a working provider result — don't
    // fail the whole image generation step just because hosting failed.
    console.warn(`[imageProviders] ImgBB upload failed, keeping the provider's raw result instead: ${e.message}`);
    return result;
  }
}

// Hugging Face Inference API. Free tier, needs a token (HF_TOKEN) from
// https://huggingface.co/settings/tokens — a plain "read" token is enough.
// Default model is FLUX.1-schnell, a fast, good-quality, freely-licensed
// model well suited to the free inference tier; override with
// HF_IMAGE_MODEL if you prefer a different one.
async function generateWithHuggingFace(prompt: string): Promise<string> {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error("Missing HF_TOKEN for Hugging Face image generation.");
  const model = process.env.HF_IMAGE_MODEL;
  const endpoint = `https://router.huggingface.co/hf-inference/models/${model}`;

  const call = () =>
    fetchWithRetry(
      "Hugging Face",
      endpoint,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: prompt }),
      },
      3
    );

  let res = await call();

  // Free-tier models cold-start ("model is loading") the first time they're
  // called after a period of inactivity. HF returns 503 with an
  // estimated_time in seconds — wait that long once and retry.
  if (res.status === 503) {
    let waitSeconds = 15;
    try {
      const body = await res.clone().json();
      if (typeof body?.estimated_time === "number") waitSeconds = Math.min(35, Math.ceil(body.estimated_time));
    } catch {
      /* ignore — use default wait */
    }
    await new Promise((r) => setTimeout(r, waitSeconds * 1000));
    res = await call();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Hugging Face image API error ${res.status}: ${text.slice(0, 300)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    // A 200 with a non-image content-type usually means HF sent back a
    // JSON error/status payload instead of image bytes.
    const text = await res.text().catch(() => "");
    throw new Error(`Hugging Face did not return image data (content-type ${contentType}): ${text.slice(0, 300)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${contentType.split(";")[0]};base64,${buf.toString("base64")}`;
}

// Pollinations AI (https://pollinations.ai) — free, no API key required at
// all. It's a GET-based live image generation endpoint: requesting the URL
// generates and returns the image directly. Override the model via
// POLLINATIONS_MODEL (defaults to "flux").
async function generateWithPollinations(prompt: string): Promise<string> {
  const model = process.env.POLLINATIONS_MODEL || "flux";
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=${encodeURIComponent(model)}&seed=${seed}&nologo=true`;

  const res = await fetchWithRetry("Pollinations", url, undefined);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Pollinations image error ${res.status}: ${text.slice(0, 300)}`);
  }
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${contentType.split(";")[0]};base64,${buf.toString("base64")}`;
}

// Uploads a base64 data: URL or a hosted URL to ImgBB and returns the
// permanent https://i.ibb.co/... link. Get a free API key at
// https://api.imgbb.com/ (just sign in and copy the key — no app review,
// no client secret, no OAuth flow).
async function uploadToImgbb(imageResult: string): Promise<string> {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error("Missing IMGBB_API_KEY.");

  let base64: string;
  if (imageResult.startsWith("data:")) {
    base64 = imageResult.split(",")[1] || "";
    if (!base64) throw new Error("Malformed data URL from image provider.");
  } else {
    // ImgBB's upload endpoint wants actual image bytes, not a remote URL to
    // fetch itself — so if the provider gave us a hosted URL (e.g. OpenAI),
    // download it first and re-encode as base64.
    const res = await safeFetch("ImgBB (fetching provider image)", imageResult);
    if (!res.ok) throw new Error(`Could not fetch provider image for upload: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    base64 = buf.toString("base64");
  }

  const body = new URLSearchParams({ key: apiKey, image: base64 });
  const res = await safeFetch("ImgBB", "https://api.imgbb.com/1/upload", { method: "POST", body });
  if (!res.ok) throw new Error(`ImgBB upload error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const link = data?.data?.url || data?.data?.display_url;
  if (!link) throw new Error(`ImgBB response did not include a link: ${JSON.stringify(data).slice(0, 300)}`);
  return link as string;
}

async function generateWithGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY for gemini image generation.");
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
  const res = await safeFetch(
    "Gemini",
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini image API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) throw new Error("Gemini image response did not include image data.");
  const mime = imagePart.inlineData.mimeType || "image/png";
  return `data:${mime};base64,${imagePart.inlineData.data}`;
}

async function generateWithOpenAI(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY for openai image generation.");
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
  const res = await safeFetch("OpenAI", "https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, size: "1024x1024", n: 1 }),
  });
  if (!res.ok) throw new Error(`OpenAI image API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const item = data?.data?.[0];
  if (item?.url) return item.url;
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  throw new Error("OpenAI image response did not include a URL or base64 payload.");
}

async function generateWithStability(prompt: string): Promise<string> {
  const apiKey = process.env.STABILITY_API_KEY;
  if (!apiKey) throw new Error("Missing STABILITY_API_KEY for stability image generation.");
  const res = await safeFetch("Stability", "https://api.stability.ai/v2beta/stable-image/generate/core", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    body: (() => {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("output_format", "png");
      return form;
    })(),
  });
  if (!res.ok) throw new Error(`Stability image API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data?.image) throw new Error("Stability response did not include image data.");
  return `data:image/png;base64,${data.image}`;
}