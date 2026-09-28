CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  email_verified_at timestamptz,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  folder_name text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('SIGNUP', 'LOGIN')),
  code_hash text NOT NULL,
  display_name text,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_email_idx ON otp_challenges (lower(email), created_at DESC);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL DEFAULT 'USER' CHECK (kind IN ('USER', 'ADMIN')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  user_agent text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- short-lived token proving the family credential was validated (onboarding step)
CREATE TABLE onboarding_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count int NOT NULL
);

CREATE TABLE packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  sequence_no int NOT NULL,
  target_bytes bigint NOT NULL,
  state text NOT NULL DEFAULT 'DIRTY' CHECK (state IN ('READY', 'DIRTY', 'BUILDING', 'FAILED')),
  dirty_reason text CHECK (dirty_reason IN ('ADD', 'DELETE')),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sequence_no)
);

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploader_user_id uuid NOT NULL REFERENCES users(id),
  sha256 char(64) NOT NULL UNIQUE,
  original_filename text NOT NULL,
  stored_filename text NOT NULL,
  relative_path text NOT NULL UNIQUE,
  byte_size bigint NOT NULL,
  mime_reported text,
  mime_detected text,
  media_kind text NOT NULL CHECK (media_kind IN ('IMAGE', 'VIDEO', 'OTHER')),
  capture_at timestamptz,
  capture_at_source text,
  sort_at timestamptz NOT NULL,
  client_last_modified timestamptz,
  width int,
  height int,
  duration_ms int,
  metadata_json jsonb,
  thumbnail_state text NOT NULL DEFAULT 'PENDING' CHECK (thumbnail_state IN ('PENDING', 'READY', 'FAILED', 'UNSUPPORTED')),
  preview_state text NOT NULL DEFAULT 'NONE',
  package_id uuid REFERENCES packages(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_sort_idx ON media (sort_at, id) WHERE deleted_at IS NULL;
CREATE INDEX media_uploader_idx ON media (uploader_user_id, sort_at, id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX media_folder_name_uq ON media (uploader_user_id, lower(stored_filename));

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  original_filename text NOT NULL,
  mime_reported text,
  client_last_modified timestamptz,
  expected_size bigint NOT NULL CHECK (expected_size >= 0),
  received_size bigint NOT NULL DEFAULT 0,
  fingerprint text,
  client_sha256 char(64),
  state text NOT NULL DEFAULT 'UPLOADING'
    CHECK (state IN ('UPLOADING', 'VERIFYING', 'FINALIZING', 'COMPLETE', 'DUPLICATE', 'RESTORED', 'FAILED', 'CANCELLED')),
  media_id uuid REFERENCES media(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failure_reason text
);
CREATE INDEX uploads_user_fp_idx ON uploads (user_id, fingerprint) WHERE state = 'UPLOADING';
CREATE INDEX uploads_state_idx ON uploads (state, created_at);

CREATE TABLE package_items (
  package_id uuid NOT NULL REFERENCES packages(id),
  media_id uuid NOT NULL REFERENCES media(id) UNIQUE,
  ordinal int NOT NULL,
  PRIMARY KEY (package_id, media_id)
);

CREATE TABLE package_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES packages(id),
  version_no int NOT NULL,
  relative_path text,
  byte_size bigint,
  checksum text,
  item_count int,
  state text NOT NULL DEFAULT 'BUILDING' CHECK (state IN ('BUILDING', 'READY', 'FAILED', 'RETIRED', 'REMOVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (package_id, version_no)
);
ALTER TABLE packages ADD CONSTRAINT packages_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES package_versions(id);

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  dedupe_key text,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  priority int NOT NULL DEFAULT 100,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX jobs_claim_idx ON jobs (priority, available_at, id) WHERE state = 'PENDING';
-- at most one pending job per dedupe key (e.g. "package:<id>")
CREATE UNIQUE INDEX jobs_dedupe_pending_uq ON jobs (dedupe_key) WHERE state = 'PENDING' AND dedupe_key IS NOT NULL;

CREATE TABLE notification_activity (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  media_id uuid NOT NULL REFERENCES media(id),
  media_kind text NOT NULL,
  byte_size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  digest_id uuid
);
CREATE INDEX notif_pending_idx ON notification_activity (created_at) WHERE digest_id IS NULL;

CREATE TABLE notification_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
  digest_id uuid NOT NULL REFERENCES notification_digests(id),
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  sent_at timestamptz,
  error text,
  PRIMARY KEY (digest_id, recipient_user_id)
);

CREATE TABLE download_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  media_id uuid REFERENCES media(id),
  package_version_id uuid REFERENCES package_versions(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  bytes bigint
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  user_id uuid REFERENCES users(id),
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_type_time_idx ON audit_events (type, created_at);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_reports (
  report_date date PRIMARY KEY,
  sent_at timestamptz
);
