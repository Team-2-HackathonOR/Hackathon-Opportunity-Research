-- Records outlive staging and job-row retention; only confirmed Clear all removes them.
CREATE TABLE pipeline_control.dead_letters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL,
  operation_name text NOT NULL,
  source_record_id bigint NOT NULL CHECK (source_record_id BETWEEN 0 AND 9007199254740991),
  fetched_at text NOT NULL,
  raw_record jsonb NOT NULL CHECK (jsonb_typeof(raw_record)='object'),
  error jsonb NOT NULL CHECK (jsonb_typeof(error)='object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id,operation_name)
);
CREATE INDEX dead_letters_pending_id ON pipeline_control.dead_letters(id DESC) WHERE status='pending';
ALTER TABLE pipeline_control.dead_letters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.dead_letters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE pipeline_control.dead_letters_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pipeline_control.archive_edge_dead_letter(
  target_id uuid, lease_id uuid, target_operation text, original_record jsonb
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target pipeline_control.jobs%ROWTYPE;
  acknowledgement pipeline_control.operations%ROWTYPE;
  existing pipeline_control.dead_letters%ROWTYPE;
  failure jsonb;
  source_id bigint;
BEGIN
  SELECT * INTO target FROM pipeline_control.jobs WHERE id=target_id FOR UPDATE;
  IF NOT FOUND OR target.status<>'running' OR target.executor<>'supabase'
    OR target.job->>'purpose'='clear' OR target.job->>'stagingBackend' IS DISTINCT FROM 'supabase-storage'
    OR target.job->'cursor'->>'phase' IS DISTINCT FROM 'etl'
    OR lease_id IS NULL OR target.execution_id IS DISTINCT FROM lease_id
    OR target.execution_until IS NULL OR target.execution_until<=now()
    OR target.key_ciphertext IS NULL OR target.key_expires_at<=now()
    OR target_operation IS DISTINCT FROM 'etl-' || coalesce(target.job->'cursor'->>'afterId','first') THEN
    RAISE EXCEPTION 'Dead-letter archival lost its execution lease or checkpoint.';
  END IF;
  SELECT * INTO acknowledgement FROM pipeline_control.operations
    WHERE job_id=target_id AND name=target_operation FOR UPDATE;
  IF NOT FOUND OR acknowledgement.status IS DISTINCT FROM 'completed'
    OR (acknowledgement.result @> '{"processed_count":1,"inserted_count":0,"failed_count":1}') IS DISTINCT FROM true
    OR jsonb_typeof(acknowledgement.result->'failures') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Dead-letter archival requires a confirmed one-record failure.';
  END IF;
  IF jsonb_array_length(acknowledgement.result->'failures')<>1
    OR jsonb_typeof(acknowledgement.result->'next_after_id') IS DISTINCT FROM 'number'
    OR (acknowledgement.result->>'next_after_id') !~ '^[0-9]{1,16}$' THEN
    RAISE EXCEPTION 'The confirmed failure has an invalid source record acknowledgement.';
  END IF;
  source_id := (acknowledgement.result->>'next_after_id')::bigint;
  failure := acknowledgement.result->'failures'->0;
  IF source_id>9007199254740991
    OR (target.job->'cursor'->>'afterId' IS NOT NULL AND source_id<=(target.job->'cursor'->>'afterId')::bigint)
    OR failure->'record_index' IS DISTINCT FROM '0'::jsonb
    OR failure->>'source_identifier' IS DISTINCT FROM source_id::text
    OR jsonb_typeof(failure->'reason') IS DISTINCT FROM 'string'
    OR length(failure->>'reason') NOT BETWEEN 1 AND 2000
    OR jsonb_typeof(original_record) IS DISTINCT FROM 'object'
    OR original_record->'id' IS DISTINCT FROM to_jsonb(source_id)
    OR original_record->>'fetchedAt' IS DISTINCT FROM target.job->>'startedAt'
    OR octet_length(original_record::text)>1000000
    OR (failure ? 'raw_record' AND failure->'raw_record' IS DISTINCT FROM original_record) THEN
    RAISE EXCEPTION 'The original source record does not match its confirmed failure.';
  END IF;
  INSERT INTO pipeline_control.dead_letters(job_id,operation_name,source_record_id,fetched_at,raw_record,error)
    VALUES (target_id,target_operation,source_id,target.job->>'startedAt',original_record,failure-'raw_record')
    ON CONFLICT (job_id,operation_name) DO NOTHING;
  SELECT * INTO existing FROM pipeline_control.dead_letters
    WHERE job_id=target_id AND operation_name=target_operation;
  IF existing.raw_record IS DISTINCT FROM original_record OR existing.error IS DISTINCT FROM failure-'raw_record'
    OR existing.source_record_id IS DISTINCT FROM source_id
    OR existing.fetched_at IS DISTINCT FROM target.job->>'startedAt' THEN
    RAISE EXCEPTION 'The existing dead letter changed; it does not match the acknowledged failure.';
  END IF;
  RETURN existing.id::text;
END
$$;

REVOKE ALL ON FUNCTION pipeline_control.archive_edge_dead_letter(uuid,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
