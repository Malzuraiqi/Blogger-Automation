-- Run this whole file once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

create extension if not exists pgcrypto;

create table if not exists labels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  created_at timestamptz default now()
);

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  label_id uuid references labels(id) on delete cascade,
  title text not null,
  main_question text,
  hook_reason text,
  seo_keywords text[] default '{}',
  series_position text,
  curiosity_score int,
  seo_score int,
  audience_score int,
  rank int,
  status text default 'idea' check (status in ('idea','researching','drafting','editing','published')),
  created_at timestamptz default now()
);

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid references ideas(id) on delete set null unique,
  label_id uuid references labels(id) on delete cascade,
  title text not null,
  subtitle text,
  tldr text,
  sections jsonb default '[]',       -- [{heading, body}]
  conclusion text,
  word_count int default 0,
  reading_time_minutes int default 0,
  banned_word_hits jsonb default '[]',
  status text default 'drafting' check (status in ('idea','researching','drafting','editing','published')),
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists article_seo (
  article_id uuid primary key references articles(id) on delete cascade,
  primary_keyword text,
  secondary_keywords text[] default '{}',
  seo_title text,
  meta_description text,
  keyword_in_h1 boolean,
  keyword_in_first_paragraph boolean
);

create table if not exists article_images (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) on delete cascade,
  is_featured boolean default false,
  placement text,
  description text,
  purpose text,
  sort_order int default 0
);

create table if not exists article_links (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references articles(id) on delete cascade,
  link_type text check (link_type in ('internal_past','internal_future','external')),
  target_title text,
  category text,             -- university / museum / scientific organization / government (external only)
  placement_note text
);

create index if not exists idx_ideas_label_status on ideas(label_id, status);
create index if not exists idx_articles_label on articles(label_id);
create index if not exists idx_articles_status on articles(status);

-- Seed data matching the labels/articles you already have
insert into labels (name, slug, description) values
  ('Humanity', 'humanity', 'Where we came from and where we might be going.'),
  ('Science', 'science', 'Weird facts, real mechanisms, no jargon.')
on conflict (slug) do nothing;
