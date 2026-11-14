CREATE OR REPLACE FUNCTION pipeline_control.enqueue_edge_clear(clear_id uuid, expected_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  queued jsonb;
  started_at text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  PERFORM singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apply the pipeline control migration.'; END IF;
  PERFORM id FROM pipeline_control.jobs ORDER BY id FOR UPDATE;
  IF expected_id IS DISTINCT FROM (SELECT id FROM pipeline_control.jobs ORDER BY created_at DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Pipeline history changed. Refresh its status before clearing.';
  END IF;
  IF EXISTS (SELECT 1 FROM pipeline_control.jobs WHERE status IN ('queued','running')) THEN
    RAISE EXCEPTION 'Stop the active pipeline before clearing its data and history.';
  END IF;
  IF EXISTS (SELECT 1 FROM pipeline_control.operations WHERE status='started') THEN
    RAISE EXCEPTION 'An operation has no confirmed outcome. Inspect its logs before clearing its history.';
  END IF;
  IF EXISTS (SELECT 1 FROM pipeline_control.jobs WHERE blocked_until>now()
    OR execution_id IS NOT NULL OR execution_until IS NOT NULL) THEN
    RAISE EXCEPTION 'A run is blocked or still has an execution lease. Inspect its worker before clearing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='hackscout-edge-tick' AND active) THEN
    RAISE EXCEPTION 'Enable the existing pipeline worker before queuing Clear all.';
  END IF;
  queued := jsonb_build_object(
    'id',clear_id,'status','queued','stage','reset','purpose','clear',
    'startedAt',started_at,'stagingBackend','supabase-storage','reset','{}'::jsonb,
    'steps','{"reset":{"status":"waiting"},"scraper":{"status":"skipped"},"etl":{"status":"skipped"}}'::jsonb,
    'cursor','{"phase":"reset-storage","page":1,"afterId":null}'::jsonb
  );
  INSERT INTO pipeline_control.jobs(id,status,job,key_expires_at,executor)
    VALUES (clear_id,'queued',queued,now()+interval '24 hours','supabase');
  UPDATE pipeline_control.schedule SET value=value || '{"frequency":"off","nextRunAt":null}'::jsonb
    WHERE singleton=true;
  RETURN queued;
END
$$;

CREATE OR REPLACE FUNCTION pipeline_control.finish_edge_clear(target_id uuid, lease_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target pipeline_control.jobs%ROWTYPE;
BEGIN
  PERFORM singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE;
  PERFORM id FROM pipeline_control.jobs ORDER BY id FOR UPDATE;
  SELECT * INTO target FROM pipeline_control.jobs WHERE id=target_id;
  IF NOT FOUND OR target.status<>'running' OR target.executor<>'supabase'
    OR target.job->>'purpose' IS DISTINCT FROM 'clear'
    OR target.job->'cursor'->>'phase' IS DISTINCT FROM 'reset-postgresql'
    OR lease_id IS NULL OR target.execution_id IS DISTINCT FROM lease_id
    OR target.execution_until IS NULL OR target.execution_until<=now() THEN
    RAISE EXCEPTION 'Clear all lost its execution lease or checkpoint. Refresh its status.';
  END IF;
  IF EXISTS (SELECT 1 FROM pipeline_control.operations WHERE status='started')
    OR EXISTS (SELECT 1 FROM pipeline_control.jobs WHERE blocked_until>now()
      OR (id<>target_id AND (status IN ('queued','running')
        OR execution_id IS NOT NULL OR execution_until IS NOT NULL))) THEN
    RAISE EXCEPTION 'A run is active, blocked or has an unconfirmed operation. Its history was not cleared.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id
      AND name ~ '^reset-storage(-[1-9][0-9]*)?$' AND status='completed' AND result @> '{"reset":true}')
    OR NOT EXISTS (SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id
      AND name='reset-postgresql' AND status='completed' AND result @> '{"reset":true}') THEN
    RAISE EXCEPTION 'Clear all needs confirmed Storage and PostgreSQL cleanup before deleting history.';
  END IF;
  LOCK TABLE hackathon_research.events IN EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM hackathon_research.events) THEN
    RAISE EXCEPTION 'Event listings changed after cleanup. History was preserved; inspect before clearing again.';
  END IF;
  DELETE FROM pipeline_control.operations;
  DELETE FROM pipeline_control.jobs;
  UPDATE pipeline_control.schedule SET value='{"frequency":"off","nextRunAt":null}'::jsonb WHERE singleton=true;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.enqueue_edge_clear(uuid,uuid),
  pipeline_control.finish_edge_clear(uuid,uuid) FROM PUBLIC, anon, authenticated;
