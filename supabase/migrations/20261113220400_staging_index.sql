-- Private metadata only. Original JSON remains exclusively in private Supabase Storage.
-- Requires an empty staging prefix at rollout; there is deliberately no automatic legacy backfill.
CREATE TABLE pipeline_control.staging_index (
  bucket text NOT NULL,
  prefix text NOT NULL,
  fetched_at_ms bigint NOT NULL CHECK (fetched_at_ms BETWEEN -8640000000000000 AND 8640000000000000),
  source_id bigint NOT NULL CHECK (source_id BETWEEN 0 AND 9007199254740991),
  object_name text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 250000),
  confirmed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (bucket,prefix,fetched_at_ms,source_id),
  UNIQUE (bucket,prefix,object_name),
  CHECK (object_name = fetched_at_ms::text || '_' || lpad(source_id::text,16,'0') || '.json')
);
CREATE INDEX staging_index_latest ON pipeline_control.staging_index
  (bucket,prefix,source_id,fetched_at_ms DESC);
CREATE INDEX staging_index_pending ON pipeline_control.staging_index
  (bucket,prefix,fetched_at_ms) WHERE NOT confirmed;
ALTER TABLE pipeline_control.staging_index ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.staging_index FROM PUBLIC,anon,authenticated;

-- Serialize same-run confirmations so concurrent uploads cannot exceed the unique-record cap.
CREATE FUNCTION pipeline_control.prepare_staging_object(
  target_bucket text,target_prefix text,target_ms bigint,target_source bigint,
  target_name text,target_hash text,target_size integer
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(target_bucket,target_prefix,target_ms)::text,0));
  IF NOT EXISTS (SELECT 1 FROM pipeline_control.staging_index
      WHERE bucket=target_bucket AND prefix=target_prefix AND fetched_at_ms=target_ms AND source_id=target_source)
    AND (SELECT count(*) FROM pipeline_control.staging_index
      WHERE bucket=target_bucket AND prefix=target_prefix AND fetched_at_ms=target_ms)>=9998 THEN
    RAISE EXCEPTION 'Staging run exceeds 9998 unique records.' USING ERRCODE='54000';
  END IF;
  INSERT INTO pipeline_control.staging_index(bucket,prefix,fetched_at_ms,source_id,object_name,sha256,byte_size)
    VALUES(target_bucket,target_prefix,target_ms,target_source,target_name,target_hash,target_size)
    ON CONFLICT (bucket,prefix,fetched_at_ms,source_id)
    DO UPDATE SET object_name=EXCLUDED.object_name,sha256=EXCLUDED.sha256,byte_size=EXCLUDED.byte_size,confirmed=false;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.prepare_staging_object(text,text,bigint,bigint,text,text,integer)
  FROM PUBLIC,anon,authenticated;

-- Only the exact acknowledged payload may promote its durable intent to readable metadata.
CREATE FUNCTION pipeline_control.confirm_staging_object(
  target_bucket text,target_prefix text,target_ms bigint,target_source bigint,
  target_name text,target_hash text,target_size integer
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE pipeline_control.staging_index SET confirmed=true
    WHERE bucket=target_bucket AND prefix=target_prefix AND fetched_at_ms=target_ms
      AND source_id=target_source AND object_name=target_name AND sha256=target_hash AND byte_size=target_size;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.confirm_staging_object(text,text,bigint,bigint,text,text,integer)
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION pipeline_control.require_staging_index_ready(target_bucket text,target_prefix text,target_ms bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pipeline_control.staging_index WHERE bucket=target_bucket AND prefix=target_prefix
      AND (target_ms IS NULL OR fetched_at_ms=target_ms) AND NOT confirmed) THEN
    RAISE EXCEPTION 'Staging upload/index is unconfirmed. Verify before advancing or importing.';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.require_staging_index_ready(text,text,bigint) FROM PUBLIC,anon,authenticated;
