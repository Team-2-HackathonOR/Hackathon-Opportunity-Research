CREATE OR REPLACE FUNCTION pipeline_control.cancel_edge_job(target_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_job jsonb;
  uncertain boolean;
  step_name text;
  finished_at text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  PERFORM singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE;
  SELECT job INTO current_job FROM pipeline_control.jobs
    WHERE id=target_id AND executor='supabase' AND status IN ('queued','running')
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id AND status='started'
  ) INTO uncertain;

  current_job := current_job || jsonb_build_object(
    'status','failed','cancelled',true,'finishedAt',finished_at,
    'error', CASE WHEN uncertain
      THEN 'Stopped by administrator. An operation may still be executing; inspect logs before clearing the restart interlock.'
      ELSE 'Stopped by administrator. Completed changes were not undone.' END
  );
  FOR step_name IN SELECT jsonb_object_keys(current_job->'steps') LOOP
    IF current_job->'steps'->step_name->>'status' IN ('running','waiting') THEN
      current_job := jsonb_set(current_job, ARRAY['steps',step_name],
        (current_job->'steps'->step_name) || jsonb_build_object(
          'status', CASE WHEN current_job->'steps'->step_name->>'status'='running'
            THEN 'cancelled' ELSE 'skipped' END,
          'finishedAt',finished_at
        ));
    END IF;
  END LOOP;

  UPDATE pipeline_control.jobs SET status='failed',job=current_job,key_ciphertext=NULL,
    execution_id=NULL,execution_until=NULL,
    blocked_until=CASE WHEN uncertain THEN 'infinity'::timestamptz ELSE blocked_until END
    WHERE id=target_id;
  UPDATE pipeline_control.schedule SET value=value || '{"frequency":"off","nextRunAt":null}'::jsonb
    WHERE singleton=true;
  RETURN current_job;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.cancel_edge_job(uuid) FROM PUBLIC, anon, authenticated;
