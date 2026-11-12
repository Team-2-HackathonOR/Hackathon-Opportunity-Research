CREATE OR REPLACE FUNCTION pipeline_control.prepare_edge_restart(target_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_status text;
BEGIN
  PERFORM singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE;
  SELECT status INTO target_status FROM pipeline_control.jobs
    WHERE id=target_id AND executor='supabase' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pipeline_control.jobs
    WHERE blocked_until>now() OR (id<>target_id AND status IN ('queued','running'))
  ) OR EXISTS (
    SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id AND status='started'
  ) THEN
    RETURN false;
  END IF;
  IF target_status IN ('queued','running') THEN
    PERFORM pipeline_control.cancel_edge_job(target_id);
  END IF;
  UPDATE pipeline_control.schedule SET value=value || '{"frequency":"off","nextRunAt":null}'::jsonb
    WHERE singleton=true;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.prepare_edge_restart(uuid) FROM PUBLIC, anon, authenticated;
