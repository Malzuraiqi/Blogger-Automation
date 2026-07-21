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
  description: string;
  purpose: string;
}

export interface ArticleLink {
  id: string;
  article_id: string;
  link_type: "internal_past" | "internal_future" | "external";
  target_title: string;
  category: string | null;
  placement_note: string;
}
