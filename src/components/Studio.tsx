"use client";

import { useEffect, useState, useCallback } from "react";
import type { Label, Idea, Article, PipelineStatus } from "@/lib/types";

type View = "labels" | "strategy" | "pipeline" | "editor" | "search";
type EditorTab = "seo" | "images" | "links";

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

export default function Studio() {
  const [view, setView] = useState<View>("labels");
  const [labels, setLabels] = useState<Label[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeLabelId, setActiveLabelId] = useState<string | null>(null);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("seo");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newLabelName, setNewLabelName] = useState("");

  const refreshAll = useCallback(async () => {
    const [l, i, a] = await Promise.all([api<Label[]>("/api/labels"), api<Idea[]>("/api/ideas"), api<Article[]>("/api/articles")]);
    setLabels(l);
    setIdeas(i);
    setArticles(a);
    if (!activeLabelId && l.length) setActiveLabelId(l[0].id);
  }, [activeLabelId]);

  useEffect(() => {
    refreshAll().catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function generateArticle(articleId: string) {
    setLoading("article");
    setError(null);
    try {
      await api("/api/generate/article", { method: "POST", body: JSON.stringify({ articleId }) });
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  async function generateMeta(articleId: string) {
    setLoading("meta");
    setError(null);
    try {
      await api("/api/generate/meta", { method: "POST", body: JSON.stringify({ articleId }) });
      await refreshAll();
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(null);
  }

  async function setArticleStatus(id: string, status: PipelineStatus) {
    await api("/api/articles", { method: "PATCH", body: JSON.stringify({ id, status }) });
    await refreshAll();
  }

  function exportMarkdown(article: any) {
    let md = `# ${article.title}\n\n> ${article.tldr}\n\n`;
    (article.sections || []).forEach((s: any) => (md += `## ${s.heading}\n\n${s.body}\n\n`));
    md += `## Wrapping up\n\n${article.conclusion}\n\n`;
    const seo = article.article_seo?.[0];
    if (seo) md += `---\n**SEO title:** ${seo.seo_title}\n\n**Meta description:** ${seo.meta_description}\n\n`;
    md += `**Estimated reading time:** ${article.reading_time_minutes} minutes\n`;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = article.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) + ".md";
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeLabel = labels.find((l) => l.id === activeLabelId) || labels[0];
  const activeArticle = articles.find((a) => a.id === activeArticleId) || articles[0];

  return (
    <div className="flex min-h-screen">
      <Rail view={view} setView={setView} labels={labels} ideas={ideas} articles={articles} />
      <main className="flex-1 min-w-0 px-10 py-9 pb-20 max-w-[1180px]">
        {error && (
          <div className="bg-ember-dim text-[#F0D8AE] border border-[#5B4526] rounded-lg px-4 py-3 text-[12.5px] mb-4">
            {error}
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

        {view === "editor" && activeArticle && (
          <EditorView
            article={activeArticle}
            articles={articles}
            labels={labels}
            ideas={ideas}
            tab={editorTab}
            setTab={(t: EditorTab) => setEditorTab(t)}
            loading={loading}
            onSwitchArticle={(id: string) => setActiveArticleId(id)}
            onStatusChange={(s: PipelineStatus) => setArticleStatus(activeArticle.id, s)}
            onGenerateArticle={() => generateArticle(activeArticle.id)}
            onGenerateMeta={() => generateMeta(activeArticle.id)}
            onExport={() => exportMarkdown(activeArticle)}
            onPromote={promoteToDraft}
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

function StrategyView({ label, labels, ideas, loading, onSwitchLabel, onGenerate, onPromote }: any) {
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
          <div className="mt-3">
            {idea.status === "idea" ? (
              <button className="btn btn-spark" style={{ padding: "5px 11px", fontSize: 12, borderRadius: 6 }} onClick={() => onPromote(idea.id)}>
                Draft this article
              </button>
            ) : (
              <button className="btn btn-ghost" style={{ padding: "5px 11px", fontSize: 12, borderRadius: 6 }} onClick={() => onPromote(idea.id)}>
                Open in editor
              </button>
            )}
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

function EditorView({ article, articles, labels, ideas, tab, setTab, loading, onSwitchArticle, onStatusChange, onGenerateArticle, onGenerateMeta, onExport, onPromote }: any) {
  const label = labels.find((l: Label) => l.id === article.label_id);
  const hasContent = article.sections && article.sections.length;
  const seo = article.article_seo?.[0];
  const images = article.article_images || [];
  const links = article.article_links || [];

  return (
    <div>
      <ViewHead eyebrow="Steps 2-6 - editor" title={article.title} desc="" />
      <div className="flex gap-2.5 items-center mb-6 flex-wrap -mt-2">
        <span className={`status-pill ${STATUS_STYLES[article.status as PipelineStatus]}`}>{article.status}</span>
        {label && <span className="tag">{label.name}</span>}
        {!!article.reading_time_minutes && <span className="tag font-mono">Estimated reading time: {article.reading_time_minutes} minutes</span>}
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
      </div>

      {!hasContent ? (
        <>
          <button className="btn btn-spark" disabled={!!loading} onClick={onGenerateArticle}>Generate full article</button>
          {loading === "article" && <Loading text="Writing the draft in the Synapse Snaps voice..." />}
        </>
      ) : (
        <div className="grid gap-5.5" style={{ gridTemplateColumns: "1fr 320px" }}>
          <div className="bg-ink-2 border border-border rounded-[10px] px-8 py-7">
            <h1 className="font-serif text-[26px] mb-2">{article.title}</h1>
            {article.subtitle && <div className="text-paper-dim text-sm -mt-1 mb-4">{article.subtitle}</div>}
            <div className="bg-spark-dim border-l-[3px] border-spark px-3.5 py-2.5 rounded-r-md text-[13.5px] mb-5">
              <b>TL;DR</b> {article.tldr}
            </div>
            {(article.sections || []).map((s: any, i: number) => (
              <div key={i}>
                <h2 className="font-serif text-[19px] mt-6 mb-2">{s.heading}</h2>
                <p className="leading-[1.75] text-[14.5px] text-[#DCDAD1] mb-3.5">{s.body}</p>
              </div>
            ))}
            <div className="border-t border-border mt-6 pt-4.5">
              <h2 className="font-serif text-[19px] mb-2">Wrapping up</h2>
              <p className="leading-[1.75] text-[14.5px] text-[#DCDAD1]">{article.conclusion}</p>
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
            <div className="flex gap-2.5 mt-5">
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 11px" }} onClick={onExport}>Export markdown</button>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 11px" }} disabled={!!loading} onClick={onGenerateArticle}>Regenerate draft</button>
            </div>
          </div>

          <div>
            <div className="flex gap-1 mb-3 flex-wrap">
              {(["seo", "images", "links"] as EditorTab[]).map((t) => (
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
              {!seo ? (
                <>
                  <p className="text-paper-dim mt-0">Generate the SEO, image, and link plan for this draft.</p>
                  <button className="btn btn-spark" style={{ fontSize: 12 }} disabled={!!loading} onClick={onGenerateMeta}>
                    Generate SEO + image + link plan
                  </button>
                  {loading === "meta" && <Loading text="Planning keywords, images, links..." />}
                </>
              ) : (
                <>
                  {tab === "seo" && (
                    <div>
                      <Kv k="Primary keyword" v={seo.primary_keyword} />
                      <Kv k="Secondary keywords" v={(seo.secondary_keywords || []).join(", ")} />
                      <Kv k="SEO title" v={seo.seo_title} />
                      <Kv k="Meta description" v={seo.meta_description} />
                      <Check ok={seo.keyword_in_h1} label="Keyword appears in H1" />
                      <Check ok={seo.keyword_in_first_paragraph} label="Keyword appears in first paragraph" />
                    </div>
                  )}
                  {tab === "images" &&
                    (images.length ? images.map((img: any) => (
                      <div key={img.id} className="bg-ink-3 border border-border rounded-lg px-3 py-2.5 mb-2">
                        <div className="text-ember text-[11px] mb-1 font-mono">{img.is_featured ? "FEATURED IMAGE" : `Placement: ${img.placement}`}</div>
                        <div className="mb-1">{img.description}</div>
                        <div className="text-paper-faint text-[11px]">{img.purpose}</div>
                      </div>
                    )) : <p className="text-paper-faint">No images planned.</p>)}
                  {tab === "links" && (
                    <div>
                      <LinkGroup title="Internal - past articles" items={links.filter((l: any) => l.link_type === "internal_past")} />
                      <LinkGroup title="Internal - future ideas" items={links.filter((l: any) => l.link_type === "internal_future")} />
                      <LinkGroup title="External sources" items={links.filter((l: any) => l.link_type === "external")} showCategory />
                    </div>
                  )}
                </>
              )}
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

function SearchView({ articles, labels, query, setQuery, onOpen }: any) {
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
          <div key={a.id} className="card mb-3 cursor-pointer" onClick={() => onOpen(a.id)}>
            <div className="flex justify-between">
              <div className="font-serif text-[15.5px] font-semibold">{a.title}</div>
              <span className={`status-pill ${STATUS_STYLES[a.status]}`}>{a.status}</span>
            </div>
            <div className="text-paper-dim text-[13px] mt-1">{a.tldr || "No summary yet."}</div>
            <div className="flex gap-1.5 mt-2">
              {label && <span className="tag">{label.name}</span>}
              {!!a.reading_time_minutes && <span className="tag font-mono">{a.reading_time_minutes} min read</span>}
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

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-1.5 text-[12.5px]">
      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] shrink-0 ${ok ? "bg-sage-dim text-sage" : "bg-[#4A2323] text-danger"}`}>
        {ok ? "✓" : "×"}
      </span>
      {label}
    </div>
  );
}
