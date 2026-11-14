ALTER TABLE pipeline_control.operations
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1 CHECK (attempts>=0),
  ADD COLUMN IF NOT EXISTS retry_cycle integer NOT NULL DEFAULT 0 CHECK (retry_cycle>=0),
  ADD COLUMN IF NOT EXISTS replay_safe boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error jsonb;

CREATE TABLE pipeline_control.operation_attempts (
  job_id uuid NOT NULL REFERENCES pipeline_control.jobs(id) ON DELETE CASCADE,
  operation_name text NOT NULL,
  cycle integer NOT NULL,
  attempt integer NOT NULL,
  diagnostic jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,operation_name,cycle,attempt)
);
ALTER TABLE pipeline_control.operation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.operation_attempts FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION pipeline_control.complete_edge_operation(
  target_id uuid,operation_name text,acknowledgement jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_status text; cancelled boolean; saved pipeline_control.operations;
BEGIN
  IF jsonb_typeof(acknowledgement) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Operation acknowledgement must be an object.';
  END IF;
  SELECT status,job->>'cancelled'='true' INTO target_status,cancelled
    FROM pipeline_control.jobs WHERE id=target_id AND executor='supabase' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The Edge pipeline run does not exist.'; END IF;
  SELECT * INTO saved FROM pipeline_control.operations
    WHERE job_id=target_id AND name=operation_name FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Acknowledgement requires a started operation.'; END IF;
  IF saved.status='completed' THEN
    IF saved.result IS DISTINCT FROM acknowledgement THEN
      RAISE EXCEPTION 'Operation acknowledgement changed.';
    END IF;
    RETURN;
  END IF;
  UPDATE pipeline_control.operations SET status='completed',result=acknowledgement,
    replay_safe=false,next_attempt_at=NULL WHERE job_id=target_id AND name=operation_name AND status='started';
  IF target_status='failed' AND cancelled AND NOT EXISTS (
    SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id AND status='started'
  ) THEN
    UPDATE pipeline_control.jobs SET blocked_until=NULL
      WHERE id=target_id AND blocked_until='infinity'::timestamptz
        AND execution_id IS NULL AND execution_until IS NULL AND key_ciphertext IS NULL;
  END IF;
END $$;
REVOKE ALL ON FUNCTION pipeline_control.complete_edge_operation(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION pipeline_control.cancel_edge_job(target_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target pipeline_control.jobs; current_job jsonb; uncertain boolean; step_name text;
  finished_at text := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  PERFORM singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE;
  SELECT * INTO target FROM pipeline_control.jobs
    WHERE id=target_id AND executor='supabase' AND status IN ('queued','running') FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- The job lock fences late ETL commits. A waiting replay-safe read has no executing writer.
  UPDATE pipeline_control.operations o SET status='completed',
    result=coalesce((SELECT acknowledgement FROM pipeline_control.etl_receipts r
      WHERE r.job_id=target_id AND r.operation_name=o.name),
      jsonb_build_object('outcome','confirmed-failure','replaySafe',true,
        'code','OPERATION_STOPPED','message','Stopped before a pending retry or fenced ETL write.')),
    replay_safe=true,next_attempt_at=NULL
    WHERE o.job_id=target_id AND o.status='started' AND (
      (o.replay_safe AND target.execution_id IS NULL AND target.execution_until IS NULL)
      OR (target.job->'etlReceiptVersion'='1'::jsonb AND o.name LIKE 'etl-%'));
  SELECT EXISTS(SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id AND status='started')
    INTO uncertain;
  current_job := (target.job-'retry') || jsonb_build_object(
    'status','failed','cancelled',true,'finishedAt',finished_at,
    'error',CASE WHEN uncertain
      THEN 'Stopped by administrator. An operation may still be executing; inspect logs before clearing the restart interlock.'
      ELSE 'Stopped by administrator. Completed changes were not undone.' END);
  FOR step_name IN SELECT jsonb_object_keys(current_job->'steps') LOOP
    IF current_job->'steps'->step_name->>'status' IN ('running','waiting','retrying') THEN
      current_job := jsonb_set(current_job,ARRAY['steps',step_name],
        current_job->'steps'->step_name || jsonb_build_object(
          'status',CASE WHEN current_job->'steps'->step_name->>'status'='waiting' THEN 'skipped' ELSE 'cancelled' END,
          'finishedAt',finished_at));
    END IF;
  END LOOP;
  UPDATE pipeline_control.jobs SET status='failed',job=current_job,key_ciphertext=NULL,
    execution_id=NULL,execution_until=NULL,
    blocked_until=CASE WHEN uncertain THEN 'infinity'::timestamptz ELSE NULL END WHERE id=target_id;
  UPDATE pipeline_control.schedule SET value=value || '{"frequency":"off","nextRunAt":null}'::jsonb WHERE singleton=true;
  RETURN current_job;
END $$;
REVOKE ALL ON FUNCTION pipeline_control.cancel_edge_job(uuid) FROM PUBLIC,anon,authenticated;
