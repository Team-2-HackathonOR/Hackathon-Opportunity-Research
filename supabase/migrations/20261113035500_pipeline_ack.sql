CREATE OR REPLACE FUNCTION pipeline_control.complete_edge_operation(
  target_id uuid,
  operation_name text,
  acknowledgement jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_status text;
  cancelled boolean;
BEGIN
  IF jsonb_typeof(acknowledgement) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Operation acknowledgement must be an object.';
  END IF;
  SELECT status,job->>'cancelled'='true' INTO target_status,cancelled
    FROM pipeline_control.jobs WHERE id=target_id AND executor='supabase' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Edge pipeline run does not exist.';
  END IF;

  UPDATE pipeline_control.operations SET status='completed',result=acknowledgement
    WHERE job_id=target_id AND name=operation_name AND status='started';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acknowledgement requires a started operation.';
  END IF;

  IF target_status='failed' AND cancelled AND NOT EXISTS (
    SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id AND status='started'
  ) THEN
    UPDATE pipeline_control.jobs SET blocked_until=NULL
      WHERE id=target_id AND blocked_until='infinity'::timestamptz
        AND execution_id IS NULL AND execution_until IS NULL AND key_ciphertext IS NULL;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.complete_edge_operation(uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
