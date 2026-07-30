// FILE: src/lib/tts.ts
// buildNarrationText(article) + generateSpeech(text): builds the spoken-text version of an article (sections + conclusion ONLY — no TL;DR, captions, or links) and synthesizes it to an mp3 Buffer via whichever TTS_PROVIDER is configured ("gtts" | "edge-tts").

import { safeFetch, fetchWithRetry } from "@/lib/net";

export type TtsProvider = "gtts" | "edge-tts" | "";

export function getConfiguredTtsProvider(): TtsProvider {
  return (process.env.TTS_PROVIDER as TtsProvider) || "";
}

// Only the sections and conclusion are read aloud — NOT the TL;DR (it's
// already shown as text right next to the player), NOT image captions,
// and NOT the "Learn more from" / "You might also like" link paragraphs,
// since none of those carry the article's actual substance. Headings ARE
// read, the way a person narrating the piece out loud would naturally
// announce each new section before diving into it.
export function buildNarrationText(article: { sections?: { heading: string; body: string }[]; conclusion?: string | null }): string {
  const sections = article.sections || [];
  const parts = sections.map((s) => `${s.heading}. ${s.body}`);
  if (article.conclusion) parts.push(`Wrapping up. ${article.conclusion}`);
  return parts.join("\n\n");
}

export async function generateSpeech(text: string): Promise<Buffer> {
  const provider = getConfiguredTtsProvider();
  if (!provider) {
    throw new Error('No TTS_PROVIDER configured. Set TTS_PROVIDER to "gtts" or "edge-tts" in .env.local to generate audio narration.');
  }
  if (!text.trim()) {
    throw new Error("Nothing to narrate — this article has no sections yet.");
  }
  switch (provider) {
    case "gtts":
      return generateWithGtts(text);
    case "edge-tts":
      return generateWithEdgeTts(text);
    default:
      throw new Error(`Unknown TTS_PROVIDER "${provider}"`);
  }
}

// Splits on sentence boundaries (. ! ?) without ever cutting a sentence in
// half, keeping each chunk under `maxLen` characters. Falls back to a hard
// cut only if a single "sentence" is itself longer than maxLen.
function splitIntoChunks(text: string, maxLen: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + " " + s).trim().length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = s.length > maxLen ? "" : s;
      if (s.length > maxLen) {
        for (let i = 0; i < s.length; i += maxLen) chunks.push(s.slice(i, i + maxLen));
      }
    } else {
      current = (current + " " + s).trim();
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ─── gTTS (Google Translate's TTS endpoint) ────────────────────────────────
// Same endpoint the Python gTTS library calls under the hood. No API key.
// The endpoint caps out around ~200 characters per request, so a full
// article becomes dozens of small requests — each retried on 429 via
// fetchWithRetry, with a short pause between chunks, since this endpoint
// rate-limits a single IP fairly aggressively on longer articles.
async function generateWithGtts(text: string): Promise<Buffer> {
  const lang = process.env.GTTS_LANG || "en";
  const chunks = splitIntoChunks(text, 200);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunk)}`;
    const res = await fetchWithRetry("gTTS", url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) throw new Error(`gTTS request failed ${res.status} for a text chunk.`);
    buffers.push(Buffer.from(await res.arrayBuffer()));
    await new Promise((r) => setTimeout(r, 250));
  }
  return Buffer.concat(buffers);
}

// ─── Edge TTS (Microsoft Edge's "Read aloud" neural voices) ────────────────
// Unofficial, reverse-engineered protocol (no Azure subscription, no key):
// a WebSocket handshake to Microsoft's speech service, then an SSML
// payload. Requires the `ws` package server-side. This can break if
// Microsoft changes the protocol — if it starts failing, that's the first
// thing to check.
async function generateWithEdgeTts(text: string): Promise<Buffer> {
  const voice = process.env.EDGE_TTS_VOICE || "en-US-AndrewNeural";
  const chunks = splitIntoChunks(text, 3000); // Edge tolerates far more per-request than gTTS
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeOneChunkWithEdgeTts(chunk, voice));
  }
  return Buffer.concat(buffers);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function synthesizeOneChunkWithEdgeTts(text: string, voice: string): Promise<Buffer> {
  let WebSocketCtor: any;
  try {
    WebSocketCtor = (await import("ws")).default;
  } catch {
    throw new Error('Edge TTS needs the "ws" package. Run: npm install ws');
  }

  const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"; // public constant baked into every edge-tts client
  const connectionId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const wsUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}`;

  return new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocketCtor(wsUrl, {
      headers: { Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold" },
    });
    const audioParts: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.terminate();
        reject(new Error("Edge TTS timed out waiting for a response."));
      }
    }, 30_000);

    ws.on("open", () => {
      const now = new Date().toUTCString();
      const configMsg =
        `X-Timestamp:${now}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        });
      ws.send(configMsg);

      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`;
      const ssmlMsg = `X-RequestId:${connectionId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${now}\r\nPath:ssml\r\n\r\n${ssml}`;
      ws.send(ssmlMsg);
    });

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Binary frame layout: 2-byte big-endian header length, then that
        // many bytes of plain-text headers, then the raw mp3 chunk.
        const headerLen = data.readUInt16BE(0);
        const headers = data.slice(2, 2 + headerLen).toString("utf-8");
        if (headers.includes("Path:audio")) {
          audioParts.push(data.slice(2 + headerLen));
        }
      } else {
        const msg = data.toString("utf-8");
        if (msg.includes("Path:turn.end") && !settled) {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve(Buffer.concat(audioParts));
        }
      }
    });

    ws.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Edge TTS websocket error: ${err.message}`));
      }
    });
  });
}