-- v1 schema. Kept hand-written and readable so it can be diffed against
-- src/schema.ts by eye; drizzle-kit can generate later migrations on top.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- SHA-256 of the key. The raw value is shown once and never stored, so a
  -- dump of this table cannot be replayed against the API.
  key_hash     text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys (user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status            job_status NOT NULL DEFAULT 'queued',
  original_filename text NOT NULL,
  input_path        text NOT NULL,
  output_path       text,
  total_rows        integer NOT NULL DEFAULT 0,
  processed_rows    integer NOT NULL DEFAULT 0,
  -- JobSummary from @ev/core. jsonb, not columns: the breakdown gains fields
  -- as the engine learns new reasons, and none of it is ever queried by shape.
  summary           jsonb,
  error             text,
  attempts          integer NOT NULL DEFAULT 0,
  worker_id         text,
  heartbeat_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  expires_at        timestamptz
);

-- The claim query orders queued jobs oldest first. Partial, because 'queued'
-- is a vanishing fraction of the table on any busy instance and there is no
-- reason to index the history.
CREATE INDEX IF NOT EXISTS jobs_status_created_at_idx ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_expires_at_idx ON jobs (expires_at);
CREATE INDEX IF NOT EXISTS jobs_user_id_created_at_idx ON jobs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS domain_cache (
  domain              text PRIMARY KEY,
  mx                  text[] NOT NULL DEFAULT '{}'::text[],
  null_mx             boolean NOT NULL DEFAULT false,
  has_address_record  boolean NOT NULL DEFAULT false,
  nxdomain            boolean NOT NULL DEFAULT false,
  provider            text,
  -- Freshness is checked_at plus a TTL applied at read time, not an expiry
  -- column, so the TTL can be retuned without rewriting every row.
  checked_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS domain_cache_checked_at_idx ON domain_cache (checked_at);
