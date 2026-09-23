-- v1 has no accounts — that is feature 25, in v2 — but `jobs.user_id` and
-- `api_keys.user_id` are real foreign keys. Without an owner row the very
-- first upload fails on a constraint, which is a confusing way to learn that
-- the product has no login yet.
--
-- So the owner is seeded here with a fixed id. The web app attributes
-- everything to it (`EV_USER_ID`, defaulting to this same uuid), and when
-- accounts arrive every existing job and key already points at a valid user
-- and needs no backfill.

INSERT INTO users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'owner@localhost')
ON CONFLICT (id) DO NOTHING;
