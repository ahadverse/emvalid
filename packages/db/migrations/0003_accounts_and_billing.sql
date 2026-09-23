-- v2, feature 25-27: accounts, sessions, plans, orders and credits.
--
-- Nothing here alters what v1 stored. `users` gains columns, all with
-- defaults, so every existing row (including the single-tenant seed owner) is
-- still valid the instant this runs and no backfill is needed.

-- ---------------------------------------------------------------- enums
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended');
CREATE TYPE order_status AS ENUM ('pending', 'paid', 'cancelled', 'refunded');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled');
CREATE TYPE credit_reason AS ENUM (
  'signup_grant',
  'purchase',
  'verification',
  'refund',
  'admin_adjustment'
);

-- ---------------------------------------------------------------- users
ALTER TABLE users
  ADD COLUMN name       text,
  ADD COLUMN role       user_role   NOT NULL DEFAULT 'user',
  ADD COLUMN status     user_status NOT NULL DEFAULT 'active',
  ADD COLUMN credits    integer     NOT NULL DEFAULT 0,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Email is compared case-insensitively everywhere in the app, so the stored
-- form is lowercased once, here, rather than trusted to every future INSERT.
UPDATE users SET email = lower(email);

-- The v1 seed owner becomes the first admin. It has no password hash, so it
-- still cannot log in — an admin sets one, or signs up fresh and is promoted.
UPDATE users
   SET role = 'admin', name = 'Owner'
 WHERE id = '00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------- sessions
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- ---------------------------------------------------------------- orders
CREATE TABLE orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id        text         NOT NULL,
  period_months  integer      NOT NULL DEFAULT 1,
  amount_taka    integer      NOT NULL,
  credits        integer      NOT NULL,
  status         order_status NOT NULL DEFAULT 'pending',
  provider       text         NOT NULL DEFAULT 'manual',
  provider_ref   text,
  note           text,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  paid_at        timestamptz,
  settled_by     uuid REFERENCES users (id) ON DELETE SET NULL,

  -- An order that grants nothing, or costs a negative amount, is a bug that
  -- would otherwise only surface as a wrong balance weeks later.
  CONSTRAINT orders_amount_non_negative CHECK (amount_taka >= 0),
  CONSTRAINT orders_credits_positive    CHECK (credits > 0),
  CONSTRAINT orders_period_positive     CHECK (period_months > 0),
  -- Paid means settled: the timestamp and the status cannot disagree.
  CONSTRAINT orders_paid_has_timestamp
    CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE INDEX orders_user_id_created_at_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx             ON orders (status);

-- ---------------------------------------------------------------- subscriptions
CREATE TABLE subscriptions (
  user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  plan_id            text                NOT NULL,
  status             subscription_status NOT NULL DEFAULT 'active',
  started_at         timestamptz         NOT NULL DEFAULT now(),
  current_period_end timestamptz         NOT NULL,
  updated_at         timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_current_period_end_idx ON subscriptions (current_period_end);

-- ---------------------------------------------------------------- credit ledger
CREATE TABLE credit_ledger (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  delta          integer       NOT NULL,
  balance_after  integer       NOT NULL,
  reason         credit_reason NOT NULL,
  -- Deliberately not a foreign key: retention deletes jobs after a week, and
  -- the accounting entry has to outlive the job it was charged for.
  job_id         uuid,
  order_id       uuid REFERENCES orders (id) ON DELETE SET NULL,
  note           text,
  created_at     timestamptz   NOT NULL DEFAULT now(),

  -- A zero-delta entry records nothing and would only pad an audit.
  CONSTRAINT credit_ledger_delta_non_zero CHECK (delta <> 0)
);

CREATE INDEX credit_ledger_user_id_created_at_idx
  ON credit_ledger (user_id, created_at DESC);
