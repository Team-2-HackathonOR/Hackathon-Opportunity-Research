CREATE SCHEMA IF NOT EXISTS pipeline_control;

CREATE TABLE IF NOT EXISTS pipeline_control.jobs (
  id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  job jsonb NOT NULL,
  key_ciphertext text,
  key_expires_at timestamptz NOT NULL,
  workflow_id text,
  blocked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_pipeline
  ON pipeline_control.jobs ((true)) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS pipeline_control.operations (
  job_id uuid NOT NULL REFERENCES pipeline_control.jobs(id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed')),
  result jsonb,
  PRIMARY KEY (job_id, name)
);

CREATE TABLE IF NOT EXISTS pipeline_control.schedule (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  value jsonb NOT NULL
);
INSERT INTO pipeline_control.schedule(singleton, value)
VALUES (true, '{"frequency":"off","nextRunAt":null}')
ON CONFLICT DO NOTHING;

REVOKE ALL ON SCHEMA pipeline_control FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA pipeline_control FROM PUBLIC;
DO $$
DECLARE browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA pipeline_control FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA pipeline_control FROM %I', browser_role);
    END IF;
  END LOOP;
END
$$;
