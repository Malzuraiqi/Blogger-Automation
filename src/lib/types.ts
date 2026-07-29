// FILE: src/lib/types.ts
// shared TypeScript types (Label, Idea, Article, ArticleImage, ArticleLink, etc.).

export type PipelineStatus = "idea" | "researching" | "drafting" | "editing" | "published";

export interface Label {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface Idea {
  id: string;
  label_id: string;
  title: string;
  main_question: string | null;
  hook_reason: string | null;
  seo_keywords: string[];
  series_position: string | null;
  curiosity_score: number | null;
  seo_score: number | null;
  audience_score: number | null;
  rank: number | null;
  status: PipelineStatus;
  content_type: string | null;
}

export interface ArticleSection {
  heading: string;
  body: string;
}

export interface Article {
  id: string;
  idea_id: string | null;
  label_id: string;
  title: string;
  subtitle: string | null;
  tldr: string | null;
  sections: ArticleSection[];
  conclusion: string | null;
  word_count: number;
  reading_time_minutes: number;
  banned_word_hits: { word: string; count: number }[];
  status: PipelineStatus;
  updated_at: string;
  // Set only when "Generate Article" (re)writes content — compared against
  content_generated_at: string | null;
  // Blogger pipeline additions
  html: string | null;
  blogger_labels: string[];
  published_url: string | null;
  links_inserted: boolean;
  permalink: string | null;
  content_type: string | null;
  published_at: string | null;
  blogger_post_id: string | null;
}

export interface ArticleSeo {
  article_id: string;
  primary_keyword: string;
  secondary_keywords: string[];
  seo_title: string;
  meta_description: string;
  keyword_in_h1: boolean;
  keyword_in_first_paragraph: boolean;
}

export interface ArticleImage {
  id: string;
  article_id: string;
  is_featured: boolean;
  placement: string;
  caption: string | null;
  prompt: string | null;
  image_url: string | null;
  sort_order: number;
}

export interface ArticleLink {
  id: string;
  article_id: string;
  link_type: "internal_past" | "internal_future" | "external";
  target_title: string;
  target_url?: string | null;
  category: string | null;
  placement_note: string;
}

export interface ArticleVersion {
  id: string;
  article_id: string;
  title: string;
  subtitle: string | null;
  tldr: string | null;
  sections: ArticleSection[];
  conclusion: string | null;
  reason: string;
  created_at: string;
}

export interface BloggerCredentials {
  id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  blog_id: string | null;
  blog_url: string | null;
}

export interface StyleProfile {
  id: string;
  profile_text: string;
  sample_count: number;
  sample_word_count: number;
  updated_at: string;
}