// Thin wrapper around the Gemini REST API (generativelanguage.googleapis.com).
// Uses fetch directly so there's no extra SDK dependency to manage.

const STYLE_CONTRACT = `You write for "Synapse Snaps," a curiosity-driven publication.
VOICE: approachable and curious, like explaining a big question to a smart friend. Professional but conversational. Written from a learner's perspective, not an expert's. Clear, no unnecessary complexity. Centered on questions, mysteries, and surprising insight.
NEVER use these words or characters: delve, leverage, unlock, tapestry, testament, streamlined, or the em dash character (—). Use a comma or period instead.
Avoid textbook tone, clickbait, unexplained jargon, and long run-on sentences.
Return ONLY valid JSON. No markdown code fences, no preamble, no commentary outside the JSON.`;

export async function callGemini(userPrompt: string, maxOutputTokens = 2048): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it to .env.local (get a free key at https://aistudio.google.com/app/apikey).");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: STYLE_CONTRACT }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens,
          temperature: 0.9,
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ?? "";
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

export function parseModelJSON<T = any>(raw: string): T {
  let cleaned = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Salvage a truncated JSON array by keeping only complete top-level objects.
    const arrStart = cleaned.indexOf("[");
    if (arrStart > -1) {
      let depth = 0,
        lastGoodEnd = -1,
        inStr = false,
        esc = false;
      for (let i = arrStart; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          continue;
        }
        if (inStr) continue;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) lastGoodEnd = i;
        }
      }
      if (lastGoodEnd > arrStart) {
        const salvaged = cleaned.slice(arrStart, lastGoodEnd + 1) + "]";
        return JSON.parse(salvaged);
      }
    }
    throw new Error("Could not parse a JSON response from the model.");
  }
}

export const BANNED_WORDS = ["delve", "leverage", "unlock", "tapestry", "testament", "streamlined"];

export function scanBannedWords(text: string): { word: string; count: number }[] {
  const hits: { word: string; count: number }[] = [];
  BANNED_WORDS.forEach((w) => {
    const re = new RegExp(`\\b${w}\\b`, "gi");
    const m = text.match(re);
    if (m) hits.push({ word: w, count: m.length });
  });
  const emdash = (text.match(/—/g) || []).length;
  if (emdash) hits.push({ word: "em dash (—)", count: emdash });
  return hits;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
