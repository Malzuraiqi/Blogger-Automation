"use client";

// FILE: src/components/Studio.tsx
// the whole app's UI: Labels/Strategy/Pipeline/Editor/Search views, the pipeline buttons, Advanced Settings (SEO + Blogger).

import { useEffect, useState, useCallback } from "react";
import type {
  Label,
  Idea,
  Article,
  ArticleSection,
  PipelineStatus,
} from "@/lib/types";

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

type Health = {
  ok: boolean;
  missingRequired: string[];
  missingOptional: string[];
};

// Status pill class mapping — muted, desaturated, no heavy fills
const STATUS_STYLES: Record<PipelineStatus, string> = {
  idea: "status-idea",
  researching: "status-researching",
  drafting: "status-drafting",
  editing: "status-editing",
  published: "status-published",
};

async function api<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
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
  return (
    new Date(a.updated_at).getTime() >
    new Date(a.content_generated_at).getTime()
  );
}

// ─── Theme toggle ──────────────────────────────────────────────────────────
function useTheme() {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("ss-theme");
    const dark = stored !== "light";
    setIsDark(dark);
    document.documentElement.classList.toggle("light", !dark);
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("light", !next);
    localStorage.setItem("ss-theme", next ? "dark" : "light");
  }

  return { isDark, toggle };
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
  const [blogs, setBlogs] = useState<
    { id: string; name: string; url: string }[]
  >([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthDismissed, setHealthDismissed] = useState(false);
  const [draft, setDraft] = useState<ArticleDraft | null>(null);

  const refreshAll = useCallback(async () => {
    const [l, i, a] = await Promise.all([
      api<Label[]>("/api/labels"),
      api<Idea[]>("/api/ideas"),
      api<Article[]>("/api/articles"),
    ]);
    setLabels(l);
    setIdeas(i);
    setArticles(a);
    if (!activeLabelId && l.length) setActiveLabelId(l[0].id);
  }, [activeLabelId]);

  useEffect(() => {
    refreshAll().catch((e) => setError(e.message));
    api<Health>("/api/health")
      .then(setHealth)
      .catch(() => {});
    // Surface the redirect result from /api/blogger/callback, if any.
    const params = new URLSearchParams(window.location.search);
    if (params.get("blogger_connected"))
      setCopyStatus("Google account connected.");
    if (params.get("blogger_error"))
      setError(`Blogger connection failed: ${params.get("blogger_error")}`);
    if (params.toString())
      window.history.replaceState({}, "", window.location.pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeLabel = labels.find((l) => l.id === activeLabelId) || labels[0];
  const activeArticle =
    articles.find((a) => a.id === activeArticleId) || articles[0];

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
      await api("/api/labels", {
        method: "POST",
        body: JSON.stringify({ name: newLabelName }),
      });
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
      await api("/api/generate/ideas", {
        method: "POST",
        body: JSON.stringify({ labelId }),
      });
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
    if (
      !window.confirm(
        "Delete this article and everything generated for it? This can't be undone.",
      )
    )
      return;
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
      const article = await api<Article>("/api/articles", {
        method: "POST",
        body: JSON.stringify({ ideaId }),
      });
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
      const result = await api(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refreshAll();
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(null);
    }
  }

  const generateArticle = (articleId: string) =>
    runStep("article", "/api/generate/article", { articleId });

  // Unlike the other steps, "Generate Images" can succeed (200) while still
  // reporting per-image generation failures (e.g. no IMAGE_PROVIDER
  // configured, or the provider/ImgBB call failed) — those live in the
  // response body, not the HTTP status, so they need their own surfacing.
  async function generateImages(articleId: string) {
    setLoading("images");
    setError(null);
    try {
      const result = await api<{
        provider: string | null;
        generationErrors: string[];
      }>("/api/generate/images", {
        method: "POST",
        body: JSON.stringify({ articleId }),
      });
      await refreshAll();
      if (!result.provider) {
        setError(
          'Image plan generated, but no IMAGE_PROVIDER is configured — images will show as "IMAGE_URL_N" placeholders in the HTML until you set IMAGE_PROVIDER (and an API key) in .env.local.',
        );
      } else if (result.generationErrors?.length) {
        setError(
          `Some images failed to generate: ${result.generationErrors.join(" | ")}`,
        );
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
      await api("/api/generate/images/regenerate", {
        method: "POST",
        body: JSON.stringify({ imageId }),
      });
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const generateCaptions = (articleId: string) =>
    runStep("captions", "/api/generate/captions", { articleId });
  const insertLinks = (articleId: string, type: "internal" | "external") =>
    runStep(
      type === "internal" ? "links-internal" : "links-external",
      "/api/generate/links",
      { articleId, type },
    );
  const generateHtml = (articleId: string) =>
    runStep("html", "/api/generate/html", { articleId });

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
        await api("/api/generate/article", {
          method: "POST",
          body: JSON.stringify({ articleId }),
        });
        await refreshAll();
      });
    }

    await step("Generate Images", async () => {
      const result = await api<{
        provider: string | null;
        generationErrors: string[];
      }>("/api/generate/images", {
        method: "POST",
        body: JSON.stringify({ articleId }),
      });
      if (!result.provider) {
        warnings.push(
          'Generate Images: no IMAGE_PROVIDER configured — images are "IMAGE_URL_N" placeholders in the HTML.',
        );
      } else if (result.generationErrors?.length) {
        warnings.push(
          `Generate Images: ${result.generationErrors.join(" | ")}`,
        );
      }
      await refreshAll();
    });

    await step("Generate Captions", async () => {
      await api("/api/generate/captions", {
        method: "POST",
        body: JSON.stringify({ articleId }),
      });
      await refreshAll();
    });

    await step("Insert Internal Links", async () => {
      await api("/api/generate/links", {
        method: "POST",
        body: JSON.stringify({ articleId, type: "internal" }),
      });
    });

    await step("Insert External Links", async () => {
      await api("/api/generate/links", {
        method: "POST",
        body: JSON.stringify({ articleId, type: "external" }),
      });
      await refreshAll();
    });

    await step("Generate HTML", async () => {
      await api("/api/generate/html", {
        method: "POST",
        body: JSON.stringify({ articleId }),
      });
      await refreshAll();
    });

    if (warnings.length) {
      setError(
        `Pipeline finished with issues:\n${warnings.map((w) => `• ${w}`).join("\n")}`,
      );
    } else {
      setCopyStatus("Full pipeline complete — ready to Copy for Blogger.");
      setTimeout(() => setCopyStatus(null), 4000);
    }
    setLoading(null);
  }

  async function setArticleStatus(id: string, status: PipelineStatus) {
    await api("/api/articles", {
      method: "PATCH",
      body: JSON.stringify({ id, status }),
    });
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
      const list =
        await api<{ id: string; name: string; url: string }[]>(
          "/api/blogger/blogs",
        );
      setBlogs(list);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  async function selectBlog(blogId: string) {
    const blog = blogs.find((b) => b.id === blogId);
    try {
      await api("/api/blogger/blogs", {
        method: "POST",
        body: JSON.stringify({ blogId, blogUrl: blog?.url }),
      });
      setCopyStatus(`Publishing target set to ${blog?.name || blogId}.`);
      setTimeout(() => setCopyStatus(null), 4000);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function publishToBlogger(
    articleId: string,
    mode: "draft" | "publish",
  ) {
    setLoading("publish");
    setError(null);
    try {
      const result = await api<{ url: string }>("/api/blogger/publish", {
        method: "POST",
        body: JSON.stringify({ articleId, mode }),
      });
      await refreshAll();
      setCopyStatus(`Published: ${result.url}`);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg-base)" }}>
      <Rail
        view={view}
        setView={setView}
        labels={labels}
        ideas={ideas}
        articles={articles}
      />
      <main
        className="flex-1 min-w-0 px-12 py-10 pb-24"
        style={{ maxWidth: "1180px" }}
      >
        {/* ── System notices ─────────────────────────────────────────── */}
        {health && !health.ok && !healthDismissed && (
          <Notice kind="warn" onDismiss={() => setHealthDismissed(true)}>
            <b>Missing required setup:</b> {health.missingRequired.join(", ")}.
            Add these to <code>.env.local</code> and restart the dev server.
          </Notice>
        )}
        {error && (
          <Notice kind="warn">
            <span className="whitespace-pre-line leading-relaxed">{error}</span>
          </Notice>
        )}
        {copyStatus && <Notice kind="ok">{copyStatus}</Notice>}

        {/* ── Views ──────────────────────────────────────────────────── */}
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
            onStatusChange={(s: PipelineStatus) =>
              setArticleStatus(activeArticle.id, s)
            }
            onGenerateArticle={() => generateArticle(activeArticle.id)}
            onGenerateImages={() => generateImages(activeArticle.id)}
            onRegenerateImage={regenerateImage}
            onGenerateCaptions={() => generateCaptions(activeArticle.id)}
            onInsertInternalLinks={() =>
              insertLinks(activeArticle.id, "internal")
            }
            onInsertExternalLinks={() =>
              insertLinks(activeArticle.id, "external")
            }
            onGenerateHtml={() => generateHtml(activeArticle.id)}
            onRunFullPipeline={() => runFullPipeline(activeArticle.id)}
            onCopyForBlogger={() => copyForBlogger(activeArticle)}
            onConnectBlogger={connectBlogger}
            onLoadBlogs={loadBlogs}
            onSelectBlog={selectBlog}
            onPublish={(mode: "draft" | "publish") =>
              publishToBlogger(activeArticle.id, mode)
            }
            onSaveEdits={saveArticleEdits}
            onDiscardEdits={discardArticleEdits}
            onDeleteArticle={() => deleteArticle(activeArticle.id)}
          />
        )}
        {view === "editor" && !activeArticle && (
          <div className="empty-state">
            No article selected. Draft one from Content strategy first.
          </div>
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

// ─── Notice banner ─────────────────────────────────────────────────────────
function Notice({
  kind,
  children,
  onDismiss,
}: {
  kind: "warn" | "ok";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const styles =
    kind === "warn"
      ? {
          background: "var(--ember-bg)",
          color: "var(--ember)",
          borderColor: "rgba(196,154,92,0.25)",
        }
      : {
          background: "var(--sage-bg)",
          color: "var(--sage)",
          borderColor: "rgba(122,158,130,0.25)",
        };

  return (
    <div
      className="flex justify-between items-start gap-3 px-4 py-3 rounded-lg text-xs mb-4 animate-fade-in"
      style={{ border: "1px solid", ...styles }}
    >
      <div className="leading-relaxed">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: "inherit" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Navigation Rail ───────────────────────────────────────────────────────
function Rail({ view, setView, labels, ideas, articles }: any) {
  const { isDark, toggle } = useTheme();

  const items: { id: View; label: string; count: number | null }[] = [
    { id: "labels", label: "Labels", count: labels.length },
    {
      id: "strategy",
      label: "Content strategy",
      count: ideas.filter((i: Idea) => i.status === "idea").length,
    },
    { id: "pipeline", label: "Pipeline", count: ideas.length },
    { id: "editor", label: "Editor", count: articles.length },
    { id: "search", label: "Search", count: null },
  ];

  return (
    <aside
      className="w-[210px] shrink-0 sticky top-0 h-screen flex flex-col px-4 py-7"
      style={{
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border-hair)",
      }}
    >
      {/* Wordmark */}
      <div
        className="px-2 pb-7"
        style={{ borderBottom: "1px solid var(--border-hair)" }}
      >
        <div className="flex items-center gap-2.5 mb-0.5">
          {/* Quiet glyph — four nodes connected by hairlines */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 26 26"
            fill="none"
            className="shrink-0 opacity-80"
          >
            <circle cx="6" cy="6" r="2.2" fill="var(--accent)" />
            <circle cx="20" cy="7" r="1.6" fill="var(--text-faint)" />
            <circle cx="8" cy="20" r="1.6" fill="var(--text-faint)" />
            <circle cx="19" cy="19" r="1.9" fill="var(--accent)" />
            <path
              d="M6 6 L20 7 M6 6 L8 20 M20 7 L19 19 M8 20 L19 19"
              stroke="var(--border-subtle)"
              strokeWidth="0.8"
            />
          </svg>
          <div>
            <div
              className="font-serif font-medium leading-none"
              style={{ fontSize: "15px", color: "var(--text-primary)" }}
            >
              Synapse Snaps
            </div>
            <div
              className="mt-0.5"
              style={{
                fontSize: "9px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-faint)",
              }}
            >
              Studio
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="mt-5 flex-1 space-y-0.5">
        {items.map((it) => {
          const active = view === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setView(it.id)}
              className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-md transition-all duration-200"
              style={{
                fontSize: "13px",
                fontWeight: active ? 500 : 400,
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                background: active ? "var(--bg-raised)" : "transparent",
                letterSpacing: "0.01em",
              }}
              onMouseEnter={(e) => {
                if (!active)
                  (e.currentTarget as HTMLElement).style.color =
                    "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                if (!active)
                  (e.currentTarget as HTMLElement).style.color =
                    "var(--text-secondary)";
              }}
            >
              {/* Active indicator — thin left accent line */}
              <span
                className="shrink-0 rounded-full transition-all duration-200"
                style={{
                  width: "2px",
                  height: "14px",
                  background: active ? "var(--accent)" : "transparent",
                }}
              />
              <span className="flex-1">{it.label}</span>
              {it.count !== null && (
                <span
                  className="font-mono ml-auto"
                  style={{
                    fontSize: "10px",
                    color: active ? "var(--accent)" : "var(--text-faint)",
                  }}
                >
                  {it.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Theme toggle — bottom of rail */}
      <div
        className="pt-5"
        style={{ borderTop: "1px solid var(--border-hair)" }}
      >
        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md transition-colors duration-200"
          style={{ fontSize: "11.5px", color: "var(--text-faint)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color =
              "var(--text-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
          }}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span style={{ fontSize: "13px" }}>{isDark ? "○" : "●"}</span>
          <span>{isDark ? "Light mode" : "Dark mode"}</span>
        </button>
      </div>
    </aside>
  );
}

// ─── Labels view ───────────────────────────────────────────────────────────
function LabelsView({
  labels,
  articles,
  ideas,
  newLabelName,
  setNewLabelName,
  addLabel,
  onSelect,
}: any) {
  return (
    <div>
      <ViewHead
        eyebrow="Publication"
        title="Labels"
        desc="Every label is its own thread of curiosity. Pick one to generate ideas, or start a new thread below."
      />
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}
      >
        {labels.map((l: Label) => {
          const published = articles.filter(
            (a: Article) => a.label_id === l.id && a.status === "published",
          ).length;
          const inProgress = articles.filter(
            (a: Article) => a.label_id === l.id && a.status !== "published",
          ).length;
          const ideaCount = ideas.filter(
            (i: Idea) => i.label_id === l.id && i.status === "idea",
          ).length;
          return (
            <div
              key={l.id}
              className="card cursor-pointer animate-fade-in"
              onClick={() => onSelect(l.id)}
              style={{ padding: "1.5rem 1.75rem" }}
            >
              <h3
                className="font-serif mb-2 leading-snug"
                style={{
                  fontSize: "18px",
                  fontWeight: 500,
                  color: "var(--text-primary)",
                }}
              >
                {l.name}
              </h3>
              <p
                style={{
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  lineHeight: "1.65",
                }}
              >
                {l.description || "No description yet."}
              </p>
              <div
                className="flex gap-5 mt-4 pt-4"
                style={{
                  borderTop: "1px solid var(--border-hair)",
                  fontSize: "11px",
                  color: "var(--text-faint)",
                }}
              >
                <span>
                  <b style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {published}
                  </b>{" "}
                  published
                </span>
                <span>
                  <b style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {inProgress}
                  </b>{" "}
                  in progress
                </span>
                <span>
                  <b style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {ideaCount}
                  </b>{" "}
                  ideas
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2.5 mt-8" style={{ maxWidth: "400px" }}>
        <input
          type="text"
          value={newLabelName}
          onChange={(e) => setNewLabelName(e.target.value)}
          placeholder="New label, e.g. Language"
          className="flex-1 px-3 py-2"
          style={{ fontSize: "13px" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") addLabel();
          }}
        />
        <button className="btn btn-spark" onClick={addLabel}>
          Add label
        </button>
      </div>
    </div>
  );
}

// ─── Strategy view ─────────────────────────────────────────────────────────
function StrategyView({
  label,
  labels,
  ideas,
  loading,
  onSwitchLabel,
  onGenerate,
  onPromote,
  onDelete,
}: any) {
  const sorted = [...ideas].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return (
    <div>
      <ViewHead
        eyebrow="Step 1 — Content strategy"
        title={label.name}
        desc={label.description}
      />
      <div className="flex gap-2.5 items-center mb-8 flex-wrap">
        <select
          value={label.id}
          onChange={(e) => onSwitchLabel(e.target.value)}
          className="px-3 py-2"
          style={{ fontSize: "13px", minWidth: "160px" }}
        >
          {labels.map((l: Label) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-spark"
          disabled={loading}
          onClick={onGenerate}
        >
          Generate ideas
        </button>
      </div>

      {loading && (
        <Loading
          text={`Sketching ideas that build on what's already published in ${label.name}...`}
        />
      )}
      {!sorted.length && !loading && (
        <EmptyState text="No ideas yet for this label. Generate a first batch." />
      )}

      <div
        className="space-y-px"
        style={{
          borderTop: sorted.length ? "1px solid var(--border-hair)" : "none",
        }}
      >
        {sorted.map((idea: Idea) => (
          <div
            key={idea.id}
            className="py-5 animate-fade-in"
            style={{ borderBottom: "1px solid var(--border-hair)" }}
          >
            <div className="flex justify-between items-start gap-4 mb-2">
              <div className="flex-1">
                <div
                  className="font-serif mb-1 leading-snug"
                  style={{
                    fontSize: "16.5px",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                >
                  {idea.title}
                </div>
                <p
                  style={{
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    lineHeight: "1.6",
                  }}
                >
                  {idea.main_question}
                </p>
              </div>
              <div
                className="font-mono shrink-0"
                style={{
                  fontSize: "10px",
                  letterSpacing: "0.1em",
                  color: "var(--text-faint)",
                  paddingTop: "3px",
                }}
              >
                #{idea.rank}
              </div>
            </div>

            <p
              style={{
                fontSize: "12.5px",
                color: "var(--text-faint)",
                fontStyle: "italic",
                marginBottom: "10px",
              }}
            >
              {idea.hook_reason}
            </p>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {(idea.seo_keywords || []).map((k: string) => (
                <span key={k} className="tag">
                  {k}
                </span>
              ))}
              {idea.series_position && (
                <span
                  className="tag"
                  style={{
                    color: "var(--accent)",
                    borderColor: "var(--accent-dim)",
                  }}
                >
                  {idea.series_position}
                </span>
              )}
              <span className="tag">curiosity {idea.curiosity_score}/10</span>
              <span className="tag">seo {idea.seo_score}/10</span>
              <span className={`status-pill ${STATUS_STYLES[idea.status]}`}>
                {idea.status}
              </span>
            </div>

            <div className="flex gap-2">
              {idea.status === "idea" ? (
                <button
                  className="btn btn-spark"
                  style={{ fontSize: "12px", padding: "5px 12px" }}
                  onClick={() => onPromote(idea.id)}
                >
                  Draft this article
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: "12px", padding: "5px 12px" }}
                  onClick={() => onPromote(idea.id)}
                >
                  Open in editor
                </button>
              )}
              <button
                className="btn btn-ghost"
                style={{
                  fontSize: "12px",
                  padding: "5px 12px",
                  color: "var(--danger)",
                  borderColor: "rgba(184,90,82,0.35)",
                }}
                onClick={() => onDelete(idea.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pipeline view ─────────────────────────────────────────────────────────
function PipelineView({
  ideas,
  articles,
  labels,
  onOpenArticle,
  onOpenIdea,
}: any) {
  const columns: PipelineStatus[] = [
    "idea",
    "researching",
    "drafting",
    "editing",
    "published",
  ];
  return (
    <div>
      <ViewHead
        eyebrow="Workflow"
        title="Pipeline"
        desc="Everything moves left to right. Click a card to jump into it."
      />
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(5, 1fr)" }}
      >
        {columns.map((col) => {
          const ideaCards = ideas.filter(
            (i: Idea) =>
              i.status === col &&
              !articles.find((a: Article) => a.idea_id === i.id),
          );
          const articleCards = articles.filter(
            (a: Article) => a.status === col,
          );
          return (
            <div
              key={col}
              className="rounded-[10px] p-3.5"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-hair)",
                minHeight: "140px",
              }}
            >
              {/* Column header */}
              <div
                className="flex justify-between items-center mb-3"
                style={{
                  borderBottom: "1px solid var(--border-hair)",
                  paddingBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "9.5px",
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "var(--text-faint)",
                    fontWeight: 600,
                  }}
                >
                  {col}
                </span>
                <span
                  className="font-mono"
                  style={{ fontSize: "10px", color: "var(--text-faint)" }}
                >
                  {ideaCards.length + articleCards.length}
                </span>
              </div>

              {ideaCards.map((c: Idea) => (
                <PipelineCard
                  key={c.id}
                  title={c.title}
                  label={labels.find((l: Label) => l.id === c.label_id)?.name}
                  onClick={() => onOpenIdea(c)}
                />
              ))}
              {articleCards.map((c: Article) => (
                <PipelineCard
                  key={c.id}
                  title={c.title}
                  label={labels.find((l: Label) => l.id === c.label_id)?.name}
                  onClick={() => onOpenArticle(c.id)}
                />
              ))}
              {!ideaCards.length && !articleCards.length && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-faint)",
                    padding: "4px 0",
                  }}
                >
                  Empty
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PipelineCard({
  title,
  label,
  onClick,
}: {
  title: string;
  label?: string;
  onClick: () => void;
}) {
  return (
    <div
      className="px-2.5 py-2 mb-2 rounded-md cursor-pointer transition-all duration-200"
      style={{
        background: "var(--bg-raised)",
        border: "1px solid var(--border-hair)",
        fontSize: "12px",
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          "var(--border-hair)";
      }}
    >
      <div
        className="leading-snug mb-0.5"
        style={{ color: "var(--text-primary)", fontWeight: 500 }}
      >
        {title}
      </div>
      {label && (
        <div style={{ fontSize: "10.5px", color: "var(--text-faint)" }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── Pipeline steps ────────────────────────────────────────────────────────
// The linear "one click to publish" pipeline. Each step is a numbered pill
// button; steps become available once their prerequisite has run, so the
// person is guided left-to-right instead of hunting for the right tab.
function PipelineSteps({
  article,
  loading,
  onGenerateArticle,
  onGenerateImages,
  onGenerateCaptions,
  onInsertInternalLinks,
  onInsertExternalLinks,
  onGenerateHtml,
  onCopyForBlogger,
  onRunFullPipeline,
}: any) {
  const hasContent = !!article.sections?.length;
  const steps = [
    {
      key: "article",
      label: "Article",
      done: hasContent,
      ready: true,
      onClick: onGenerateArticle,
      loadingKey: "article",
    },
    {
      key: "images",
      label: "Images",
      done: false,
      ready: hasContent,
      onClick: onGenerateImages,
      loadingKey: "images",
    },
    {
      key: "captions",
      label: "Captions",
      done: false,
      ready: hasContent,
      onClick: onGenerateCaptions,
      loadingKey: "captions",
    },
    {
      key: "internal",
      label: "Internal Links",
      done: false,
      ready: hasContent,
      onClick: onInsertInternalLinks,
      loadingKey: "links-internal",
    },
    {
      key: "external",
      label: "External Links",
      done: false,
      ready: hasContent,
      onClick: onInsertExternalLinks,
      loadingKey: "links-external",
    },
    {
      key: "html",
      label: "HTML",
      done: !!article.html,
      ready: hasContent,
      onClick: onGenerateHtml,
      loadingKey: "html",
    },
    {
      key: "copy",
      label: "Copy for Blogger",
      done: false,
      ready: !!article.html,
      onClick: onCopyForBlogger,
      loadingKey: null,
    },
  ];
  const anyRunning = loading === "all";

  return (
    <div
      className="mb-7"
      style={{
        borderBottom: "1px solid var(--border-hair)",
        paddingBottom: "1.5rem",
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap rounded-xl border border-[var(--border-hair)] bg-[var(--surface)] p-2.5">
        {/* Main action */}
        <button
          disabled={!!loading}
          onClick={onRunFullPipeline}
          className="btn btn-spark flex items-center gap-2 shrink-0"
          style={{
            fontSize: "12px",
            padding: "8px 16px",
            minHeight: "34px",
          }}
        >
          <span>{anyRunning ? "⏳" : "▶"}</span>
          {anyRunning ? "Running…" : "Run Full Pipeline"}
        </button>

        {/* Steps */}
        <div
          className="flex items-center gap-1.5 flex-wrap flex-1"
          style={{
            paddingLeft: "12px",
            borderLeft: "1px solid var(--border-hair)",
          }}
        >
          {steps.map((s, i) => {
            const isRunning = s.loadingKey && loading === s.loadingKey;

            return (
              <button
                key={s.key}
                disabled={
                  !s.ready ||
                  anyRunning ||
                  (s.loadingKey ? loading === s.loadingKey : false)
                }
                onClick={s.onClick}
                className={
                  s.key === "copy"
                    ? "btn btn-spark flex items-center gap-1.5"
                    : "btn btn-ghost flex items-center gap-1.5"
                }
                style={{
                  fontSize: "11px",
                  padding: "5px 11px",
                  minHeight: "30px",
                  opacity: s.ready ? 1 : 0.45,
                }}
                title={s.ready ? "" : "Complete the previous step first"}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: "9px",
                    opacity: 0.45,
                    minWidth: "14px",
                  }}
                >
                  {i + 1}
                </span>

                <span>{isRunning ? "Working…" : s.label}</span>

                {s.done && s.key !== "copy" && (
                  <span
                    style={{
                      color: "var(--sage)",
                      fontSize: "12px",
                      marginLeft: "2px",
                    }}
                  >
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Editor view ───────────────────────────────────────────────────────────
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
    const next = draft.sections.map((s: ArticleSection, idx: number) =>
      idx === i ? { ...s, [field]: value } : s,
    );
    setDraft({ ...draft, sections: next });
  }

  function copyImageDescription(text?: string) {
    const value = text?.trim();
    if (!value) return;

    try {
      navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  return (
    <div>
      {/* Header row */}
      <ViewHead eyebrow="Article pipeline" title={article.title} desc="" />

      {/* Meta strip */}
      <div className="flex gap-2 items-center mb-6 flex-wrap -mt-3">
        <span
          className={`status-pill ${STATUS_STYLES[article.status as PipelineStatus]}`}
        >
          {article.status}
        </span>
        {label && <span className="tag">{label.name}</span>}
        {!!article.reading_time_minutes && (
          <span className="tag font-mono">
            Est. {article.reading_time_minutes} min read
          </span>
        )}
        {article.published_url && (
          <a
            href={article.published_url}
            target="_blank"
            rel="noreferrer"
            className="tag"
            style={{ color: "var(--accent)" }}
          >
            View published ↗
          </a>
        )}

        {/* Right-side controls */}
        <div className="flex items-center gap-2 ml-auto">
          <select
            value={article.id}
            onChange={(e) => onSwitchArticle(e.target.value)}
            className="px-3 py-1.5"
            style={{ fontSize: "12.5px", maxWidth: "200px" }}
          >
            {articles.map((a: Article) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <select
            value={article.status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="px-3 py-1.5"
            style={{ fontSize: "12.5px" }}
          >
            {["idea", "researching", "drafting", "editing", "published"].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
          <button
            className="btn btn-ghost"
            style={{
              fontSize: "12px",
              padding: "5px 10px",
              color: "var(--danger)",
              borderColor: "rgba(184,90,82,0.3)",
            }}
            onClick={onDeleteArticle}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Stale warning */}
      {stale && (
        <Notice kind="warn">
          This article was edited after it was last generated — downstream steps
          (images, links, HTML) were built from the older content. Regenerate
          HTML if you want the published output to reflect your edits.
        </Notice>
      )}

      {/* No content yet */}
      {!hasContent ? (
        <>
          <button
            className="btn btn-spark"
            disabled={!!loading}
            onClick={onGenerateArticle}
          >
            Generate Article
          </button>
          {loading === "article" && (
            <Loading text="Writing the draft in the Synapse Snaps voice…" />
          )}
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

          {/* Two-column layout: article text | sidebar */}
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: "1fr 300px" }}
          >
            {/* ── Article content column ──────────────────────────── */}
            <div
              className="rounded-[10px] px-9 py-8"
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-hair)",
              }}
            >
              {/* Editable header + save controls */}
              <div
                className="flex justify-between items-center mb-5"
                style={{
                  borderBottom: "1px solid var(--border-hair)",
                  paddingBottom: "14px",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--text-faint)",
                  }}
                >
                  Editable content
                </div>
                {isDirty && (
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: "11px", padding: "4px 9px" }}
                      onClick={onDiscardEdits}
                    >
                      Discard
                    </button>
                    <button
                      className="btn btn-spark"
                      style={{ fontSize: "11px", padding: "4px 9px" }}
                      onClick={onSaveEdits}
                    >
                      Save changes
                    </button>
                  </div>
                )}
              </div>

              {/* Article title */}
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="font-serif w-full bg-transparent focus:outline-none mb-1"
                style={{
                  fontSize: "26px",
                  fontWeight: 500,
                  lineHeight: "1.25",
                  color: "var(--text-primary)",
                  border: "none",
                  borderBottom: "1px solid transparent",
                  paddingBottom: "4px",
                  transition: "border-color 200ms",
                }}
                onFocus={(e) => {
                  (e.target as HTMLElement).style.borderBottomColor =
                    "var(--accent)";
                }}
                onBlur={(e) => {
                  (e.target as HTMLElement).style.borderBottomColor =
                    "transparent";
                }}
              />
              {/* Subtitle */}
              <input
                value={draft.subtitle}
                onChange={(e) =>
                  setDraft({ ...draft, subtitle: e.target.value })
                }
                placeholder="Subtitle"
                className="w-full bg-transparent focus:outline-none mb-5"
                style={{
                  fontSize: "15px",
                  color: "var(--text-secondary)",
                  border: "none",
                  borderBottom: "1px solid transparent",
                  paddingBottom: "4px",
                  transition: "border-color 200ms",
                }}
                onFocus={(e) => {
                  (e.target as HTMLElement).style.borderBottomColor =
                    "var(--accent)";
                }}
                onBlur={(e) => {
                  (e.target as HTMLElement).style.borderBottomColor =
                    "transparent";
                }}
              />

              {/* TL;DR — left-accent block */}
              <div
                className="mb-6 px-4 py-3 rounded-r-md"
                style={{
                  borderLeft: "2px solid var(--accent)",
                  background: "var(--accent-dim)",
                  fontSize: "13px",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    color: "var(--accent)",
                    marginBottom: "6px",
                    fontWeight: 600,
                  }}
                >
                  TL;DR
                </div>
                <textarea
                  value={draft.tldr}
                  onChange={(e) => setDraft({ ...draft, tldr: e.target.value })}
                  rows={2}
                  className="bg-transparent w-full focus:outline-none resize-y"
                  style={{
                    color: "var(--text-secondary)",
                    lineHeight: "1.65",
                    fontSize: "13px",
                  }}
                />
              </div>

              {/* Sections */}
              {draft.sections.map((s: ArticleSection, i: number) => (
                <div key={i}>
                  <input
                    value={s.heading}
                    onChange={(e) =>
                      updateSection(i, "heading", e.target.value)
                    }
                    className="font-serif w-full bg-transparent focus:outline-none mt-7 mb-2"
                    style={{
                      fontSize: "20px",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      border: "none",
                      borderBottom: "1px solid transparent",
                      paddingBottom: "3px",
                      transition: "border-color 200ms",
                    }}
                    onFocus={(e) => {
                      (e.target as HTMLElement).style.borderBottomColor =
                        "var(--accent)";
                    }}
                    onBlur={(e) => {
                      (e.target as HTMLElement).style.borderBottomColor =
                        "transparent";
                    }}
                  />
                  <textarea
                    value={s.body}
                    onChange={(e) => updateSection(i, "body", e.target.value)}
                    rows={Math.max(3, Math.ceil(s.body.length / 90))}
                    className="bg-transparent w-full focus:outline-none resize-y"
                    style={{
                      fontSize: "14px",
                      lineHeight: "1.8",
                      color: "var(--text-secondary)",
                      marginBottom: "12px",
                    }}
                  />
                </div>
              ))}

              {/* Conclusion */}
              <div
                style={{
                  borderTop: "1px solid var(--border-hair)",
                  marginTop: "1.75rem",
                  paddingTop: "1.5rem",
                }}
              >
                <h2
                  className="font-serif mb-2"
                  style={{
                    fontSize: "20px",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                >
                  Wrapping up
                </h2>
                <textarea
                  value={draft.conclusion}
                  onChange={(e) =>
                    setDraft({ ...draft, conclusion: e.target.value })
                  }
                  rows={3}
                  className="bg-transparent w-full focus:outline-none resize-y"
                  style={{
                    fontSize: "14px",
                    lineHeight: "1.8",
                    color: "var(--text-secondary)",
                  }}
                />
              </div>

              {/* Style check */}
              {article.banned_word_hits?.length ? (
                <div
                  className="mt-5 rounded-lg px-4 py-3"
                  style={{
                    background: "var(--ember-bg)",
                    border: "1px solid rgba(196,154,92,0.25)",
                    fontSize: "12.5px",
                    color: "var(--ember)",
                  }}
                >
                  Style check flagged:{" "}
                  {article.banned_word_hits
                    .map((h: any) => `${h.word} (${h.count}x)`)
                    .join(", ")}
                </div>
              ) : (
                <div
                  className="mt-5 rounded-lg px-4 py-3"
                  style={{
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-hair)",
                    fontSize: "12.5px",
                    color: "var(--text-faint)",
                  }}
                >
                  Style check passed. Word count: {article.word_count}.
                </div>
              )}

              {/* HTML preview */}
              {article.html && (
                <div className="mt-5">
                  <div
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "var(--text-faint)",
                      marginBottom: "8px",
                    }}
                  >
                    Generated HTML (preview)
                  </div>
                  <pre
                    className="font-mono overflow-auto"
                    style={{
                      background: "var(--bg-raised)",
                      border: "1px solid var(--border-hair)",
                      borderRadius: "8px",
                      padding: "14px",
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      maxHeight: "220px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {article.html}
                  </pre>
                </div>
              )}

              <div className="flex gap-2 mt-5">
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: "12px", padding: "5px 10px" }}
                  disabled={!!loading}
                  onClick={onGenerateArticle}
                >
                  Regenerate draft
                </button>
              </div>
            </div>

            {/* ── Sidebar ─────────────────────────────────────────── */}
            <div>
              {/* Tab bar — images / links */}
              <div
                className="flex gap-1 mb-3"
                style={{
                  borderBottom: "1px solid var(--border-hair)",
                  paddingBottom: "10px",
                }}
              >
                {(["images", "links"] as EditorTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className="flex-1 text-center rounded-md transition-all duration-200"
                    style={{
                      fontSize: "10px",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      padding: "6px 4px",
                      color: tab === t ? "var(--accent)" : "var(--text-faint)",
                      background:
                        tab === t ? "var(--accent-dim)" : "transparent",
                      border: "1px solid",
                      borderColor:
                        tab === t ? "var(--accent-dim)" : "transparent",
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Sidebar content panel */}
              <div
                className="rounded-[10px] p-4"
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-hair)",
                  fontSize: "12.5px",
                }}
              >
                {tab === "images" &&
                  (images.length ? (
                    images.map((img: any) => (
                      <div
                        key={img.id}
                        className="mb-3 pb-3"
                        style={{ borderBottom: "1px solid var(--border-hair)" }}
                      >
                        <div className="flex justify-between items-center mb-2">
                          <div
                            className="font-mono"
                            style={{
                              fontSize: "10px",
                              letterSpacing: "0.1em",
                              color: "var(--ember)",
                            }}
                          >
                            {img.is_featured ? "FEATURED" : `§${img.placement}`}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              title="Copy description"
                              aria-label="Copy description"
                              style={{
                                width: "24px",
                                height: "24px",
                                color: "var(--accent)",
                                border: "1px solid var(--border-hair)",
                                borderRadius: "999px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "var(--bg-raised)",
                              }}
                              onClick={() =>
                                copyImageDescription(img.prompt || img.caption)
                              }
                            >
                              ⧉
                            </button>
                            <button
                              type="button"
                              title="Regenerate image"
                              aria-label="Regenerate image"
                              style={{
                                width: "24px",
                                height: "24px",
                                color: "var(--accent)",
                                border: "1px solid var(--border-hair)",
                                borderRadius: "999px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "var(--bg-raised)",
                              }}
                              disabled={loading === "images"}
                              onClick={() => onRegenerateImage(img.id)}
                            >
                              ↻
                            </button>
                          </div>
                        </div>
                        {img.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img.image_url}
                            alt={img.caption || ""}
                            className="rounded-md mb-2 object-cover w-full"
                            style={{ maxHeight: "130px" }}
                          />
                        ) : (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--text-faint)",
                              fontStyle: "italic",
                              marginBottom: "6px",
                            }}
                          >
                            No image generated yet — will be a placeholder in
                            the HTML.
                          </div>
                        )}
                        <div
                          style={{
                            marginBottom: "2px",
                            color: "var(--text-primary)",
                          }}
                        >
                          {img.caption}
                        </div>
                        <div
                          style={{
                            fontSize: "11px",
                            color: "var(--text-faint)",
                          }}
                        >
                          {img.prompt}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p style={{ color: "var(--text-faint)" }}>
                      Run "Generate Images" to plan and create images.
                    </p>
                  ))}

                {tab === "links" && (
                  <div>
                    <LinkGroup
                      title="Internal — past articles"
                      items={links.filter(
                        (l: any) => l.link_type === "internal_past",
                      )}
                    />
                    <LinkGroup
                      title="Internal — future ideas"
                      items={links.filter(
                        (l: any) => l.link_type === "internal_future",
                      )}
                    />
                    <LinkGroup
                      title="External sources"
                      items={links.filter(
                        (l: any) => l.link_type === "external",
                      )}
                      showCategory
                    />
                    {!links.length && (
                      <p style={{ color: "var(--text-faint)" }}>
                        Run "Insert Internal Links" and "Insert External Links"
                        to populate this.
                      </p>
                    )}
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
function AdvancedSettings({
  article,
  seo,
  open,
  setOpen,
  blogs,
  loading,
  onConnectBlogger,
  onLoadBlogs,
  onSelectBlog,
  onPublish,
}: any) {
  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left flex items-center justify-between px-1 py-2.5 transition-colors duration-200"
        style={{
          fontSize: "10.5px",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-faint)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color =
            "var(--text-secondary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = "var(--text-faint)";
        }}
      >
        <span>Advanced settings</span>
        <span style={{ fontSize: "14px", lineHeight: 1 }}>
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div
          className="rounded-[10px] p-4 space-y-4 animate-fade-in"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-hair)",
            fontSize: "12.5px",
          }}
        >
          {/* SEO */}
          <div>
            <div
              style={{
                fontSize: "9.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-faint)",
                marginBottom: "10px",
                fontWeight: 600,
              }}
            >
              SEO
            </div>
            {seo ? (
              <>
                <Kv k="Primary keyword" v={seo.primary_keyword} />
                <Kv
                  k="Secondary keywords"
                  v={(seo.secondary_keywords || []).join(", ")}
                />
                <Kv k="SEO title" v={seo.seo_title} />
                <Kv k="Meta description" v={seo.meta_description} />
              </>
            ) : (
              <p style={{ color: "var(--text-faint)" }}>
                SEO metadata is generated automatically once you run the
                pipeline.
              </p>
            )}
          </div>

          {/* Blogger */}
          <div
            style={{
              borderTop: "1px solid var(--border-hair)",
              paddingTop: "14px",
            }}
          >
            <div
              style={{
                fontSize: "9.5px",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--text-faint)",
                marginBottom: "10px",
                fontWeight: 600,
              }}
            >
              Blogger
            </div>
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-google flex items-center justify-center"
                style={{ fontSize: "12px" }}
                onClick={onConnectBlogger}
              >
                <i className="bi bi-google"></i> |{" "}
                {blogs.length ? "Switch Google account" : "Connect to Google"}
              </button>
              <button
                className="btn btn-ghost flex items-center justify-center"
                style={{ fontSize: "12px" }}
                disabled={loading === "blogs"}
                onClick={onLoadBlogs}
              >
                {loading === "blogs" ? "Loading blogs…" : "Load my blogs"}
              </button>
              {!!blogs.length && (
                <select
                  onChange={(e) => onSelectBlog(e.target.value)}
                  className="px-3 py-2"
                  style={{ fontSize: "12.5px" }}
                  defaultValue=""
                >
                  <option value="" disabled>
                    Choose a blog to publish to…
                  </option>
                  {blogs.map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-2 mt-1 w-full">
                <button
                  className="btn btn-ghost flex-1"
                  style={{ fontSize: "12px" }}
                  disabled={!article.html || loading === "publish"}
                  onClick={() => onPublish("draft")}
                >
                  Save draft on Blogger
                </button>
                <button
                  className="btn btn-spark flex-1 items-center justify-center"
                  disabled={!article.html || loading === "publish"}
                  onClick={() => onPublish("publish")}
                >
                  {loading === "publish" ? (
                    <span className="spinner-border spinner-border-sm"></span>
                  ) : (
                    <i className="bi bi-upload"></i>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Link group ────────────────────────────────────────────────────────────
function LinkGroup({ title, items, showCategory }: any) {
  return (
    <div className="mb-4">
      <div
        style={{
          fontSize: "9.5px",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-faint)",
          marginBottom: "6px",
          fontWeight: 600,
        }}
      >
        {title}
      </div>
      {items.length ? (
        items.map((l: any) => (
          <div
            key={l.id}
            className="py-2 last:border-b-0"
            style={{
              borderBottom: "1px solid var(--border-hair)",
              fontSize: "11.5px",
            }}
          >
            <b style={{ color: "var(--text-primary)" }}>{l.target_title}</b>{" "}
            {showCategory && l.category && (
              <span className="tag" style={{ marginLeft: "4px" }}>
                {l.category}
              </span>
            )}
            <br />
            <span style={{ color: "var(--text-faint)" }}>
              {l.placement_note}
            </span>
          </div>
        ))
      ) : (
        <div
          style={{
            fontSize: "11px",
            color: "var(--text-faint)",
            paddingTop: "4px",
          }}
        >
          None
        </div>
      )}
    </div>
  );
}

// ─── Search view ───────────────────────────────────────────────────────────
function SearchView({
  articles,
  labels,
  query,
  setQuery,
  onOpen,
  onDelete,
}: any) {
  const q = query.toLowerCase();
  const results = articles.filter(
    (a: Article) =>
      !q ||
      a.title.toLowerCase().includes(q) ||
      (a.tldr || "").toLowerCase().includes(q),
  );
  return (
    <div>
      <ViewHead eyebrow="Find" title="Search articles" desc="" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by title or summary…"
        className="mb-6 px-3 py-2"
        style={{
          fontSize: "13.5px",
          maxWidth: "400px",
          width: "100%",
          display: "block",
        }}
      />
      <div
        style={{
          borderTop: results.length ? "1px solid var(--border-hair)" : "none",
        }}
      >
        {results.map((a: Article) => {
          const label = labels.find((l: Label) => l.id === a.label_id);
          return (
            <div
              key={a.id}
              className="py-5 animate-fade-in"
              style={{ borderBottom: "1px solid var(--border-hair)" }}
            >
              <div className="flex justify-between items-start gap-4 mb-1">
                <div
                  className="font-serif cursor-pointer leading-snug"
                  style={{
                    fontSize: "16.5px",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                  }}
                  onClick={() => onOpen(a.id)}
                >
                  {a.title}
                </div>
                <span
                  className={`status-pill ${STATUS_STYLES[a.status]} shrink-0`}
                >
                  {a.status}
                </span>
              </div>
              <div
                className="cursor-pointer mb-3"
                style={{
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  lineHeight: "1.65",
                }}
                onClick={() => onOpen(a.id)}
              >
                {a.tldr || "No summary yet."}
              </div>
              <div className="flex gap-1.5 items-center flex-wrap">
                {label && <span className="tag">{label.name}</span>}
                {!!a.reading_time_minutes && (
                  <span className="tag font-mono">
                    {a.reading_time_minutes} min read
                  </span>
                )}
                <button
                  className="ml-auto hover:underline"
                  style={{ fontSize: "11px", color: "var(--danger)" }}
                  onClick={() => onDelete(a.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!results.length && <EmptyState text={`No articles match "${query}".`} />}
    </div>
  );
}

// ─── Shared primitives ─────────────────────────────────────────────────────
function ViewHead({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc?: string | null;
}) {
  return (
    <div className="mb-8">
      <div className="eyebrow mb-2">{eyebrow}</div>
      <h1
        className="font-serif mb-2"
        style={{
          fontSize: "32px",
          fontWeight: 500,
          lineHeight: "1.15",
          color: "var(--text-primary)",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h1>
      {desc && (
        <p
          style={{
            fontSize: "14px",
            color: "var(--text-secondary)",
            maxWidth: "580px",
            lineHeight: "1.7",
          }}
        >
          {desc}
        </p>
      )}
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div
      className="flex items-center gap-2.5 py-5"
      style={{ color: "var(--accent)", fontSize: "13px" }}
    >
      <div
        className="shrink-0 animate-spin"
        style={{
          width: "13px",
          height: "13px",
          borderRadius: "50%",
          border: "1.5px solid var(--accent-dim)",
          borderTopColor: "var(--accent)",
        }}
      />
      {text}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function Kv({ k, v }: { k: string; v: any }) {
  return (
    <div className="mb-3">
      <div
        style={{
          fontSize: "9.5px",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--text-faint)",
          marginBottom: "3px",
          fontWeight: 600,
        }}
      >
        {k}
      </div>
      <div style={{ color: "var(--text-primary)", lineHeight: "1.55" }}>
        {v}
      </div>
    </div>
  );
}
