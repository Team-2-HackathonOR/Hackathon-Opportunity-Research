CREATE OR REPLACE FUNCTION pipeline_control.resume_edge_job(target_id uuid, encrypted_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target pipeline_control.jobs%ROWTYPE;
  resumed jsonb;
  step_name text;
  phase text;
  uncertain_operation text;
  resumed_at text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  PERFORM singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE;
  SELECT * INTO target FROM pipeline_control.jobs WHERE id=target_id FOR UPDATE;
  IF NOT FOUND OR target.status<>'failed' OR target.executor<>'supabase' THEN
    RAISE EXCEPTION 'Choose a stopped or failed Edge pipeline run to continue.';
  END IF;
  IF target.id IS DISTINCT FROM (SELECT id FROM pipeline_control.jobs ORDER BY created_at DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Only the latest run can continue; a newer run may have changed its staging data.';
  END IF;
  IF target.job->>'stagingBackend' IS DISTINCT FROM 'supabase-storage' THEN
    RAISE EXCEPTION 'Only Supabase Storage runs can continue; retired MongoDB checkpoints cannot be replayed.';
  END IF;
  IF target.execution_id IS NOT NULL OR target.execution_until IS NOT NULL THEN
    RAISE EXCEPTION 'The run still has an execution lease. Inspect its worker before continuing.';
  END IF;
  SELECT name INTO uncertain_operation FROM pipeline_control.operations
    WHERE job_id=target_id AND status='started' ORDER BY name LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Operation % has no confirmed outcome. Inspect its logs before continuing.', uncertain_operation;
  END IF;
  IF EXISTS (SELECT 1 FROM pipeline_control.jobs WHERE blocked_until>now()
    OR status IN ('queued','running')) THEN
    RAISE EXCEPTION 'A run is blocked or already active. Resolve that run before continuing.';
  END IF;
  phase := target.job->'cursor'->>'phase';
  IF phase IS NULL OR phase NOT IN ('reset-storage','reset-postgresql','scraper','etl') THEN
    RAISE EXCEPTION 'The saved checkpoint cannot be continued.';
  END IF;
  IF coalesce((target.job->'etl'->>'failed')::integer,0)>0 THEN
    RAISE EXCEPTION 'This checkpoint contains failed ETL records. Inspect them before continuing; they cannot be silently skipped.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='hackscout-edge-tick' AND active) THEN
    RAISE EXCEPTION 'The pipeline worker is not active. Enable the existing cron job before continuing.';
  END IF;
  IF encrypted_key IS NULL OR length(encrypted_key)=0 THEN
    RAISE EXCEPTION 'A fresh encrypted API key is required to continue.';
  END IF;

  resumed := (target.job-'error'-'finishedAt'-'cancelled'-'executionState') || jsonb_build_object(
    'status','queued','stage',CASE WHEN phase LIKE 'reset-%' THEN 'reset' ELSE phase END,
    'resumedAt',resumed_at,
    'resumeHistory',coalesce(target.job->'resumeHistory','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'resumedAt',resumed_at,'previousStatus',target.status,'previousError',target.job->'error',
      'previousFinishedAt',target.job->'finishedAt','wasCancelled',target.job->'cancelled'
    ))
  );
  FOR step_name IN SELECT jsonb_object_keys(resumed->'steps') LOOP
    IF resumed->'steps'->step_name->>'status' IS DISTINCT FROM 'completed' THEN
      resumed := jsonb_set(resumed,ARRAY['steps',step_name],
        ((resumed->'steps'->step_name)-'finishedAt') || '{"status":"waiting"}'::jsonb);
    END IF;
  END LOOP;
  UPDATE pipeline_control.jobs SET status='queued',job=resumed,
    key_ciphertext=encrypted_key,key_expires_at=now()+interval '24 hours',
    execution_id=NULL,execution_until=NULL
    WHERE id=target_id AND status='failed';
  RETURN resumed;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.resume_edge_job(uuid,text)
  FROM PUBLIC, anon, authenticated;
