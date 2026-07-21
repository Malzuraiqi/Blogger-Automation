# Synapse Snaps — Studio

A real Next.js app implementing the full content workflow: labels, AI-ranked
ideas, full article drafts, SEO/image/link planning, a pipeline board, and
search — backed by Supabase and Google Gemini.

This matches the architecture in `Synapse-Snaps-Product-Docs.md`, with
Gemini standing in for the Claude API call pattern described there (swap
`src/lib/gemini.ts` back to the Anthropic Messages API any time — the rest
of the app doesn't need to change).

## 1. Get your keys

- **Supabase** (free tier): create a project at supabase.com, then go to
  Project Settings > API and copy the Project URL, `anon` key, and
  `service_role` key.
- **Gemini** (free tier): grab a key at
  https://aistudio.google.com/app/apikey

## 2. Set up the database

In your Supabase project, open the SQL Editor and run the entire contents
of `supabase/schema.sql`. This creates the tables and seeds your two
labels (Humanity, Science).

## 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in the four values from step 1.

## 4. Install and run

```bash
npm install
npm run dev
```

Open http://localhost:3000. Pick a label, click "Generate ideas," draft
one, then generate the full article and its SEO/image/link plan.

## 5. Deploy

Push this folder to a GitHub repo, import it into Vercel, and add the
same four environment variables in the Vercel project settings. Vercel
builds and deploys on every push.

## Notes

- The service role key is only ever used server-side (in `src/lib/supabase.ts`,
  imported only by API routes) — it's never sent to the browser.
- Article generation targets 1000-1500 words with a large enough
  `maxOutputTokens` budget (8192) that Gemini shouldn't truncate mid-JSON,
  but `parseModelJSON` in `src/lib/gemini.ts` will salvage a truncated
  array/object if it ever does happen.
- To go back to Claude instead of Gemini: replace the body of
  `callGemini()` in `src/lib/gemini.ts` with a call to
  `https://api.anthropic.com/v1/messages`, keeping the same function
  signature — nothing else in the app needs to change.
- This is a single-user tool as scoped in the PRD. Multi-author accounts
  (Phase 3 in the roadmap) would add Supabase Auth and a `role` column on
  `profiles`.
# Blogger-Automation
