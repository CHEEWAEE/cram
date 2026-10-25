-- Cram database schema. Run this once in the Supabase SQL editor on a fresh project.
--
-- Rebuilt from the queries in server/index.js rather than dumped from the live
-- database, so check it against the real tables before trusting it for anything
-- other than a new project.
--
-- RLS stays off on these tables: the browser never talks to them directly. Every
-- read and write goes through the Express API, which checks ownership itself.

create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index decks_user_id_idx on decks (user_id);

create table cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks (id) on delete cascade,
  front_text text,
  back_text text,
  front_image_url text,
  back_image_url text,
  -- 0 to 1, nudged toward 0 / 0.5 / 1 by each first rating in a session.
  strength real not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cards_deck_id_idx on cards (deck_id);

create table reviews (
  id bigint generated always as identity primary key,
  card_id uuid not null references cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 3),
  created_at timestamptz not null default now()
);

create index reviews_card_id_idx on reviews (card_id);

-- Card images: a public bucket. Uploads go through one-shot signed URLs minted
-- by the API, so no storage policies are needed for inserts.
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;
