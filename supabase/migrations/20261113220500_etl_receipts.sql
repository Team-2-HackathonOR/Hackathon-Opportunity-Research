-- Private atomic ACKs; deleting a pipeline job clears its receipts.
CREATE TABLE pipeline_control.etl_receipts (
  job_id uuid NOT NULL REFERENCES pipeline_control.jobs(id) ON DELETE CASCADE,
  operation_name text NOT NULL,
  fetched_at text NOT NULL,
  after_id bigint,
  source_id bigint,
  source_hash text NOT NULL,
  source_sha256 text,
  acknowledgement jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,operation_name)
);
ALTER TABLE pipeline_control.etl_receipts ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION pipeline_control.etl_import_context(
  p_job uuid,p_operation text,p_execution uuid,p_fetched_at text,p_after bigint
) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j pipeline_control.jobs; r pipeline_control.etl_receipts;
BEGIN
  SELECT * INTO j FROM pipeline_control.jobs WHERE id=p_job FOR UPDATE;
  IF NOT FOUND OR j.executor<>'supabase' OR j.status NOT IN ('running','queued')
    OR j.execution_id IS DISTINCT FROM p_execution OR p_execution IS NULL
    OR j.execution_until IS NULL OR j.execution_until<=clock_timestamp()
    OR j.key_expires_at<=clock_timestamp() OR j.key_ciphertext IS NULL
    OR j.job->>'startedAt' IS DISTINCT FROM p_fetched_at
    OR j.job->'cursor'->>'phase' IS DISTINCT FROM 'etl'
    OR (j.job->'cursor'->>'afterId')::bigint IS DISTINCT FROM p_after
    OR p_operation IS DISTINCT FROM 'etl-'||coalesce(p_after::text,'first')
    OR NOT EXISTS(SELECT 1 FROM pipeline_control.operations
      WHERE job_id=p_job AND name=p_operation AND status='started') THEN
    RAISE EXCEPTION 'Invalid ETL pipeline context';
  END IF;
  SELECT * INTO r FROM pipeline_control.etl_receipts WHERE job_id=p_job AND operation_name=p_operation;
  IF FOUND THEN
    IF r.fetched_at IS DISTINCT FROM p_fetched_at OR r.after_id IS DISTINCT FROM p_after THEN
      RAISE EXCEPTION 'ETL receipt context conflict';
    END IF;
    RETURN r.acknowledgement;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION pipeline_control.etl_source_context(
  p_fetched_at text,p_after bigint,p_bucket text,p_prefix text,p_source jsonb,p_sha256 text
) RETURNS bigint LANGUAGE plpgsql SET search_path='' AS $$
DECLARE selected pipeline_control.staging_index; run_ms bigint;
BEGIN
  run_ms := floor(extract(epoch FROM p_fetched_at::timestamptz)*1000)::bigint;
  PERFORM pipeline_control.require_staging_index_ready(p_bucket,p_prefix,run_ms);
  SELECT * INTO selected FROM pipeline_control.staging_index
    WHERE bucket=p_bucket AND prefix=p_prefix AND fetched_at_ms=run_ms AND confirmed
      AND (p_after IS NULL OR source_id>p_after) ORDER BY source_id LIMIT 1 FOR SHARE;
  IF p_source='null'::jsonb THEN
    IF FOUND OR p_sha256 IS NOT NULL THEN RAISE EXCEPTION 'ETL empty source conflict'; END IF;
    RETURN NULL;
  END IF;
  IF NOT FOUND OR p_source IS NULL OR jsonb_typeof(p_source)<>'object'
    OR jsonb_typeof(p_source->'id') IS DISTINCT FROM 'number'
    OR (p_source->>'id')::bigint IS DISTINCT FROM selected.source_id
    OR floor(extract(epoch FROM (p_source->>'fetchedAt')::timestamptz)*1000)::bigint IS DISTINCT FROM run_ms
    OR p_sha256 IS DISTINCT FROM selected.sha256 THEN
    RAISE EXCEPTION 'ETL source conflict';
  END IF;
  RETURN selected.source_id;
