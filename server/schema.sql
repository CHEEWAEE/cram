-- Cram database schema. Run this once in the Supabase SQL editor on a fresh project.
--
-- RLS is on with no policies, so the public anon key can't touch these tables.
-- The browser never needs to: every read and write goes through the Express API,
-- which connects as the table owner (postgres, which bypasses RLS) and checks
-- ownership itself.

-- One level of folders for grouping decks.
create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index folders_user_id_idx on folders (user_id);

create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  share_token uuid unique,
  folder_id uuid references folders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index decks_user_id_idx on decks (user_id);
create index decks_folder_id_idx on decks (folder_id);

create table cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks (id) on delete cascade,
  front_text text,
  back_text text,
  front_image_url text,
  back_image_url text,
  -- 0 to 1, nudged toward 0 / 0.5 / 1 by each first rating in a session.
  strength real not null default 0.5,
  -- Image occlusion cards only: { group, target, boxes: [{ id, x, y, w, h, label }] }.
  -- One card per box; all cards made from one image share a group id and the
  -- full box list. x, y, w, h are fractions of the image size.
  occlusion jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cards_deck_id_idx on cards (deck_id);
create index cards_occlusion_group_idx on cards ((occlusion->>'group'))
  where occlusion is not null;

create table reviews (
  id bigint generated always as identity primary key,
  card_id uuid not null references cards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating in (1, 2, 3)),
  created_at timestamptz not null default now()
);

create index reviews_card_id_idx on reviews (card_id);
create index reviews_user_id_idx on reviews (user_id);

alter table folders enable row level security;
alter table decks enable row level security;
alter table cards enable row level security;
alter table reviews enable row level security;

-- Card images: a public bucket. Uploads go through one-shot signed URLs minted
-- by the API, so no storage policies are needed for inserts.
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;
