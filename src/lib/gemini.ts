// FILE: src/lib/gemini.ts (top section replaced)

const BASE_VOICE = `You write for "Synapse Snaps," a curiosity-driven publication.
VOICE: approachable and curious, like explaining a big question to a smart friend. Professional but conversational. Written from a learner's perspective, not an expert's. Clear, no unnecessary complexity. Centered on questions, mysteries, and surprising insight.
NEVER use these words or characters: delve, leverage, unlock, tapestry, testament, streamlined, or the em dash character (—). Use a comma or period instead.
Avoid textbook tone, clickbait, unexplained jargon, and long run-on sentences.
Return ONLY valid JSON. Do not include any planning, outline, notes, or commentary before or after the JSON object — the very first character of your response must be "{" and the very last must be "}". No markdown code fences.`;

export const CONTENT_TYPES = ["factual", "opinion", "research", "listicle", "narrative"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

const STRUCTURE_MODULES: Record<ContentType, string> = {
  factual: `CONTENT TYPE: Factual explainer. Structure sections as: set up the question or misconception, explain the actual mechanism/answer in plain terms, then a "why it matters" or "what this means" close. Prioritize accuracy and clarity over cleverness. Refer to general scientific consensus rather than a single unnamed study.`,
  opinion: `CONTENT TYPE: Opinion piece. State a clear point of view early — don't hedge it into mush. Acknowledge at least one real counterargument or complication, then explain why the position still holds. A little provocative is fine, but the reasoning must be sound, not contrarian for its own sake. Close with a clear, restated position, not a wishy-washy "who's to say."`,
  research: `CONTENT TYPE: Research roundup. Each section should follow a claim → evidence → so-what shape: state a specific finding, explain the evidence/mechanism behind it in plain terms, then say why a reader should care. Favor precision and named sources/organizations over vague "studies show." Flag genuine uncertainty or disagreement in the field where it exists rather than overclaiming.`,
  listicle: `CONTENT TYPE: Listicle. Each "section" is one list item: a short punchy heading (can include a number, e.g. "1. ..."), followed by 2-4 sentences of real substance, not filler. Keep items roughly parallel in structure and length. The tldr should frame why this particular list matters, not just "here are N things."`,
  narrative: `CONTENT TYPE: Narrative feature. Structure as a story arc — open with a scene, person, or moment rather than a thesis statement, build through rising specificity, and let the point of the piece emerge through the narrative rather than being stated upfront. Sections should read like chapters, not standalone facts.`,
};

// Composes the final system instruction: base voice + content-type structure
// rules + (if one exists) the extracted writer's-voice profile, which takes
// priority over the generic voice guidance wherever the two disagree.
export function buildSystemInstruction(contentType?: string | null, styleProfile?: string | null): string {
  const type: ContentType = (CONTENT_TYPES as readonly string[]).includes(contentType || "")
    ? (contentType as ContentType)
    : "factual";
  const parts = [BASE_VOICE, STRUCTURE_MODULES[type]];
  if (styleProfile && styleProfile.trim()) {
    parts.push(
      `WRITER'S VOICE PROFILE — this is a real person's actual writing style, extracted from their own past posts. Where it conflicts with the generic voice guidance above, follow THIS instead:\n${styleProfile.trim()}`
    );
  }
  return parts.join("\n\n");
}

export async function callGemini(
  userPrompt: string,
  maxOutputTokens = 2048,
  systemInstruction: string = buildSystemInstruction()
): Promise<string> {
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
        systemInstruction: { parts: [{ text: systemInstruction }] },
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

  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason === "MAX_TOKENS") {
    console.warn(`[gemini] Response truncated (finishReason=MAX_TOKENS) at maxOutputTokens=${maxOutputTokens}. Consider raising it or shortening the prompt.`);
  } else if (finishReason && finishReason !== "STOP") {
    console.warn(`[gemini] Unusual finishReason: ${finishReason}`);
  }

  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const answerParts = parts.filter((p) => !p.thought);
  const text = (answerParts.length ? answerParts : parts).map((p: any) => p.text || "").join("");
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

export function parseModelJSON<T = any>(raw: string): T {
  const cleaned = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const normalized = normalizeJsonStrings(cleaned);

  // Try every position that could plausibly be the start of the real JSON
  // value. This matters because models sometimes prepend commentary,
  // planning notes, or an outline before the actual JSON object — the real
  // JSON is still complete and valid, it's just not at position 0.
  const candidateStarts: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "{" || normalized[i] === "[") candidateStarts.push(i);
  }

  let lastErr: Error | null = null;
  for (const start of candidateStarts) {
    const extracted = extractBalancedJSON(normalized, start);
    if (!extracted) continue;
    try {
      return JSON.parse(extracted);
    } catch (e) {
      lastErr = e as Error;
      // keep trying later candidate positions
    }
  }

  console.error(
    "[parseModelJSON] Failed to parse model response.\n--- raw (first 1500 chars) ---\n" +
      raw.slice(0, 1500) +
      (raw.length > 1500 ? `\n...[${raw.length - 1500} more chars]` : "") +
      "\n--- raw (last 500 chars) ---\n" +
      raw.slice(-500) +
      `\n--- last parse error ---\n${lastErr?.message ?? "(no candidate JSON found at all)"}`
  );
  throw new Error(
    `Could not parse a JSON response from the model.${lastErr ? " " + lastErr.message : ""}`
  );
}

