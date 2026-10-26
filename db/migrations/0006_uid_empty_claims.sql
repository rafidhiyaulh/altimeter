-- On a pooled connection a GUC that was ever set with set_config(..., true) reverts to '' (not NULL) after the
-- transaction, so ''::jsonb raised "invalid input syntax for type json" in API and worker paths that audit
-- without a user. Found by the SIT (partner API ingest returned 400).
create or replace function alt.uid() returns uuid
language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
