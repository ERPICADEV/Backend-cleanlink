-- CleanLink migration: Convert JSON stored as TEXT into JSONB
-- Date: 2026-01-21
-- Run with:
--   psql $DATABASE_URL -f migrations/2026_01_21_json_text_to_jsonb.sql
--
-- Notes:
-- - This migration assumes existing values are valid JSON (or NULL/empty).
-- - Uses COALESCE/NULLIF to keep prior defaults and avoid cast errors on empty strings.
-- - Keeps business logic intact; only changes storage types.

BEGIN;

-- users
ALTER TABLE users
  ALTER COLUMN auth_providers TYPE JSONB USING COALESCE(NULLIF(auth_providers, ''), '[]')::jsonb,
  ALTER COLUMN badges TYPE JSONB USING COALESCE(NULLIF(badges, ''), '[]')::jsonb;

ALTER TABLE users
  ALTER COLUMN auth_providers SET DEFAULT '[]'::jsonb,
  ALTER COLUMN badges SET DEFAULT '[]'::jsonb;

-- reports
ALTER TABLE reports
  ALTER COLUMN images TYPE JSONB USING COALESCE(NULLIF(images, ''), '[]')::jsonb,
  ALTER COLUMN location TYPE JSONB USING COALESCE(NULLIF(location, ''), '{}')::jsonb,
  ALTER COLUMN flags TYPE JSONB USING COALESCE(NULLIF(flags, ''), '[]')::jsonb,
  ALTER COLUMN ai_score TYPE JSONB USING NULLIF(ai_score, '')::jsonb,
  ALTER COLUMN mcd_resolution TYPE JSONB USING NULLIF(mcd_resolution, '')::jsonb;

ALTER TABLE reports
  ALTER COLUMN images SET DEFAULT '[]'::jsonb,
  ALTER COLUMN location SET DEFAULT '{}'::jsonb,
  ALTER COLUMN flags SET DEFAULT '[]'::jsonb;

-- notifications
ALTER TABLE notifications
  ALTER COLUMN data TYPE JSONB USING COALESCE(NULLIF(data, ''), '{}')::jsonb;
ALTER TABLE notifications
  ALTER COLUMN data SET DEFAULT '{}'::jsonb;

-- rewards
ALTER TABLE rewards
  ALTER COLUMN metadata TYPE JSONB USING COALESCE(NULLIF(metadata, ''), '{}')::jsonb;
ALTER TABLE rewards
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

-- redemptions
ALTER TABLE redemptions
  ALTER COLUMN request_data TYPE JSONB USING COALESCE(NULLIF(request_data, ''), '{}')::jsonb;
ALTER TABLE redemptions
  ALTER COLUMN request_data SET DEFAULT '{}'::jsonb;

-- audit_logs
ALTER TABLE audit_logs
  ALTER COLUMN details TYPE JSONB USING COALESCE(NULLIF(details, ''), '{}')::jsonb;
ALTER TABLE audit_logs
  ALTER COLUMN details SET DEFAULT '{}'::jsonb;

-- report_progress
ALTER TABLE report_progress
  ALTER COLUMN photos TYPE JSONB USING COALESCE(NULLIF(photos, ''), '[]')::jsonb;
ALTER TABLE report_progress
  ALTER COLUMN photos SET DEFAULT '[]'::jsonb;

COMMIT;



