CREATE OR REPLACE FUNCTION pipeline_control.advance_edge_job_to_etl(
  target_id uuid, encrypted_key text, expected_timestamp text, confirmed_record_count integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target pipeline_control.jobs%ROWTYPE;
  advanced jsonb;
  expected_page integer;
  confirmed_page integer;
  acknowledgement jsonb;
  ended_early boolean;
  advanced_at text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  PERFORM singleton FROM pipeline_control.schedule WHERE singleton=true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Apply the pipeline control migration.'; END IF;
  PERFORM id FROM pipeline_control.jobs ORDER BY id FOR UPDATE;
  SELECT * INTO target FROM pipeline_control.jobs WHERE id=target_id;
  IF NOT FOUND OR target.status<>'failed' OR target.executor<>'supabase'
    OR target.job->'cancelled' IS DISTINCT FROM 'true'::jsonb
    OR target.job->>'stagingBackend' IS DISTINCT FROM 'supabase-storage'
    OR target.job->>'purpose'='clear'
    OR target.job->'cursor'->>'phase' IS DISTINCT FROM 'scraper'
    OR target.job->'cursor'->>'afterId' IS NOT NULL
    OR coalesce((target.job->'etl'->>'processed')::integer,0)<>0 THEN
    RAISE EXCEPTION 'Choose a stopped scraper checkpoint to advance to ETL; other stages cannot be skipped.';
  END IF;
  IF target.id IS DISTINCT FROM (SELECT id FROM pipeline_control.jobs ORDER BY created_at DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Only the latest stopped run can advance; a newer run may have changed its staging data.';
  END IF;
  IF expected_timestamp IS NULL OR target.job->>'startedAt' IS DISTINCT FROM expected_timestamp THEN
    RAISE EXCEPTION 'The original run timestamp changed. Refresh its checkpoint before advancing.';
  END IF;
  IF EXISTS (SELECT 1 FROM pipeline_control.operations WHERE status='started') THEN
    RAISE EXCEPTION 'An operation has no confirmed outcome. Inspect its logs before advancing.';
  END IF;
  IF EXISTS (SELECT 1 FROM pipeline_control.jobs WHERE blocked_until>now()
    OR status IN ('queued','running') OR execution_id IS NOT NULL OR execution_until IS NOT NULL) THEN
    RAISE EXCEPTION 'A run is active, blocked or still has an execution lease. Inspect it before advancing.';
  END IF;
  IF target.job->'steps'->'reset'->>'status' IS DISTINCT FROM 'completed'
    OR NOT EXISTS (SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id AND status='completed'
      AND name ~ '^reset-storage(-[1-9][0-9]*)?$' AND result @> '{"reset":true}')
    OR NOT EXISTS (SELECT 1 FROM pipeline_control.operations WHERE job_id=target_id AND status='completed'
      AND name='reset-postgresql' AND result @> '{"reset":true}') THEN
    RAISE EXCEPTION 'Both reset cleanups must be confirmed before advancing to ETL.';
  END IF;
  IF confirmed_record_count IS NULL OR confirmed_record_count<0 OR confirmed_record_count>9998 THEN
    RAISE EXCEPTION 'The bounded staged record count was not confirmed.';
  END IF;
  expected_page := (target.job->'cursor'->>'page')::integer;
  IF expected_page IS NULL OR expected_page<1 THEN
    RAISE EXCEPTION 'The saved scraper page checkpoint is invalid.';
  END IF;
  confirmed_page := expected_page;
  SELECT result INTO acknowledgement FROM pipeline_control.operations
    WHERE job_id=target_id AND name='scrape-' || confirmed_page AND status='completed';
  IF NOT FOUND THEN
    confirmed_page := expected_page-1;
    SELECT result INTO acknowledgement FROM pipeline_control.operations
      WHERE job_id=target_id AND name='scrape-' || confirmed_page AND status='completed';
    IF NOT FOUND THEN RAISE EXCEPTION 'A confirmed scraper page is required before advancing.'; END IF;
  END IF;
  IF acknowledgement->'persisted' IS DISTINCT FROM 'true'::jsonb
    OR acknowledgement->>'fetchedAt' IS DISTINCT FROM expected_timestamp
    OR acknowledgement->'pagesPersisted' IS DISTINCT FROM '1'::jsonb
    OR acknowledgement->'runUniqueHackathonsPersisted' IS DISTINCT FROM to_jsonb(confirmed_record_count)
    OR jsonb_typeof(acknowledgement->'paginationAnalysis'->'totalPages') IS DISTINCT FROM 'number'
    OR (acknowledgement->'paginationAnalysis'->>'totalPages') !~ '^[1-9][0-9]{0,8}$' THEN
    RAISE EXCEPTION 'The staged records do not match the confirmed scraper acknowledgement. Inspect Storage before advancing.';
  END IF;
  IF (acknowledgement->'paginationAnalysis'->>'totalPages')::integer<confirmed_page THEN
    RAISE EXCEPTION 'The confirmed page exceeds source pagination; inspect its acknowledgement.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='hackscout-edge-tick' AND active) THEN
    RAISE EXCEPTION 'Enable the existing pipeline worker before advancing to ETL.';
  END IF;
  IF encrypted_key IS NULL OR length(encrypted_key)=0 THEN
    RAISE EXCEPTION 'A fresh encrypted API key is required to advance.';
  END IF;
  ended_early := confirmed_page<(acknowledgement->'paginationAnalysis'->>'totalPages')::integer
    AND confirmed_record_count<9998;
  advanced := (target.job-'error'-'finishedAt'-'cancelled'-'executionState') || jsonb_build_object(
    'status','queued','stage','etl','advancedAt',advanced_at,
    'scraper',jsonb_build_object('pagesPersisted',confirmed_page,
      'uniqueHackathonsPersisted',confirmed_record_count,'endedEarly',ended_early),
    'advanceHistory',coalesce(target.job->'advanceHistory','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'advancedAt',advanced_at,'from','scraper','to','etl','previousError',target.job->'error',
      'previousCheckpoint',target.job->'cursor','previousScraper',target.job->'scraper',
      'confirmedPage',confirmed_page,'recordsRetained',confirmed_record_count,'endedEarly',ended_early
    ))
  );
  advanced := jsonb_set(advanced,'{cursor,phase}','"etl"');
  advanced := jsonb_set(advanced,'{steps,scraper}',advanced->'steps'->'scraper' || jsonb_build_object(
    'status',CASE WHEN ended_early THEN 'skipped' ELSE 'completed' END,'finishedAt',advanced_at));
  advanced := jsonb_set(advanced,'{steps,etl}',((advanced->'steps'->'etl')-'finishedAt') || '{"status":"waiting"}'::jsonb);
  UPDATE pipeline_control.jobs SET status='queued',job=advanced,key_ciphertext=encrypted_key,
    key_expires_at=now()+interval '24 hours',execution_id=NULL,execution_until=NULL
    WHERE id=target_id AND status='failed';
  RETURN advanced;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.advance_edge_job_to_etl(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
