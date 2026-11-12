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
ALTER TABLE pipeline_control.jobs ADD COLUMN IF NOT EXISTS executor text NOT NULL DEFAULT 'vercel';
ALTER TABLE pipeline_control.jobs ADD COLUMN IF NOT EXISTS execution_id uuid;
ALTER TABLE pipeline_control.jobs ADD COLUMN IF NOT EXISTS execution_until timestamptz;

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
INSERT INTO pipeline_control.schedule(singleton,value)
VALUES (true,'{"frequency":"off","nextRunAt":null}')
ON CONFLICT DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE OR REPLACE FUNCTION pipeline_control.dispatch_edge_tick()
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  gateway_url text;
  gateway_secret text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret INTO gateway_url FROM vault.decrypted_secrets
    WHERE name='hackscout_gateway_url';
  SELECT decrypted_secret INTO gateway_secret FROM vault.decrypted_secrets
    WHERE name='hackscout_gateway_secret';
  IF gateway_url IS NULL OR gateway_url !~ '^https://[^/]+/?$'
    OR gateway_secret IS NULL OR length(gateway_secret)<16 THEN
    RAISE EXCEPTION 'Configure the HTTPS gateway origin and gateway credential in Vault before scheduling.';
  END IF;
  SELECT net.http_post(
    url := rtrim(gateway_url,'/') || '/api/internal/pipeline-worker/pipeline/tick',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-gateway-caller','team-2-gateway',
      'x-gateway-secret',gateway_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) INTO request_id;
  RETURN request_id;
END
$$;

REVOKE ALL ON SCHEMA pipeline_control FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA pipeline_control FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA pipeline_control FROM PUBLIC, anon, authenticated;

-- Register the tick only after gateway/Edge deployment and Vault configuration:
-- SELECT cron.schedule('hackscout-edge-tick','* * * * *',
--   'SELECT pipeline_control.dispatch_edge_tick()');