/**
 * Gemini's responseMimeType:"application/json" mode is a request, not a hard
 * guarantee: models can still (a) prepend planning/outline text before the
 * real JSON, (b) leave the response mid-object if it hits the token limit,
 * or (c) write prose values containing unescaped inner quotes (e.g. a
 * quoted term inside an article body). This function walks the text
 * character by character, tracking whether we're inside a JSON string, and:
 *  - re-escapes raw control characters (literal newlines/tabs) found inside
 *    strings, which JSON.parse rejects outright
 *  - uses a lookahead heuristic to tell a genuine closing quote apart from
 *    an unescaped quote inside prose: a real closing quote is followed
 *    (after any whitespace) by a JSON structural character (, } ] :) or the
 *    end of the text; anything else is treated as a literal quote and
 *    escaped instead
 */
function normalizeJsonStrings(text: string): string {
  let out = "";
  let inStr = false;
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (!inStr) {
      out += ch;
      if (ch === '"') inStr = true;
      continue;
    }

    if (esc) {
      out += ch;
      esc = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      esc = true;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      const looksLikeRealClose =
        next === undefined || next === "," || next === "}" || next === "]" || next === ":";
      if (looksLikeRealClose) {
        inStr = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code === 10) out += "\\n";
    else if (code === 13) out += "\\r";
    else if (code === 9) out += "\\t";
    else if (code < 0x20) continue; // drop other stray control chars
    else out += ch;
  }

  return out;
}

/**
 * Extracts a balanced JSON value starting at `start`, handling two cases
 * uniformly:
 *  - the value is already complete (just possibly followed by trailing
 *    junk, e.g. nothing — a normal, non-truncated response)
 *  - the value got cut off mid-generation, in which case we cut back to the
 *    last fully-completed element and close out whatever brackets/braces
 *    were still open
 * Returns null only if no complete value (not even one field/element) could
 * be found from this starting point.
 */
function extractBalancedJSON(text: string, start: number): string | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let lastSafe: { index: number; stack: string[] } | null = null;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      lastSafe = { index: i + 1, stack: [...stack] };
      if (stack.length === 0) break; // outermost value closed — done
      continue;
    }
    if (ch === "," && stack.length > 0) {
      lastSafe = { index: i, stack: [...stack] };
    }
  }

  if (!lastSafe) return null;

  const closers = lastSafe.stack
    .slice()
    .reverse()
    .map((b) => (b === "{" ? "}" : "]"))
    .join("");

  return text.slice(start, lastSafe.index) + closers;
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