BEGIN;
CREATE TABLE IF NOT EXISTS nandhana_auth_schema (version integer PRIMARY KEY CHECK (version = 1));
CREATE TABLE IF NOT EXISTS nandhana_auth_sessions (
  session_id text PRIMARY KEY, owner uuid, fence bigint NOT NULL DEFAULT 0,
  lease_until timestamptz NOT NULL DEFAULT '-infinity', initialized boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS nandhana_auth_records (
  session_id text NOT NULL REFERENCES nandhana_auth_sessions(session_id),
  kind text NOT NULL, key_id text NOT NULL, envelope jsonb NOT NULL,
  PRIMARY KEY (session_id, kind, key_id)
);
INSERT INTO nandhana_auth_schema(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
