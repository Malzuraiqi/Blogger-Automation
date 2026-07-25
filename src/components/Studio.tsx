"use client";

// FILE: src/components/Studio.tsx
// the whole app's UI: Labels/Strategy/Pipeline/Editor/Search views, the pipeline buttons, Advanced Settings (SEO + Blogger).


import { useEffect, useState, useCallback } from "react";
import type { Label, Idea, Article, ArticleSection, PipelineStatus } from "@/lib/types";

type View = "labels" | "strategy" | "pipeline" | "editor" | "search";
type EditorTab = "images" | "links";
type LoadingKey =
  | "ideas"
  | "article"
  | "images"
  | "captions"
  | "links-internal"
  | "links-external"
  | "html"
  | "publish"
  | "blogs"
  | "all";

type ArticleDraft = {
  title: string;
  subtitle: string;
  tldr: string;
  sections: ArticleSection[];
  conclusion: string;
};

type Health = { ok: boolean; missingRequired: string[]; missingOptional: string[] };

const STATUS_STYLES: Record<PipelineStatus, string> = {
  idea: "bg-ink-3 text-paper-dim",
  researching: "bg-ember-dim text-ember",
  drafting: "bg-spark-dim text-spark",
  editing: "bg-[#4A3A5B] text-[#C79EF2]",
  published: "bg-sage-dim text-sage",
};

