-- One-off: baseline the production drizzle migration journal.
--
-- Context: the production Neon database has the v1 schema applied
-- (`users`, `magic_tokens`, `rec_items`), but `drizzle.__drizzle_migrations`
-- is missing or empty. On deploy, drizzle tries to apply `0000_initial_schema`
-- from scratch and fails with `relation "magic_tokens" already exists`.
--
-- This script tells drizzle that 0000 is already applied. The next deploy
-- then naturally runs 0001_drop_v1_schema (drops v1 tables) and
-- 0002_v2_schema (creates v2 tables) in the same transaction.
--
-- Idempotent: safe to re-run. Hash + timestamp come from
--   apps/backend/drizzle/0000_initial_schema.sql  (sha256 of file contents)
--   apps/backend/drizzle/meta/_journal.json       (entries[0].when)
-- DO NOT edit those values — they must match drizzle's runtime inputs
-- exactly or drizzle will re-apply 0000 anyway.

CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT
  '210fa360a1e6defb5856138ff724c8842761ed2cb1f0ba935e49406b80f62858',
  1776966724611
WHERE NOT EXISTS (
  SELECT 1
  FROM drizzle.__drizzle_migrations
  WHERE hash = '210fa360a1e6defb5856138ff724c8842761ed2cb1f0ba935e49406b80f62858'
);

-- Verify. Expect exactly one row with the hash above.
SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;
