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
  DELETE FROM pipeline_control.dead_letters;
  DELETE FROM pipeline_control.operations;
  DELETE FROM pipeline_control.jobs;
  UPDATE pipeline_control.schedule SET value='{"frequency":"off","nextRunAt":null}'::jsonb WHERE singleton=true;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.finish_edge_clear(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
