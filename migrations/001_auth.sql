BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(1647083441);
DO $$ BEGIN
  IF to_regclass('nandhana_auth_schema') IS NOT NULL THEN
    IF (SELECT count(*) FROM nandhana_auth_schema) <> 1 OR NOT EXISTS (SELECT 1 FROM nandhana_auth_schema WHERE version=1) THEN
      RAISE EXCEPTION 'Unsupported Nandhana auth schema version';
    END IF;
  END IF;
END $$;
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