END $$;

CREATE FUNCTION pipeline_control.save_etl_receipt(
  p_job uuid,p_operation text,p_execution uuid,p_fetched_at text,p_after bigint,
  p_bucket text,p_prefix text,p_source jsonb,p_sha256 text,p_receipt jsonb
) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE existing jsonb; source_id bigint; n integer; success jsonb; source_hash text;
BEGIN
  existing := pipeline_control.etl_import_context(p_job,p_operation,p_execution,p_fetched_at,p_after);
  source_id := pipeline_control.etl_source_context(p_fetched_at,p_after,p_bucket,p_prefix,p_source,p_sha256);
  source_hash := md5(p_source::text);
  n := CASE WHEN source_id IS NULL THEN 0 ELSE 1 END;
  success := p_receipt->'successes'->0;
  IF p_receipt IS NULL OR jsonb_typeof(p_receipt)<>'object'
    OR p_receipt->>'source' IS DISTINCT FROM 'storage'
    OR p_receipt->'receipt_bound' IS DISTINCT FROM 'true'::jsonb
    OR p_receipt->'processed_count' IS DISTINCT FROM to_jsonb(n)
    OR p_receipt->'inserted_count' IS DISTINCT FROM to_jsonb(n)
    OR p_receipt->'failed_count' IS DISTINCT FROM '0'::jsonb
    OR p_receipt->'failures' IS DISTINCT FROM '[]'::jsonb
    OR p_receipt->'next_after_id' IS DISTINCT FROM coalesce(to_jsonb(source_id),'null'::jsonb)
    OR jsonb_typeof(p_receipt->'successes') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_receipt->'successes')<>n
    OR (n=1 AND (success->'record_index' IS DISTINCT FROM '0'::jsonb
      OR success->>'source_identifier' IS DISTINCT FROM source_id::text
      OR jsonb_typeof(success->'event_id') IS DISTINCT FROM 'number'
      OR NOT EXISTS(SELECT 1 FROM hackathon_research.events e
        WHERE e.event_id=(success->>'event_id')::bigint
          AND e.event_name=success->>'event_name'))) THEN
    RAISE EXCEPTION 'Invalid ETL acknowledgement';
  END IF;
  -- No extra fields: receipts cannot become a channel for provider credentials.
  IF p_receipt - ARRAY['receipt_bound','source','processed_count','inserted_count','failed_count','successes','failures','next_after_id'] <> '{}'::jsonb
    OR (n=1 AND success - ARRAY['record_index','source_identifier','event_id','event_name'] <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Unexpected ETL acknowledgement fields';
  END IF;
  IF existing IS NOT NULL THEN
    IF existing IS DISTINCT FROM p_receipt OR NOT EXISTS(SELECT 1 FROM pipeline_control.etl_receipts r
      WHERE r.job_id=p_job AND r.operation_name=p_operation
        AND r.source_id IS NOT DISTINCT FROM source_id AND r.source_hash=source_hash
        AND r.source_sha256 IS NOT DISTINCT FROM p_sha256) THEN
      RAISE EXCEPTION 'ETL receipt payload conflict';
    END IF;
    RETURN;
  END IF;
  INSERT INTO pipeline_control.etl_receipts(job_id,operation_name,fetched_at,after_id,source_id,source_hash,source_sha256,acknowledgement)
    VALUES(p_job,p_operation,p_fetched_at,p_after,source_id,source_hash,p_sha256,p_receipt);
END $$;

REVOKE ALL ON pipeline_control.etl_receipts FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION pipeline_control.etl_import_context(uuid,text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION pipeline_control.etl_source_context(text,bigint,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION pipeline_control.save_etl_receipt(uuid,text,uuid,text,bigint,text,text,jsonb,text,jsonb)
  FROM PUBLIC,anon,authenticated;
