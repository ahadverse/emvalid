-- Feature 32: export format — CSV / XLSX / JSON.
--
-- Every job before this migration was CSV, so the default backfills them
-- correctly rather than needing an UPDATE: their `output_path` already ends
-- in `.csv`, and 'csv' is exactly what that file is.

CREATE TYPE result_format AS ENUM ('csv', 'json', 'xlsx');

ALTER TABLE jobs
  ADD COLUMN result_format result_format NOT NULL DEFAULT 'csv';
