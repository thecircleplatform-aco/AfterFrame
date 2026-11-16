-- Migration for databases created before IP capture existed.
-- `schema.sql` uses CREATE TABLE IF NOT EXISTS, so it will NOT add columns to a
-- table that is already there. Apply this once against an existing database:
--
--   npx wrangler d1 execute afterframe-auth --remote --file=auth-worker/schema-ip.sql
--
-- Safe to re-run: each ALTER is guarded by the fact that SQLite matches the
-- statement against the current table shape, so run it once and ignore the
-- "duplicate column name" error if it already has the column.

ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN country TEXT;

ALTER TABLE auth_devices ADD COLUMN ip TEXT;
ALTER TABLE auth_devices ADD COLUMN country TEXT;
