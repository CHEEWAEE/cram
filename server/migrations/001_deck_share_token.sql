-- Adds share links. Run once on an existing database (schema.sql already has it).
alter table decks add column if not exists share_token text unique;