async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request to ${url} failed`);
  return data;
}

// article_seo is a one-to-one embed (its primary key IS the article_id
// foreign key), so PostgREST/Supabase returns it as a single object, not
// an array — unlike article_images/article_links, which are genuinely
// one-to-many and do come back as arrays. This normalizes either shape so
// callers don't have to care which one Supabase decided to send.
function getArticleSeo(article: any) {
  const raw = article?.article_seo;
  if (!raw) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

function draftFromArticle(a: Article): ArticleDraft {
  return {
    title: a.title,
    subtitle: a.subtitle || "",
    tldr: a.tldr || "",
    sections: (a.sections || []).map((s) => ({ ...s })),
    conclusion: a.conclusion || "",
  };
}

function draftEquals(d: ArticleDraft, a: Article): boolean {
  return (
    d.title === a.title &&
    d.subtitle === (a.subtitle || "") &&
    d.tldr === (a.tldr || "") &&
    d.conclusion === (a.conclusion || "") &&
    JSON.stringify(d.sections) === JSON.stringify(a.sections || [])
  );
}

// Content counts as stale if it was edited (updated_at) any time after the
// last real "Generate Article" run (content_generated_at) — e.g. a manual
// edit, or a title change from re-promoting an idea. Purely informational;
// nothing is blocked by it.
function isStale(a: Article): boolean {
  if (!a.content_generated_at) return false;
  return new Date(a.updated_at).getTime() > new Date(a.content_generated_at).getTime();
}

export default function Studio() {
  const [view, setView] = useState<View>("labels");
  const [labels, setLabels] = useState<Label[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("images");
  const [loading, setLoading] = useState<LoadingKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newLabelName, setNewLabelName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [blogs, setBlogs] = useState<{ id: string; name: string; url: string }[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthDismissed, setHealthDismissed] = useState(false);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  const refreshAll = useCallback(async () => {
    const [l, i, a] = await Promise.all([api<Label[]>("/api/labels"), api<Idea[]>("/api/ideas"), api<Article[]>("/api/articles")]);
    setLabels(l);
    setIdeas(i);
    setArticles(a);
    if (!activeLabelId && l.length) setActiveLabelId(l[0].id);
  }, [activeLabelId]);

  useEffect(() => {
    refreshAll().catch((e) => setError(e.message));
    api<Health>("/api/health").then(setHealth).catch(() => {});
    // Surface the redirect result from /api/blogger/callback, if any.
    const params = new URLSearchParams(window.location.search);
    if (params.get("blogger_connected")) setCopyStatus("Google account connected.");
    if (params.get("blogger_error")) setError(`Blogger connection failed: ${params.get("blogger_error")}`);
    if (params.toString()) window.history.replaceState({}, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeLabel = labels.find((l) => l.id === activeLabelId) || labels[0];
  const activeArticle = articles.find((a) => a.id === activeArticleId) || articles[0];

  // Reset the editing draft whenever the selected article changes, or
  // whenever a fresh "Generate Article" run replaces the content
  // (content_generated_at moving forward). It intentionally does NOT reset
  // on every refreshAll() poll, so in-progress edits survive unrelated
  // background refreshes (e.g. after generating images).
  useEffect(() => {
    setDraft(activeArticle ? draftFromArticle(activeArticle) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArticle?.id, activeArticle?.content_generated_at]);

  async function addLabel() {
    if (!newLabelName.trim()) return;
    try {
      await api("/api/labels", { method: "POST", body: JSON.stringify({ name: newLabelName }) });
      setNewLabelName("");
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function generateIdeas(labelId: string) {
    setLoading("ideas");
    setError(null);
    try {
      await api("/api/generate/ideas", { method: "POST", body: JSON.stringify({ labelId }) });
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  async function deleteIdea(ideaId: string) {
    if (!window.confirm("Delete this idea? This can't be undone.")) return;
    try {
      await api(`/api/ideas?id=${ideaId}`, { method: "DELETE" });
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function deleteArticle(articleId: string) {
    if (!window.confirm("Delete this article and everything generated for it? This can't be undone.")) return;
    try {
      await api(`/api/articles?id=${articleId}`, { method: "DELETE" });
      if (activeArticleId === articleId) setActiveArticleId(null);
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function promoteToDraft(ideaId: string) {
    try {
      const article = await api<Article>("/api/articles", { method: "POST", body: JSON.stringify({ ideaId }) });
      await refreshAll();
      setActiveArticleId(article.id);
      setView("editor");
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Generic runner for the linear pipeline steps below: sets the loading
  // key, calls the endpoint, refreshes, and surfaces errors consistently.
  async function runStep(key: LoadingKey, url: string, body: any) {
    setLoading(key);
    setError(null);
    try {
      const result = await api(url, { method: "POST", body: JSON.stringify(body) });
      await refreshAll();
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(null);
    }
  }

  const generateArticle = (articleId: string) => runStep("article", "/api/generate/article", { articleId });

  // Unlike the other steps, "Generate Images" can succeed (200) while still
  // reporting per-image generation failures (e.g. no IMAGE_PROVIDER
  // configured, or the provider/ImgBB call failed) — those live in the
  // response body, not the HTTP status, so they need their own surfacing.
  async function generateImages(articleId: string) {
    setLoading("images");
    setError(null);
    try {
      const result = await api<{ provider: string | null; generationErrors: string[] }>("/api/generate/images", {
        method: "POST",
        body: JSON.stringify({ articleId }),
      });
      await refreshAll();
      if (!result.provider) {
        setError('Image plan generated, but no IMAGE_PROVIDER is configured — images will show as "IMAGE_URL_N" placeholders in the HTML until you set IMAGE_PROVIDER (and an API key) in .env.local.');
      } else if (result.generationErrors?.length) {
        setError(`Some images failed to generate: ${result.generationErrors.join(" | ")}`);
      } else {
        setCopyStatus("Images generated.");
        setTimeout(() => setCopyStatus(null), 3000);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  // Regenerates a single image in place (keeps its placement/caption/prompt,
  // only redoes the actual generation call). Doesn't touch the loading key
  // used by the full "Generate Images" step so both can be told apart.
  async function regenerateImage(imageId: string) {
    setError(null);
    try {
      await api("/api/generate/images/regenerate", { method: "POST", body: JSON.stringify({ imageId }) });
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const generateCaptions = (articleId: string) => runStep("captions", "/api/generate/captions", { articleId });
  const insertLinks = (articleId: string, type: "internal" | "external") =>
    runStep(type === "internal" ? "links-internal" : "links-external", "/api/generate/links", { articleId, type });
  const generateHtml = (articleId: string) => runStep("html", "/api/generate/html", { articleId });

  async function saveArticleEdits() {
    if (!activeArticle || !draft) return;
    try {
      await api("/api/articles", {
        method: "PATCH",
        body: JSON.stringify({
          id: activeArticle.id,
          title: draft.title,
          subtitle: draft.subtitle,
          tldr: draft.tldr,
          sections: draft.sections,
          conclusion: draft.conclusion,
        }),
      });
      await refreshAll();
      setCopyStatus("Changes saved.");
      setTimeout(() => setCopyStatus(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function discardArticleEdits() {
    if (activeArticle) setDraft(draftFromArticle(activeArticle));
  }

  // "Run Full Pipeline": chains every step in order, waiting for each to
  // finish before starting the next. Stops and surfaces the error if any
  // step fails. The individual step buttons still work on their own.
  // "Run Full Pipeline": chains every step in order. Each step is wrapped
  // individually — if one fails (or reports partial issues, like an image
  // that didn't generate), that's recorded as a warning and the run
  // continues to the next step rather than stopping cold and losing what
  // was already learned. Everything gathered is reported together at the
  // end, so you never lose an earlier warning just because a later step
  // also had a problem.
  async function runFullPipeline(articleId: string) {
    setLoading("all");
    setError(null);
    const warnings: string[] = [];

    async function step(label: string, fn: () => Promise<void>) {
      try {
        await fn();
      } catch (e: any) {
        warnings.push(`${label}: ${e.message}`);
      }
    }

    const current = articles.find((a) => a.id === articleId);
    if (!current?.sections?.length) {
      await step("Generate Article", async () => {
        await api("/api/generate/article", { method: "POST", body: JSON.stringify({ articleId }) });
        await refreshAll();
      });
    }

    await step("Generate Images", async () => {
      const result = await api<{ provider: string | null; generationErrors: string[] }>("/api/generate/images", {
        method: "POST",
        body: JSON.stringify({ articleId }),
      });
      if (!result.provider) {
        warnings.push('Generate Images: no IMAGE_PROVIDER configured — images are "IMAGE_URL_N" placeholders in the HTML.');
      } else if (result.generationErrors?.length) {
        warnings.push(`Generate Images: ${result.generationErrors.join(" | ")}`);
      }
      await refreshAll();
    });

    await step("Generate Captions", async () => {
      await api("/api/generate/captions", { method: "POST", body: JSON.stringify({ articleId }) });
      await refreshAll();
    });

    await step("Insert Internal Links", async () => {
      await api("/api/generate/links", { method: "POST", body: JSON.stringify({ articleId, type: "internal" }) });
    });

    await step("Insert External Links", async () => {
      await api("/api/generate/links", { method: "POST", body: JSON.stringify({ articleId, type: "external" }) });
      await refreshAll();
    });

    await step("Generate HTML", async () => {
      await api("/api/generate/html", { method: "POST", body: JSON.stringify({ articleId }) });
      await refreshAll();
    });

    if (warnings.length) {
      setError(`Pipeline finished with issues:\n${warnings.map((w) => `• ${w}`).join("\n")}`);
    } else {
      setCopyStatus("Full pipeline complete — ready to Copy for Blogger.");
      setTimeout(() => setCopyStatus(null), 4000);
    }
    setLoading(null);
  }

  async function setArticleStatus(id: string, status: PipelineStatus) {
    await api("/api/articles", { method: "PATCH", body: JSON.stringify({ id, status }) });
    await refreshAll();
  }

  async function copyForBlogger(article: any) {
    if (!article.html) {
      setError("Generate the HTML for this article first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(article.html);
      setCopyStatus("Copied! Paste directly into Blogger's HTML editor.");
      setTimeout(() => setCopyStatus(null), 4000);
    } catch {
      // Clipboard API can be blocked in some contexts — fall back to a
      // manual copy via a temporary textarea.
      const ta = document.createElement("textarea");
      ta.value = article.html;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopyStatus("Copied! Paste directly into Blogger's HTML editor.");
      setTimeout(() => setCopyStatus(null), 4000);
    }
  }

  function connectBlogger() {
    window.location.href = "/api/blogger/auth";
  }

  async function loadBlogs() {
    setLoading("blogs");
    setError(null);
    try {
      const list = await api<{ id: string; name: string; url: string }[]>("/api/blogger/blogs");
      setBlogs(list);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  async function selectBlog(blogId: string) {
    const blog = blogs.find((b) => b.id === blogId);
    try {
      await api("/api/blogger/blogs", { method: "POST", body: JSON.stringify({ blogId, blogUrl: blog?.url }) });
      setCopyStatus(`Publishing target set to ${blog?.name || blogId}.`);
      setTimeout(() => setCopyStatus(null), 4000);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function publishToBlogger(articleId: string, mode: "draft" | "publish") {
    setLoading("publish");
    setError(null);
    try {
      const result = await api<{ url: string }>("/api/blogger/publish", { method: "POST", body: JSON.stringify({ articleId, mode }) });
      await refreshAll();
      setCopyStatus(`Published: ${result.url}`);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  return (
    <div className="flex min-h-screen">
      <Rail view={view} setView={setView} labels={labels} ideas={ideas} articles={articles} />
      <main className="flex-1 min-w-0 px-10 py-9 pb-20 max-w-[1180px]">
        {health && !health.ok && !healthDismissed && (
          <div className="bg-ember-dim text-[#F0D8AE] border border-[#5B4526] rounded-lg px-4 py-3 text-[12.5px] mb-4">
            <div className="flex justify-between items-start gap-3">
              <div>
                <b>Missing required setup:</b> {health.missingRequired.join(", ")}. Add these to <code>.env.local</code> and restart the dev server.
              </div>
              <button className="text-paper-faint hover:text-paper shrink-0" onClick={() => setHealthDismissed(true)}>✕</button>
            </div>
          </div>
        )}
        {error && (
          <div className="bg-ember-dim text-[#F0D8AE] border border-[#5B4526] rounded-lg px-4 py-3 text-[12.5px] mb-4 whitespace-pre-line leading-relaxed">
            {error}
          </div>
        )}
        {copyStatus && (
          <div className="bg-sage-dim text-sage border border-[#33463A] rounded-lg px-4 py-3 text-[12.5px] mb-4">
            {copyStatus}
          </div>
        )}

        {view === "labels" && (
          <LabelsView
            labels={labels}
            articles={articles}
            ideas={ideas}
            newLabelName={newLabelName}
            setNewLabelName={setNewLabelName}
            addLabel={addLabel}
            onSelect={(id: string) => {
              setActiveLabelId(id);
              setView("strategy");
            }}
          />
        )}

        {view === "strategy" && activeLabel && (
          <StrategyView
            label={activeLabel}
            labels={labels}
            ideas={ideas.filter((i) => i.label_id === activeLabel.id)}
            loading={loading === "ideas"}
            onSwitchLabel={setActiveLabelId}
            onGenerate={() => generateIdeas(activeLabel.id)}
            onPromote={promoteToDraft}
            onDelete={deleteIdea}
          />
        )}

        {view === "pipeline" && (
          <PipelineView
            ideas={ideas}
            articles={articles}
            labels={labels}
            onOpenArticle={(id: string) => {
              setActiveArticleId(id);
              setView("editor");
            }}
            onOpenIdea={(idea: Idea) => {
              setActiveLabelId(idea.label_id);
              setView("strategy");
            }}
          />
        )}

        {view === "editor" && activeArticle && draft && (
          <EditorView
            article={activeArticle}
            articles={articles}
            labels={labels}
            tab={editorTab}
            setTab={(t: EditorTab) => setEditorTab(t)}
            loading={loading}
            advancedOpen={advancedOpen}
            setAdvancedOpen={setAdvancedOpen}
            blogs={blogs}
            draft={draft}
            setDraft={setDraft}
            isDirty={!draftEquals(draft, activeArticle)}
            onSwitchArticle={(id: string) => setActiveArticleId(id)}
            onStatusChange={(s: PipelineStatus) => setArticleStatus(activeArticle.id, s)}
            onGenerateArticle={() => generateArticle(activeArticle.id)}
            onGenerateImages={() => generateImages(activeArticle.id)}
            onRegenerateImage={regenerateImage}
            onGenerateCaptions={() => generateCaptions(activeArticle.id)}
            onInsertInternalLinks={() => insertLinks(activeArticle.id, "internal")}
            onInsertExternalLinks={() => insertLinks(activeArticle.id, "external")}
            onGenerateHtml={() => generateHtml(activeArticle.id)}
            onRunFullPipeline={() => runFullPipeline(activeArticle.id)}
            onCopyForBlogger={() => copyForBlogger(activeArticle)}
            onConnectBlogger={connectBlogger}
            onLoadBlogs={loadBlogs}
            onSelectBlog={selectBlog}
            onPublish={(mode: "draft" | "publish") => publishToBlogger(activeArticle.id, mode)}
            onSaveEdits={saveArticleEdits}
            onDiscardEdits={discardArticleEdits}
            onDeleteArticle={() => deleteArticle(activeArticle.id)}
          />
        )}
        {view === "editor" && !activeArticle && (
          <div className="empty-state">No article selected. Draft one from Content strategy first.</div>
        )}

        {view === "search" && (
          <SearchView
            articles={articles}
            labels={labels}
            query={search}
            setQuery={setSearch}
            onOpen={(id: string) => {
              setActiveArticleId(id);
              setView("editor");
            }}
            onDelete={deleteArticle}
          />
        )}
      </main>
    </div>
  );
}

function Rail({ view, setView, labels, ideas, articles }: any) {
  const items: { id: View; label: string; count: number | null }[] = [
    { id: "labels", label: "Labels", count: labels.length },
    { id: "strategy", label: "Content strategy", count: ideas.filter((i: Idea) => i.status === "idea").length },
    { id: "pipeline", label: "Pipeline", count: ideas.length },
    { id: "editor", label: "Editor", count: articles.length },
    { id: "search", label: "Search", count: null },
  ];
  return (
    <div className="w-[220px] shrink-0 bg-ink-2 border-r border-border px-3.5 py-6 sticky top-0 h-screen">
      <div className="flex items-center gap-2.5 px-2 pb-5 border-b border-border mb-4">
        <div className="w-6 h-6 shrink-0">
          <svg viewBox="0 0 26 26" fill="none">
            <circle cx="6" cy="6" r="3" fill="#7C8CFF" />
            <circle cx="20" cy="7" r="2.2" fill="#F2A541" />
            <circle cx="8" cy="20" r="2.2" fill="#8FB996" />
            <circle cx="19" cy="19" r="2.6" fill="#7C8CFF" />
            <path d="M6 6 L20 7 M6 6 L8 20 M20 7 L19 19 M8 20 L19 19" stroke="#3D4470" strokeWidth="1" />
          </svg>
        </div>
        <div>
          <div className="font-serif text-base font-semibold">Synapse Snaps</div>
          <div className="text-[10.5px] uppercase tracking-[1.2px] text-paper-faint">Studio</div>
        </div>
      </div>
      <nav>
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            className={`flex items-center gap-2.5 w-full text-left text-sm px-3 py-2.5 rounded-lg mb-0.5 transition-colors ${
              view === it.id ? "bg-spark-dim text-paper font-medium" : "text-paper-dim hover:bg-ink-3 hover:text-paper"
            }`}
          >
            <span>{it.label}</span>
            {it.count !== null && (
              <span className={`ml-auto text-[11px] font-mono ${view === it.id ? "text-spark" : "text-paper-faint"}`}>{it.count}</span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

function LabelsView({ labels, articles, ideas, newLabelName, setNewLabelName, addLabel, onSelect }: any) {
  return (
    <div>
      <ViewHead eyebrow="Publication" title="Labels" desc="Every label is its own thread of curiosity. Pick one to generate ideas, or start a new thread below." />
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))" }}>
        {labels.map((l: Label) => {
          const published = articles.filter((a: Article) => a.label_id === l.id && a.status === "published").length;
          const inProgress = articles.filter((a: Article) => a.label_id === l.id && a.status !== "published").length;
          const ideaCount = ideas.filter((i: Idea) => i.label_id === l.id && i.status === "idea").length;
          return (
            <div key={l.id} className="card cursor-pointer hover:border-spark transition-colors" onClick={() => onSelect(l.id)}>
              <h3 className="font-serif text-[17px] mb-1">{l.name}</h3>
              <div className="text-[12.5px] text-paper-dim leading-relaxed">{l.description || "No description yet."}</div>
              <div className="flex gap-3.5 mt-3 text-xs text-paper-faint">
                <span><b className="text-paper font-semibold">{published}</b> published</span>
                <span><b className="text-paper font-semibold">{inProgress}</b> in progress</span>
                <span><b className="text-paper font-semibold">{ideaCount}</b> ideas</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2.5 mt-5 max-w-[420px]">
        <input
          type="text"
          value={newLabelName}
          onChange={(e) => setNewLabelName(e.target.value)}
          placeholder="New label, e.g. Language"
          className="bg-ink-3 border border-border rounded-lg px-3 py-2 text-[13.5px] w-full focus:outline-none focus:border-spark"
        />
        <button className="btn btn-spark" onClick={addLabel}>Add label</button>
      </div>
    </div>
  );
}

function StrategyView({ label, labels, ideas, loading, onSwitchLabel, onGenerate, onPromote, onDelete }: any) {
  const sorted = [...ideas].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return (
    <div>
      <ViewHead eyebrow="Step 1 - content strategy" title={label.name} desc={label.description} />
      <div className="flex gap-2.5 items-center mb-5 flex-wrap">
        <select
          value={label.id}
          onChange={(e) => onSwitchLabel(e.target.value)}
          className="bg-ink-3 border border-border rounded-lg px-3 py-2 text-[13.5px]"
        >
          {labels.map((l: Label) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button className="btn btn-spark" disabled={loading} onClick={onGenerate}>Generate ideas</button>
      </div>
      {loading && <Loading text={`Sketching ideas that build on what's already published in ${label.name}...`} />}
      {!sorted.length && !loading && <EmptyState text="No ideas yet for this label. Generate a first batch." />}
      {sorted.map((idea: Idea) => (
        <div key={idea.id} className="card mb-3">
          <div className="flex justify-between items-start gap-3.5">
            <div className="flex-1">
              <div className="font-serif text-[15.5px] font-semibold mb-1">{idea.title}</div>
              <p className="text-paper-dim text-[13px] mb-2 leading-relaxed">{idea.main_question}</p>
            </div>
            <div className="font-mono text-xs text-ember bg-ember-dim rounded-md px-2 py-1 shrink-0">rank {idea.rank}</div>
          </div>
          <div className="text-[12.5px] text-paper-dim italic mb-1">{idea.hook_reason}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(idea.seo_keywords || []).map((k) => <span key={k} className="tag">{k}</span>)}
            {idea.series_position && <span className="tag text-spark border-spark-dim bg-spark-dim">{idea.series_position}</span>}
            <span className="tag">curiosity {idea.curiosity_score}/10</span>
            <span className="tag">seo {idea.seo_score}/10</span>
            <span className={`status-pill ${STATUS_STYLES[idea.status]}`}>{idea.status}</span>
          </div>
          <div className="mt-3 flex gap-2">
            {idea.status === "idea" ? (
              <button className="btn btn-spark" style={{ padding: "5px 11px", fontSize: 12, borderRadius: 6 }} onClick={() => onPromote(idea.id)}>
                Draft this article
              </button>
            ) : (
              <button className="btn btn-ghost" style={{ padding: "5px 11px", fontSize: 12, borderRadius: 6 }} onClick={() => onPromote(idea.id)}>
                Open in editor
              </button>
            )}
            <button
              className="btn btn-ghost text-danger border-danger/40 hover:border-danger"
              style={{ padding: "5px 11px", fontSize: 12, borderRadius: 6 }}
              onClick={() => onDelete(idea.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PipelineView({ ideas, articles, labels, onOpenArticle, onOpenIdea }: any) {
  const columns: PipelineStatus[] = ["idea", "researching", "drafting", "editing", "published"];
  return (
    <div>
      <ViewHead eyebrow="Workflow" title="Pipeline" desc="Everything moves left to right. Click a card to jump into it." />
      <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {columns.map((col) => {
          const ideaCards = ideas.filter((i: Idea) => i.status === col && !articles.find((a: Article) => a.idea_id === i.id));
          const articleCards = articles.filter((a: Article) => a.status === col);
          return (
            <div key={col} className="bg-ink-2 border border-border rounded-[10px] p-3 min-h-[120px]">
              <div className="text-[11.5px] uppercase tracking-wider text-paper-faint font-semibold mb-2.5 flex justify-between">
                <span>{col}</span><span>{ideaCards.length + articleCards.length}</span>
              </div>
              {ideaCards.map((c: Idea) => (
                <div key={c.id} className="bg-ink-3 border border-border rounded-lg px-2.5 py-2 mb-2 text-[12.5px] cursor-pointer hover:border-spark" onClick={() => onOpenIdea(c)}>
                  <div className="font-semibold leading-snug mb-1">{c.title}</div>
                  <div className="text-paper-faint text-[11px]">{labels.find((l: Label) => l.id === c.label_id)?.name}</div>
                </div>
              ))}
              {articleCards.map((c: Article) => (
                <div key={c.id} className="bg-ink-3 border border-border rounded-lg px-2.5 py-2 mb-2 text-[12.5px] cursor-pointer hover:border-spark" onClick={() => onOpenArticle(c.id)}>
                  <div className="font-semibold leading-snug mb-1">{c.title}</div>
                  <div className="text-paper-faint text-[11px]">{labels.find((l: Label) => l.id === c.label_id)?.name}</div>
                </div>
              ))}
              {!ideaCards.length && !articleCards.length && <div className="text-[11.5px] text-paper-faint px-0.5 py-1.5">Empty</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The linear "one click to publish" pipeline. Each step is a numbered pill
// button; steps become available once their prerequisite has run, so the
// person is guided left-to-right instead of hunting for the right tab.
function PipelineSteps({ article, loading, onGenerateArticle, onGenerateImages, onGenerateCaptions, onInsertInternalLinks, onInsertExternalLinks, onGenerateHtml, onCopyForBlogger, onRunFullPipeline }: any) {
  const hasContent = !!article.sections?.length;
  const steps = [
    { key: "article", label: "Generate Article", done: hasContent, ready: true, onClick: onGenerateArticle, loadingKey: "article" },
    { key: "images", label: "Generate Images", done: false, ready: hasContent, onClick: onGenerateImages, loadingKey: "images" },
    { key: "captions", label: "Generate Captions", done: false, ready: hasContent, onClick: onGenerateCaptions, loadingKey: "captions" },
    { key: "internal", label: "Insert Internal Links", done: false, ready: hasContent, onClick: onInsertInternalLinks, loadingKey: "links-internal" },
    { key: "external", label: "Insert External Links", done: false, ready: hasContent, onClick: onInsertExternalLinks, loadingKey: "links-external" },
    { key: "html", label: "Generate HTML", done: !!article.html, ready: hasContent, onClick: onGenerateHtml, loadingKey: "html" },
    { key: "copy", label: "Copy for Blogger", done: false, ready: !!article.html, onClick: onCopyForBlogger, loadingKey: null },
  ];
  const anyRunning = loading === "all";
  return (
    <div className="mb-6">
      <button
        disabled={!!loading}
        onClick={onRunFullPipeline}
        className="btn btn-spark mb-2.5"
        style={{ fontSize: 12.5, padding: "8px 14px" }}
      >
        {anyRunning ? "Running full pipeline..." : "▶ Run Full Pipeline"}
      </button>
      <div className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <button
            key={s.key}
            disabled={!s.ready || anyRunning || (s.loadingKey ? loading === s.loadingKey : false)}
            onClick={s.onClick}
            className={`btn ${s.key === "copy" ? "btn-spark" : "btn-ghost"}`}
            style={{ fontSize: 12, padding: "6px 12px" }}
            title={s.ready ? "" : "Complete the previous step first"}
          >
            <span className="font-mono text-[10px] opacity-60">{i + 1}</span>
            {s.loadingKey && loading === s.loadingKey ? "Working..." : s.label}
            {s.done && s.key !== "copy" ? " ✓" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditorView({
  article,
  articles,
  labels,
  tab,
  setTab,
  loading,
  advancedOpen,
  setAdvancedOpen,
  blogs,
  draft,
  setDraft,
  isDirty,
  onSwitchArticle,
  onStatusChange,
  onGenerateArticle,
  onGenerateImages,
  onRegenerateImage,
  onGenerateCaptions,
  onInsertInternalLinks,
  onInsertExternalLinks,
  onGenerateHtml,
  onCopyForBlogger,
  onRunFullPipeline,
  onConnectBlogger,
  onLoadBlogs,
  onSelectBlog,
  onPublish,
  onSaveEdits,
  onDiscardEdits,
  onDeleteArticle,
}: any) {
  const label = labels.find((l: Label) => l.id === article.label_id);
  const hasContent = article.sections && article.sections.length;
  const seo = getArticleSeo(article);
  const images = article.article_images || [];
  const links = article.article_links || [];
  const stale = isStale(article);

  function updateSection(i: number, field: "heading" | "body", value: string) {
    const next = draft.sections.map((s: ArticleSection, idx: number) => (idx === i ? { ...s, [field]: value } : s));
    setDraft({ ...draft, sections: next });
  }

  return (
    <div>
      <ViewHead eyebrow="Article pipeline" title={article.title} desc="" />
      <div className="flex gap-2.5 items-center mb-5 flex-wrap -mt-2">
        <span className={`status-pill ${STATUS_STYLES[article.status as PipelineStatus]}`}>{article.status}</span>
        {label && <span className="tag">{label.name}</span>}
        {!!article.reading_time_minutes && <span className="tag font-mono">Estimated reading time: {article.reading_time_minutes} minutes</span>}
        {article.published_url && (
          <a href={article.published_url} target="_blank" rel="noreferrer" className="tag text-spark">
            View published post ↗
          </a>
        )}
        <select
          value={article.id}
          onChange={(e) => onSwitchArticle(e.target.value)}
          className="bg-ink-3 border border-border rounded-lg px-3 py-2 text-[13.5px] ml-auto max-w-[220px]"
        >
          {articles.map((a: Article) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
        <select
          value={article.status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="bg-ink-3 border border-border rounded-lg px-3 py-2 text-[13.5px]"
        >
          {["idea", "researching", "drafting", "editing", "published"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button
          className="btn btn-ghost text-danger border-danger/40 hover:border-danger"
          style={{ fontSize: 12, padding: "6px 12px" }}
          onClick={onDeleteArticle}
        >
          Delete article
        </button>
      </div>

      {stale && (
        <div className="bg-[#3A3320] border border-[#5B4526] text-[#F0D8AE] rounded-lg px-3.5 py-2.5 text-[12.5px] mb-4">
          This article was edited after it was last generated — downstream steps (images, links, HTML) were built from the older content. Regenerate HTML if you want the published output to reflect your edits.
        </div>
      )}

      {!hasContent ? (
        <>
          <button className="btn btn-spark" disabled={!!loading} onClick={onGenerateArticle}>Generate Article</button>
          {loading === "article" && <Loading text="Writing the draft in the Synapse Snaps voice..." />}
        </>
      ) : (
        <>
          <PipelineSteps
            article={article}
            loading={loading}
            onGenerateArticle={onGenerateArticle}
            onGenerateImages={onGenerateImages}
            onGenerateCaptions={onGenerateCaptions}
            onInsertInternalLinks={onInsertInternalLinks}
            onInsertExternalLinks={onInsertExternalLinks}
            onGenerateHtml={onGenerateHtml}
            onCopyForBlogger={onCopyForBlogger}
            onRunFullPipeline={onRunFullPipeline}
          />

          <div className="grid gap-5.5" style={{ gridTemplateColumns: "1fr 320px" }}>
            <div className="bg-ink-2 border border-border rounded-[10px] px-8 py-7">
              <div className="flex justify-between items-start gap-3 mb-2">
                <div className="text-[10.5px] uppercase tracking-wide text-paper-faint">Editable content</div>
                {isDirty && (
                  <div className="flex gap-2 shrink-0">
                    <button className="btn btn-ghost" style={{ fontSize: 11.5, padding: "4px 10px" }} onClick={onDiscardEdits}>
                      Discard
                    </button>
                    <button className="btn btn-spark" style={{ fontSize: 11.5, padding: "4px 10px" }} onClick={onSaveEdits}>
                      Save changes
                    </button>
                  </div>
                )}
              </div>

              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="font-serif text-[26px] mb-2 bg-transparent border-b border-transparent hover:border-border focus:border-spark focus:outline-none w-full"
              />
              <input
                value={draft.subtitle}
                onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
                placeholder="Subtitle"
                className="text-paper-dim text-sm -mt-1 mb-4 bg-transparent border-b border-transparent hover:border-border focus:border-spark focus:outline-none w-full"
              />
              <div className="bg-spark-dim border-l-[3px] border-spark px-3.5 py-2.5 rounded-r-md text-[13.5px] mb-5">
                <b>TL;DR</b>{" "}
                <textarea
                  value={draft.tldr}
                  onChange={(e) => setDraft({ ...draft, tldr: e.target.value })}
                  rows={2}
                  className="bg-transparent w-full mt-1 focus:outline-none resize-y"
                />
              </div>
              {draft.sections.map((s: ArticleSection, i: number) => (
                <div key={i}>
                  <input
                    value={s.heading}
                    onChange={(e) => updateSection(i, "heading", e.target.value)}
                    className="font-serif text-[19px] mt-6 mb-2 bg-transparent border-b border-transparent hover:border-border focus:border-spark focus:outline-none w-full"
                  />
                  <textarea
                    value={s.body}
                    onChange={(e) => updateSection(i, "body", e.target.value)}
                    rows={Math.max(3, Math.ceil(s.body.length / 90))}
                    className="leading-[1.75] text-[14.5px] text-[#DCDAD1] mb-3.5 bg-transparent w-full focus:outline-none resize-y"
                  />
                </div>
              ))}
              <div className="border-t border-border mt-6 pt-4.5">
                <h2 className="font-serif text-[19px] mb-2">Wrapping up</h2>
                <textarea
                  value={draft.conclusion}
                  onChange={(e) => setDraft({ ...draft, conclusion: e.target.value })}
                  rows={3}
                  className="leading-[1.75] text-[14.5px] text-[#DCDAD1] bg-transparent w-full focus:outline-none resize-y"
                />
              </div>
              {article.banned_word_hits?.length ? (
                <div className="bg-ember-dim border border-[#5B4526] rounded-lg px-3.5 py-2.5 text-[12.5px] text-[#F0D8AE] mt-5">
                  Style check flagged: {article.banned_word_hits.map((h: any) => `${h.word} (${h.count}x)`).join(", ")}
                </div>
              ) : (
                <div className="bg-ink-3 border border-border rounded-lg px-3.5 py-2.5 text-[12.5px] text-paper-dim mt-5">
                  Style check passed. Word count: {article.word_count}.
                </div>
              )}

              {article.html && (
                <div className="mt-5">
                  <div className="text-[10.5px] uppercase tracking-wide text-paper-faint mb-1.5">Generated HTML (preview)</div>
                  <pre className="bg-ink-3 border border-border rounded-lg px-3.5 py-3 text-[11.5px] font-mono text-paper-dim overflow-auto max-h-[220px] whitespace-pre-wrap">
                    {article.html}
                  </pre>
                </div>
              )}

              <div className="flex gap-2.5 mt-5">
                <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 11px" }} disabled={!!loading} onClick={onGenerateArticle}>
                  Regenerate draft
                </button>
              </div>
            </div>

            <div>
              <div className="flex gap-1 mb-3 flex-wrap">
                {(["images", "links"] as EditorTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 text-center text-[11.5px] px-1 py-1.5 rounded-md border ${tab === t ? "bg-spark-dim text-spark border-spark-dim" : "bg-ink-3 text-paper-dim border-border"}`}
                  >
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="bg-ink-2 border border-border rounded-[10px] p-4 text-[12.5px]">
                {tab === "images" &&
                  (images.length ? (
                    images.map((img: any) => (
                      <div key={img.id} className="bg-ink-3 border border-border rounded-lg px-3 py-2.5 mb-2">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <div className="text-ember text-[11px] font-mono">{img.is_featured ? "FEATURED IMAGE" : `Placement: ${img.placement}`}</div>
                          <button
                            className="text-[10.5px] text-spark hover:underline shrink-0"
                            disabled={loading === "images"}
                            onClick={() => onRegenerateImage(img.id)}
                          >
                            Regenerate
                          </button>
                        </div>
                        {img.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={img.image_url} alt={img.caption || ""} className="rounded-md mb-2 max-h-[140px] object-cover w-full" />
                        ) : (
                          <div className="text-paper-faint text-[11px] mb-2 italic">No image generated yet — will be a placeholder in the HTML.</div>
                        )}
                        <div className="mb-1">{img.caption}</div>
                        <div className="text-paper-faint text-[11px]">{img.prompt}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-paper-faint">Run "Generate Images" to plan and create images.</p>
                  ))}
                {tab === "links" && (
                  <div>
                    <LinkGroup title="Internal - past articles" items={links.filter((l: any) => l.link_type === "internal_past")} />
                    <LinkGroup title="Internal - future ideas" items={links.filter((l: any) => l.link_type === "internal_future")} />
                    <LinkGroup title="External sources" items={links.filter((l: any) => l.link_type === "external")} showCategory />
                    {!links.length && <p className="text-paper-faint">Run "Insert Internal Links" and "Insert External Links" to populate this.</p>}
                  </div>
                )}
              </div>

              <AdvancedSettings
                article={article}
                seo={seo}
                open={advancedOpen}
                setOpen={setAdvancedOpen}
                blogs={blogs}
                loading={loading}
                onConnectBlogger={onConnectBlogger}
                onLoadBlogs={onLoadBlogs}
                onSelectBlog={onSelectBlog}
                onPublish={onPublish}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// SEO is generated automatically alongside images/links (folded into the
// image + link generation steps' prompts server-side is out of scope here —
// SEO is still generated via the existing article_seo table) but per the
// updated requirements it should stay out of the way rather than living in
// a prominent tab. Blogger connection/publishing lives here too since it's
// a one-time setup step, not part of the every-article pipeline.
function AdvancedSettings({ article, seo, open, setOpen, blogs, loading, onConnectBlogger, onLoadBlogs, onSelectBlog, onPublish }: any) {
  return (
    <div className="mt-3.5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left text-[11.5px] uppercase tracking-wide text-paper-faint px-1 py-2 flex items-center justify-between"
      >
        <span>Advanced settings</span>
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="bg-ink-2 border border-border rounded-[10px] p-4 text-[12.5px] space-y-4">
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-paper-faint mb-2">SEO</div>
            {seo ? (
              <>
                <Kv k="Primary keyword" v={seo.primary_keyword} />
                <Kv k="Secondary keywords" v={(seo.secondary_keywords || []).join(", ")} />
                <Kv k="SEO title" v={seo.seo_title} />
                <Kv k="Meta description" v={seo.meta_description} />
              </>
            ) : (
              <p className="text-paper-faint">SEO metadata is generated automatically once you run the pipeline.</p>
            )}
          </div>

          <div className="border-t border-border pt-3.5">
            <div className="text-[10.5px] uppercase tracking-wide text-paper-faint mb-2">Blogger</div>
            <div className="flex flex-col gap-2">
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onConnectBlogger}>Connect Google account</button>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={loading === "blogs"} onClick={onLoadBlogs}>
                {loading === "blogs" ? "Loading blogs..." : "Load my blogs"}
              </button>
              {!!blogs.length && (
                <select
                  onChange={(e) => onSelectBlog(e.target.value)}
                  className="bg-ink-3 border border-border rounded-lg px-3 py-2 text-[13px]"
                  defaultValue=""
                >
                  <option value="" disabled>Choose a blog to publish to...</option>
                  {blogs.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-2 mt-1">
                <button className="btn btn-ghost" style={{ fontSize: 12 }} disabled={!article.html || loading === "publish"} onClick={() => onPublish("draft")}>
                  Save draft on Blogger
                </button>
                <button className="btn btn-spark" style={{ fontSize: 12 }} disabled={!article.html || loading === "publish"} onClick={() => onPublish("publish")}>
                  {loading === "publish" ? "Publishing..." : "Publish to Blogger"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkGroup({ title, items, showCategory }: any) {
  return (
    <div className="mb-3">
      <div className="text-[10.5px] uppercase tracking-wide text-paper-faint mb-1">{title}</div>
      {items.length ? items.map((l: any) => (
        <div key={l.id} className="border-b border-border py-2 text-xs last:border-b-0">
          <b>{l.target_title}</b> {showCategory && l.category && <span className="tag ml-1">{l.category}</span>}
          <br /><span className="text-paper-faint">{l.placement_note}</span>
        </div>
      )) : <div className="text-paper-faint py-2 text-xs">None</div>}
    </div>
  );
}

function SearchView({ articles, labels, query, setQuery, onOpen, onDelete }: any) {
  const q = query.toLowerCase();
  const results = articles.filter((a: Article) => !q || a.title.toLowerCase().includes(q) || (a.tldr || "").toLowerCase().includes(q));
  return (
    <div>
      <ViewHead eyebrow="Find" title="Search articles" desc="" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title or summary..."
        className="bg-ink-3 border border-border rounded-lg px-3 py-2 text-[13.5px] max-w-[420px] w-full mb-5 focus:outline-none focus:border-spark"
      />
      {results.map((a: Article) => {
        const label = labels.find((l: Label) => l.id === a.label_id);
        return (
          <div key={a.id} className="card mb-3">
            <div className="flex justify-between">
              <div className="font-serif text-[15.5px] font-semibold cursor-pointer" onClick={() => onOpen(a.id)}>{a.title}</div>
              <span className={`status-pill ${STATUS_STYLES[a.status]}`}>{a.status}</span>
            </div>
            <div className="text-paper-dim text-[13px] mt-1 cursor-pointer" onClick={() => onOpen(a.id)}>{a.tldr || "No summary yet."}</div>
            <div className="flex gap-1.5 mt-2 items-center">
              {label && <span className="tag">{label.name}</span>}
              {!!a.reading_time_minutes && <span className="tag font-mono">{a.reading_time_minutes} min read</span>}
              <button
                className="ml-auto text-[11px] text-danger hover:underline"
                onClick={() => onDelete(a.id)}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
      {!results.length && <EmptyState text={`No articles match "${query}".`} />}
    </div>
  );
}

function ViewHead({ eyebrow, title, desc }: { eyebrow: string; title: string; desc?: string | null }) {
  return (
    <div className="mb-6">
      <div className="text-[11px] tracking-[1.6px] uppercase text-spark font-semibold mb-1.5">{eyebrow}</div>
      <h1 className="font-serif text-[28px] font-medium mb-1.5">{title}</h1>
      {desc && <p className="text-paper-dim text-[14.5px] max-w-[640px] leading-relaxed">{desc}</p>}
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2.5 text-spark text-[13px] py-4">
      <div className="w-3.5 h-3.5 rounded-full border-2 border-spark-dim border-t-spark animate-spin" />
      {text}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="border border-dashed border-border rounded-[10px] px-7 py-9 text-center text-paper-faint">{text}</div>;
}

function Kv({ k, v }: { k: string; v: any }) {
  return (
    <div className="mb-3">
      <div className="text-[10.5px] uppercase tracking-wide text-paper-faint mb-0.5">{k}</div>
      <div className="text-paper leading-snug">{v}</div>
    </div>
  );
}