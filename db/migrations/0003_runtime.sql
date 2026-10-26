-- Runtime: ledgers, limits, the scoring queue, worker functions and the user-facing write functions.
-- Every function is SECURITY DEFINER with a pinned search_path and checks the caller itself; EXECUTE is
-- granted per role, never to PUBLIC.

-- ------------------------------------------------------------------ append-only, hash-chained ledgers
create or replace function alt.chain_hash(p_prev text, p_payload jsonb) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_prev || '|' || p_payload::text, 'UTF8')), 'hex')
$$;

create or replace function alt.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'alt.% is append-only', tg_table_name using errcode = '42501';
end $$;

drop trigger if exists no_change on alt.reviews;
create trigger no_change before update or delete on alt.reviews for each row execute function alt.forbid_change();
drop trigger if exists no_truncate on alt.reviews;
create trigger no_truncate before truncate on alt.reviews for each statement execute function alt.forbid_change();
drop trigger if exists no_change on alt.audit_log;
create trigger no_change before update or delete on alt.audit_log for each row execute function alt.forbid_change();
drop trigger if exists no_truncate on alt.audit_log;
create trigger no_truncate before truncate on alt.audit_log for each statement execute function alt.forbid_change();

-- One writer at a time per chain (transaction-scoped advisory lock), so parallel writers still form one line.
create or replace function alt.audit(p_kind text, p_action text, p_target text, p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path = alt, pg_temp as $$
declare prev record; payload jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('alt.audit_log'));
  select seq, hash into prev from alt.audit_log order by seq desc limit 1;
  payload := jsonb_build_object('actor', alt.uid(), 'kind', p_kind, 'action', p_action, 'target', p_target, 'detail', p_detail);
  insert into alt.audit_log (seq, actor, actor_kind, action, target, detail, prev_hash, hash)
  values (coalesce(prev.seq, 0) + 1, alt.uid(), p_kind, p_action, p_target, p_detail,
          coalesce(prev.hash, 'genesis'), alt.chain_hash(coalesce(prev.hash, 'genesis'), payload));
end $$;

-- Recompute both chains; returns the first broken sequence number, or null when intact.
create or replace function alt.verify_chains() returns jsonb
language plpgsql stable security definer set search_path = alt, pg_temp as $$
declare r record; prev text := 'genesis'; bad_audit bigint; bad_review bigint; n_a int := 0; n_r int := 0;
begin
  for r in select * from alt.audit_log order by seq loop
    n_a := n_a + 1;
    if r.prev_hash <> prev or r.hash <> alt.chain_hash(prev, jsonb_build_object('actor', r.actor, 'kind', r.actor_kind,
       'action', r.action, 'target', r.target, 'detail', r.detail)) then bad_audit := r.seq; exit; end if;
    prev := r.hash;
  end loop;
  prev := 'genesis';
  for r in select * from alt.reviews order by seq loop
    n_r := n_r + 1;
    if r.prev_hash <> prev or r.hash <> alt.chain_hash(prev, jsonb_build_object('essay', r.essay_id, 'reviewer', r.reviewer,
       'reason', r.reason, 'tr', r.tr, 'cc', r.cc, 'lr', r.lr, 'gra', r.gra, 'overall', r.overall, 'ai', r.ai_overall,
       'note', r.note)) then bad_review := r.seq; exit; end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('audit_rows', n_a, 'audit_broken_at', bad_audit, 'review_rows', n_r, 'review_broken_at', bad_review);
end $$;

-- ------------------------------------------------------------------ limits
-- Fixed-window counter shared by every server instance.
create or replace function alt.hit(p_key text, p_max int, p_window_s int) returns boolean
language plpgsql security definer set search_path = alt, pg_temp as $$
declare h int;
begin
  insert into alt.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_s) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_s) then now() else r.window_start end
  returning hits into h;
  return h <= p_max;
end $$;

-- Token bucket for LLM calls (per user and global): refills continuously, never above capacity.
create or replace function alt.take_token(p_key text, p_capacity double precision, p_refill_per_hour double precision)
returns boolean language plpgsql security definer set search_path = alt, pg_temp as $$
declare t double precision;
begin
  insert into alt.token_buckets as b (key, tokens, updated_at) values (p_key, p_capacity, now())
  on conflict (key) do update set
    tokens = least(p_capacity, b.tokens + extract(epoch from now() - b.updated_at) / 3600.0 * p_refill_per_hour),
    updated_at = now()
  returning tokens into t;
  if t < 1 then return false; end if;
  update alt.token_buckets set tokens = tokens - 1 where key = p_key;
  return true;
end $$;

-- ------------------------------------------------------------------ queue
select pgmq.create('alt_jobs') where not exists (select 1 from pgmq.list_queues() where queue_name = 'alt_jobs');
select pgmq.create('alt_jobs_dlq') where not exists (select 1 from pgmq.list_queues() where queue_name = 'alt_jobs_dlq');

create or replace function alt.enqueue_score(p_essay uuid, p_rescore boolean default false) returns bigint
language sql security definer set search_path = alt, pg_temp as $$
  select pgmq.send('alt_jobs', jsonb_build_object('kind', 'score', 'essay_id', p_essay, 'rescore', p_rescore))
$$;

-- Coalesced: a learner already waiting for a readiness job does not get a second one.
create or replace function alt.enqueue_readiness(p_student int) returns boolean
language plpgsql security definer set search_path = alt, pg_temp as $$
begin
  insert into alt.readiness_pending (student_id) values (p_student) on conflict do nothing;
  if not found then return false; end if;
  perform pgmq.send('alt_jobs', jsonb_build_object('kind', 'readiness', 'student_id', p_student));
  return true;
end $$;

create or replace function alt.q_read(p_vt int default 60, p_qty int default 10)
returns setof pgmq.message_record language sql security definer set search_path = alt, pg_temp as $$
  select * from pgmq.read('alt_jobs', p_vt, p_qty)
$$;

create or replace function alt.q_delete(p_msg bigint) returns boolean
language sql security definer set search_path = alt, pg_temp as $$ select pgmq.delete('alt_jobs', p_msg) $$;

-- After p_max failed reads the message moves to the dead-letter queue, so one poison message never jams the line.
create or replace function alt.q_fail(p_msg bigint, p_read_ct int, p_error text, p_max int default 3) returns text
language plpgsql security definer set search_path = alt, pg_temp as $$
declare m jsonb;
begin
  if p_read_ct < p_max then return 'retry'; end if;
  select message into m from pgmq.q_alt_jobs where msg_id = p_msg;
  if m is null then return 'gone'; end if;
  perform pgmq.send('alt_jobs_dlq', m || jsonb_build_object('error', left(p_error, 500), 'read_ct', p_read_ct, 'failed_at', now()));
  perform pgmq.delete('alt_jobs', p_msg);
  if m ->> 'kind' = 'readiness' then delete from alt.readiness_pending where student_id = (m ->> 'student_id')::int; end if;
  return 'dead';
end $$;

create or replace function alt.q_stats() returns jsonb
language sql security definer set search_path = alt, pg_temp as $$
  select jsonb_build_object(
    'depth', (select queue_length from pgmq.metrics('alt_jobs')),
    'oldest_s', (select oldest_msg_age_sec from pgmq.metrics('alt_jobs')),
    'total', (select total_messages from pgmq.metrics('alt_jobs')),
    'dlq', (select queue_length from pgmq.metrics('alt_jobs_dlq')))
$$;

create or replace function alt.dlq_list(p_limit int default 20) returns table (msg_id bigint, enqueued_at timestamptz, message jsonb)
language sql security definer set search_path = alt, pg_temp as $$
  select msg_id, enqueued_at, message from pgmq.q_alt_jobs_dlq where alt.my_role() = 'platform' order by msg_id desc limit p_limit
$$;

create or replace function alt.dlq_replay() returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare r record; n int := 0;
begin
  if alt.my_role() <> 'platform' then raise exception 'platform only' using errcode = '42501'; end if;
  for r in select msg_id, message from pgmq.q_alt_jobs_dlq loop
    perform pgmq.send('alt_jobs', r.message - 'error' - 'read_ct' - 'failed_at');
    perform pgmq.delete('alt_jobs_dlq', r.msg_id);
    n := n + 1;
  end loop;
  perform alt.audit('user', 'dlq_replay', null, jsonb_build_object('messages', n));
  return n;
end $$;

-- ------------------------------------------------------------------ worker functions
create or replace function alt.worker_run_start(p_worker text, p_trigger text) returns bigint
language sql security definer set search_path = alt, pg_temp as $$
  insert into alt.worker_runs (worker, trigger) values (p_worker, p_trigger) returning id
$$;

create or replace function alt.worker_run_end(p_id bigint, p_processed int, p_failed int) returns void
language sql security definer set search_path = alt, pg_temp as $$
  update alt.worker_runs set ended_at = now(), processed = p_processed, failed = p_failed where id = p_id
$$;

create or replace function alt.w_essay(p_essay uuid) returns jsonb
language sql stable security definer set search_path = alt, pg_temp as $$
  select jsonb_build_object('id', e.id, 'student_id', e.student_id, 'status', e.status, 'body', e.body, 'prompt', p.body,
    'submitted_at', e.submitted_at, 'current_version', s.model_version)
  from alt.essays e join alt.prompts p on p.id = e.prompt_id
  left join alt.essay_scores s on s.essay_id = e.id and s.valid_to is null
  where e.id = p_essay
$$;

-- Exactly-once effect under at-least-once delivery: a duplicate delivery for a version that is already
-- current is a no-op; a real re-score closes the old row first, and the partial unique index
-- essay_scores_one_current rejects any second "current" row a racing worker might try to add.
create or replace function alt.record_score(p_essay uuid, p_version text, p_rescore boolean, p_s jsonb, p_worker text)
returns text language plpgsql security definer set search_path = alt, pg_temp as $$
declare e alt.essays; cur alt.essay_scores; audit_draw double precision; reasons text;
begin
  select * into e from alt.essays where id = p_essay for update;
  if not found then return 'missing'; end if;
  if e.body is null then return 'purged'; end if;
  select * into cur from alt.essay_scores where essay_id = p_essay and valid_to is null;
  if found and cur.model_version = p_version and not p_rescore then return 'duplicate'; end if;
  if found then update alt.essay_scores set valid_to = now() where id = cur.id; end if;
  insert into alt.essay_scores (essay_id, model_version, tr, cc, lr, gra, overall, overall_raw, lo80, hi80, flags, drivers, scored_by)
  values (p_essay, p_version, (p_s->>'tr')::numeric, (p_s->>'cc')::numeric, (p_s->>'lr')::numeric, (p_s->>'gra')::numeric,
          (p_s->>'overall')::numeric, (p_s->>'overall_raw')::float8, (p_s->>'lo80')::numeric, (p_s->>'hi80')::numeric,
          coalesce(array(select jsonb_array_elements_text(p_s->'flags')), '{}'), coalesce(p_s->'drivers', '[]'), p_worker);
  update alt.essays set status = 'scored' where id = p_essay;
  -- the AI score is also a writing observation for the readiness forecast
  insert into alt.attempts (student_id, skill, source, band, taken_at, essay_id, via)
  values (e.student_id, 'writing', 'ai_writing', (p_s->>'overall')::numeric, e.submitted_at, p_essay, 'worker')
  on conflict (essay_id, taken_at) do update set band = excluded.band;
  -- human review: 10% random audit, chosen by a hash of the essay id (not by the score), plus low-confidence essays
  audit_draw := ('x' || substr(md5(p_essay::text), 1, 8))::bit(32)::bigint / 4294967296.0;
  reasons := case when audit_draw < 0.10 then 'random_audit'
                  when p_s->'flags' ?| array['too_short', 'off_topic', 'template_heavy', 'unusual_vocabulary'] then 'low_confidence'
                  else null end;
  if reasons is not null then
    insert into alt.review_queue (essay_id, reason) values (p_essay, reasons) on conflict do nothing;
  end if;
  perform alt.enqueue_readiness(e.student_id);
  return 'scored';
end $$;

create or replace function alt.score_failed(p_essay uuid) returns void
language sql security definer set search_path = alt, pg_temp as $$
  update alt.essays set status = 'failed' where id = p_essay and status = 'queued'
$$;

-- Everything the readiness forecast needs for one learner, in one round trip.
create or replace function alt.w_learner(p_student int) returns jsonb
language sql stable security definer set search_path = alt, pg_temp as $$
  select jsonb_build_object(
    'student_id', s.id,
    'target', jsonb_build_object('overall', c.target_overall, 'minSkill', c.target_min_skill,
                                 'deadline', extract(epoch from (c.deadline::timestamp at time zone 'Asia/Jakarta')) * 1000),
    'obs', coalesce((select jsonb_agg(jsonb_build_object('skill', a.skill, 'source', a.source, 'band', a.band,
                       'at', extract(epoch from a.taken_at) * 1000) order by a.taken_at)
                     from alt.attempts a where a.student_id = s.id), '[]'),
    'calibration', (select jsonb_build_object('id', k.id, 'entries', k.entries) from alt.calibrations k where k.active))
  from alt.students s join alt.cohorts c on c.id = s.cohort_id
  where s.id = p_student
$$;

create or replace function alt.record_readiness(p_student int, p_r jsonb, p_worker text) returns void
language plpgsql security definer set search_path = alt, pg_temp as $$
begin
  delete from alt.readiness_pending where student_id = p_student;
  update alt.readiness set valid_to = now() where student_id = p_student and valid_to is null;
  insert into alt.readiness (student_id, model_version, calibration_id, status, p_target, p_overall, overall_now,
    overall_at_deadline, weeks_left, binding, priority, recoverable, skills, computed_by)
  values (p_student, p_r->>'version', (p_r->>'calibration_id')::int, p_r->>'status', (p_r->>'pTarget')::float8,
    (p_r->>'pOverall')::float8, (p_r->>'overallNow')::numeric, (p_r->>'overallAtDeadline')::float8,
    (p_r->>'weeksLeft')::float8, p_r->>'binding', (p_r->>'priority')::float8, (p_r->>'recoverable')::boolean,
    p_r->'skills', p_worker);
end $$;

-- ------------------------------------------------------------------ user-facing writes
-- A learner submits an essay: stored, hashed, queued for scoring. 5 essays per 10 minutes per learner.
create or replace function alt.submit_essay(p_prompt int, p_body text, p_words int) returns uuid
language plpgsql security definer set search_path = alt, pg_temp as $$
declare st alt.students; id uuid;
begin
  if alt.my_role() <> 'student' then raise exception 'learners only' using errcode = '42501'; end if;
  select * into st from alt.students where user_id = alt.uid() and erased_at is null;
  if not found then raise exception 'no learner record' using errcode = '42501'; end if;
  if length(p_body) not between 200 and 12000 then raise exception 'essay length out of range' using errcode = '22023'; end if;
  if not exists (select 1 from alt.prompts where id = p_prompt) then raise exception 'unknown prompt' using errcode = '22023'; end if;
  if not alt.hit('essay:' || st.id, 5, 600) then raise exception 'too many essays, try again in a few minutes' using errcode = '22023'; end if;
  insert into alt.essays (student_id, prompt_id, body, word_count, body_sha256, via)
  values (st.id, p_prompt, p_body, p_words, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), 'app') returning essays.id into id;
  perform alt.enqueue_score(id);
  perform alt.audit('user', 'essay_submit', id::text, jsonb_build_object('words', p_words));
  return id;
end $$;

-- Teacher score for one essay, appended to the hash-chained ledger with the AI score in force at that time.
create or replace function alt.submit_review(p_essay uuid, p_tr numeric, p_cc numeric, p_lr numeric, p_gra numeric, p_note text)
returns bigint language plpgsql security definer set search_path = alt, pg_temp as $$
declare e alt.essays; cur alt.essay_scores; prev record; q alt.review_queue; ov numeric; payload jsonb; n bigint;
begin
  if alt.my_role() not in ('teacher', 'inst_admin', 'platform') then raise exception 'teachers only' using errcode = '42501'; end if;
  select * into e from alt.essays where id = p_essay;
  if not found or not alt.can_see_student(e.student_id) then raise exception 'not found' using errcode = '42501'; end if;
  if least(p_tr, p_cc, p_lr, p_gra) < 1 or greatest(p_tr, p_cc, p_lr, p_gra) > 9
     or (p_tr * 2) % 1 <> 0 or (p_cc * 2) % 1 <> 0 or (p_lr * 2) % 1 <> 0 or (p_gra * 2) % 1 <> 0 then
    raise exception 'bands must be 1 to 9 in half steps' using errcode = '22023';
  end if;
  select * into cur from alt.essay_scores where essay_id = p_essay and valid_to is null;
  select * into q from alt.review_queue where essay_id = p_essay;
  ov := floor((p_tr + p_cc + p_lr + p_gra) / 4 * 2 + 0.5) / 2;
  perform pg_advisory_xact_lock(hashtext('alt.reviews'));
  select seq, hash into prev from alt.reviews order by seq desc limit 1;
  payload := jsonb_build_object('essay', p_essay, 'reviewer', alt.uid(), 'reason', coalesce(q.reason, 'appeal'), 'tr', p_tr,
    'cc', p_cc, 'lr', p_lr, 'gra', p_gra, 'overall', ov, 'ai', cur.overall, 'note', nullif(left(p_note, 500), ''));
  n := coalesce(prev.seq, 0) + 1;
  insert into alt.reviews (seq, essay_id, reviewer, reason, tr, cc, lr, gra, overall, ai_overall, ai_model_version, note, prev_hash, hash)
  values (n, p_essay, alt.uid(), coalesce(q.reason, 'appeal'), p_tr, p_cc, p_lr, p_gra, ov, cur.overall, cur.model_version,
          nullif(left(p_note, 500), ''), coalesce(prev.hash, 'genesis'), alt.chain_hash(coalesce(prev.hash, 'genesis'), payload));
  insert into alt.review_queue (essay_id, reason, done_at) values (p_essay, 'appeal', now())
  on conflict (essay_id) do update set done_at = now();
  perform alt.audit('user', 'review', p_essay::text, jsonb_build_object('overall', ov, 'ai', cur.overall));
  return n;
end $$;

create or replace function alt.save_feedback(p_essay uuid, p_lang text, p_source text, p_model text, p_content jsonb, p_dropped int)
returns bigint language plpgsql security definer set search_path = alt, pg_temp as $$
declare e alt.essays; id bigint;
begin
  select * into e from alt.essays where id = p_essay;
  if not found or not alt.can_see_student(e.student_id) then raise exception 'not found' using errcode = '42501'; end if;
  insert into alt.essay_feedback (essay_id, lang, source, model, content, dropped, created_by)
  values (p_essay, p_lang, p_source, p_model, p_content, p_dropped, alt.uid()) returning essay_feedback.id into id;
  perform alt.audit('user', 'feedback', p_essay::text, jsonb_build_object('source', p_source, 'dropped', p_dropped));
  return id;
end $$;

-- May the LLM see this essay? Minors need an active guardian consent for AI feedback; adults need self consent.
create or replace function alt.ai_allowed(p_essay uuid) returns boolean
language sql stable security definer set search_path = alt, pg_temp as $$
  select exists (select 1 from alt.essays e join alt.consents c on c.student_id = e.student_id
                 where e.id = p_essay and c.scope = 'ai_feedback' and c.revoked_at is null)
$$;

create or replace function alt.save_report(p_cohort smallint, p_lang text, p_facts jsonb, p_content jsonb, p_source text, p_dropped int)
returns bigint language plpgsql security definer set search_path = alt, pg_temp as $$
declare id bigint;
begin
  if alt.my_role() not in ('teacher', 'inst_admin', 'platform') or not (p_cohort = any (alt.my_cohorts())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into alt.reports (cohort_id, lang, facts, content, source, dropped, created_by)
  values (p_cohort, p_lang, p_facts, p_content, p_source, p_dropped, alt.uid()) returning reports.id into id;
  perform alt.audit('user', 'report', p_cohort::text, jsonb_build_object('source', p_source));
  return id;
end $$;

create or replace function alt.log_llm(p_purpose text, p_model text, p_prompt_sha text, p_ms int, p_ok boolean, p_dropped int)
returns void language sql security definer set search_path = alt, pg_temp as $$
  insert into alt.llm_log (purpose, model, prompt_sha256, ms, ok, dropped, user_id)
  values (p_purpose, p_model, p_prompt_sha, p_ms, p_ok, p_dropped, alt.uid())
$$;

-- ------------------------------------------------------------------ privacy
create or replace function alt.record_consent(p_student int, p_scope text, p_kind text, p_evidence_sha text) returns void
language plpgsql security definer set search_path = alt, pg_temp as $$
begin
  if alt.my_role() not in ('inst_admin', 'platform') or not alt.can_see_student(p_student) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into alt.consents (student_id, kind, scope, evidence_sha256) values (p_student, p_kind, p_scope, p_evidence_sha)
  on conflict (student_id, scope) where revoked_at is null do nothing;
  perform alt.audit('user', 'consent_grant', p_student::text, jsonb_build_object('scope', p_scope, 'kind', p_kind));
end $$;

create or replace function alt.revoke_consent(p_student int, p_scope text) returns void
language plpgsql security definer set search_path = alt, pg_temp as $$
begin
  if alt.my_role() not in ('inst_admin', 'platform') or not alt.can_see_student(p_student) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update alt.consents set revoked_at = now() where student_id = p_student and scope = p_scope and revoked_at is null;
  perform alt.audit('user', 'consent_revoke', p_student::text, jsonb_build_object('scope', p_scope));
end $$;

-- Retention: essay text and AI feedback are deleted after the policy period (shorter for minors);
-- scores, which are not personal free text, stay for trend and calibration.
-- Called by pg_cron (no JWT: trigger 'cron') or by platform staff from the Privacy page.
create or replace function alt.purge_expired() returns jsonb
language plpgsql security definer set search_path = alt, pg_temp as $$
declare pe alt.retention_policies; pf alt.retention_policies; n_e int; n_f int;
  p_trigger text := case when alt.uid() is null then 'cron' else 'manual' end;
begin
  if alt.uid() is not null and coalesce(alt.my_role(), '') <> 'platform' then raise exception 'platform only' using errcode = '42501'; end if;
  select * into pe from alt.retention_policies where data_kind = 'essay_text';
  select * into pf from alt.retention_policies where data_kind = 'ai_feedback';
  with v as (
    update alt.essays e set body = null, purged_at = now()
    from alt.students s
    where s.id = e.student_id and e.body is not null
      and e.submitted_at < now() - make_interval(days => case when s.birth_year > extract(year from now())::int - 18
                                                            then pe.keep_days_minor else pe.keep_days end)
    returning 1)
  select count(*) into n_e from v;
  with v as (
    delete from alt.essay_feedback f using alt.essays e, alt.students s
    where e.id = f.essay_id and s.id = e.student_id
      and f.created_at < now() - make_interval(days => case when s.birth_year > extract(year from now())::int - 18
                                                         then pf.keep_days_minor else pf.keep_days end)
    returning 1)
  select count(*) into n_f from v;
  insert into alt.purge_runs (data_kind, rows, trigger) values ('essay_text', n_e, p_trigger), ('ai_feedback', n_f, p_trigger);
  perform alt.audit(case when p_trigger = 'cron' then 'system' else 'user' end, 'purge', null,
                    jsonb_build_object('essay_text', n_e, 'ai_feedback', n_f));
  return jsonb_build_object('essay_text', n_e, 'ai_feedback', n_f);
end $$;

create or replace function alt.request_dsr(p_student int, p_kind text) returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare id int;
begin
  if alt.my_role() not in ('inst_admin', 'platform') or not alt.can_see_student(p_student) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into alt.dsr_requests (student_id, kind, requested_by) values (p_student, p_kind, alt.uid()) returning dsr_requests.id into id;
  perform alt.audit('user', 'dsr_request', p_student::text, jsonb_build_object('kind', p_kind, 'request', id));
  return id;
end $$;

-- Export: everything held about the learner as one JSON document. Erase: free text and identity removed,
-- scores kept under a pseudonym so cohort statistics stay correct (the UU PDP right to erasure).
create or replace function alt.complete_dsr(p_id int) returns jsonb
language plpgsql security definer set search_path = alt, pg_temp as $$
declare r alt.dsr_requests; out jsonb;
begin
  select * into r from alt.dsr_requests where id = p_id for update;
  if not found or r.status <> 'open' then raise exception 'no open request' using errcode = '22023'; end if;
  if alt.my_role() not in ('inst_admin', 'platform') or not alt.can_see_student(r.student_id) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if r.kind = 'export' then
    select jsonb_build_object(
      'learner', (select to_jsonb(s) - 'synthetic_engagement' from alt.students s where s.id = r.student_id),
      'consents', (select coalesce(jsonb_agg(to_jsonb(c) - 'evidence_sha256'), '[]') from alt.consents c where c.student_id = r.student_id),
      'attempts', (select coalesce(jsonb_agg(jsonb_build_object('skill', a.skill, 'source', a.source, 'band', a.band, 'at', a.taken_at)), '[]')
                   from alt.attempts a where a.student_id = r.student_id),
      'essays', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'submitted_at', e.submitted_at, 'body', e.body,
                   'score', (select to_jsonb(x) - 'drivers' from alt.essay_scores x where x.essay_id = e.id and x.valid_to is null))), '[]')
                 from alt.essays e where e.student_id = r.student_id),
      'official_results', (select coalesce(jsonb_agg(to_jsonb(o)), '[]') from alt.official_results o where o.student_id = r.student_id),
      'readiness', (select to_jsonb(x) from alt.readiness x where x.student_id = r.student_id and x.valid_to is null),
      'exported_at', now()) into out;
  else
    update alt.essays set body = null, purged_at = now() where student_id = r.student_id;
    delete from alt.essay_feedback f using alt.essays e where e.id = f.essay_id and e.student_id = r.student_id;
    update alt.students set display_name = 'Erased learner #' || id, external_ref = 'erased-' || id, birth_year = null,
      user_id = null, erased_at = now() where id = r.student_id;
    out := jsonb_build_object('erased', true, 'kept', 'band scores under a pseudonym, for cohort statistics');
  end if;
  update alt.dsr_requests set status = 'done', completed_at = now(),
    result = case when r.kind = 'export' then jsonb_build_object('bytes', length(out::text)) else out end
  where id = p_id;
  perform alt.audit('user', 'dsr_complete', r.student_id::text, jsonb_build_object('kind', r.kind, 'request', p_id));
  return out;
end $$;

-- ------------------------------------------------------------------ platform operations
create or replace function alt.save_calibration(p_entries jsonb, p_eval jsonb) returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare id int; n int := 0; s int;
begin
  if alt.my_role() <> 'platform' then raise exception 'platform only' using errcode = '42501'; end if;
  update alt.calibrations set active = false where active;
  insert into alt.calibrations (entries, evaluation, active, created_by) values (p_entries, p_eval, true, alt.uid())
  returning calibrations.id into id;
  for s in select st.id from alt.students st where st.erased_at is null loop
    if alt.enqueue_readiness(s) then n := n + 1; end if;
  end loop;
  perform alt.audit('user', 'calibration', id::text, jsonb_build_object('entries', p_entries, 'readiness_jobs', n));
  return id;
end $$;

-- Calibration pairs: each official result against observations within 21 days of the test.
create or replace function alt.calibration_pairs() returns table (student_id int, skill text, source text, observed numeric, official numeric, days double precision)
language sql stable security definer set search_path = alt, pg_temp as $$
  select o.student_id, a.skill, a.source, a.band,
         case a.skill when 'reading' then o.reading when 'listening' then o.listening when 'writing' then o.writing else o.speaking end,
         extract(epoch from (o.test_date::timestamp - a.taken_at)) / 86400
  from alt.official_results o
  join alt.attempts a on a.student_id = o.student_id and abs(extract(epoch from (o.test_date::timestamp - a.taken_at)) / 86400) <= 21
$$;

-- Re-score a batch through the queue (model upgrade drill and load test).
create or replace function alt.start_rescore(p_n int) returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare e uuid; cnt int := 0; lt int;
begin
  if alt.my_role() <> 'platform' then raise exception 'platform only' using errcode = '42501'; end if;
  if p_n not between 1 and 1000 then raise exception 'n must be 1 to 1000' using errcode = '22023'; end if;
  insert into alt.load_tests (n, created_by) values (p_n, alt.uid()) returning id into lt;
  for e in select x.id from alt.essays x where x.status = 'scored' and x.body is not null order by random() limit p_n loop
    perform alt.enqueue_score(e, true);
    cnt := cnt + 1;
  end loop;
  update alt.load_tests set n = cnt where id = lt;
  perform alt.audit('user', 'rescore_batch', lt::text, jsonb_build_object('essays', cnt));
  return lt;
end $$;

create or replace function alt.create_api_key(p_inst smallint, p_label text, p_prefix text, p_sha text) returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare id int;
begin
  if not (alt.my_role() = 'platform' or (alt.my_role() = 'inst_admin' and alt.my_inst() = p_inst)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into alt.api_keys (institution_id, prefix, key_sha256, label, created_by) values (p_inst, p_prefix, p_sha, left(p_label, 60), alt.uid())
  returning api_keys.id into id;
  perform alt.audit('user', 'api_key_create', id::text, jsonb_build_object('institution', p_inst, 'prefix', p_prefix));
  return id;
end $$;

create or replace function alt.revoke_api_key(p_id int) returns void
language plpgsql security definer set search_path = alt, pg_temp as $$
declare k alt.api_keys;
begin
  select * into k from alt.api_keys where id = p_id;
  if not found or not (alt.my_role() = 'platform' or (alt.my_role() = 'inst_admin' and alt.my_inst() = k.institution_id)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update alt.api_keys set revoked_at = now() where id = p_id and revoked_at is null;
  perform alt.audit('user', 'api_key_revoke', p_id::text, '{}');
end $$;

-- ------------------------------------------------------------------ partner API (API key, no session)
create or replace function alt.api_inst(p_sha text) returns smallint
language plpgsql security definer set search_path = alt, pg_temp as $$
declare i smallint;
begin
  update alt.api_keys set last_used_at = now() where key_sha256 = p_sha and revoked_at is null returning institution_id into i;
  if i is null then raise exception 'invalid api key' using errcode = '28000'; end if;
  return i;
end $$;

create or replace function alt.api_idem_get(p_sha text, p_key text) returns jsonb
language sql security definer set search_path = alt, pg_temp as $$
  select jsonb_build_object('request_sha256', request_sha256, 'status', status, 'response', response)
  from alt.idempotency where institution_id = alt.api_inst(p_sha) and key = p_key
$$;

create or replace function alt.api_idem_put(p_sha text, p_key text, p_req text, p_status int, p_response jsonb) returns void
language sql security definer set search_path = alt, pg_temp as $$
  insert into alt.idempotency (institution_id, key, request_sha256, status, response)
  values (alt.api_inst(p_sha), p_key, p_req, p_status, p_response) on conflict do nothing
$$;

create or replace function alt.api_upsert_students(p_sha text, p_rows jsonb) returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare i smallint := alt.api_inst(p_sha); n int;
begin
  with v as (
    insert into alt.students (institution_id, cohort_id, external_ref, display_name, birth_year)
    select i, c.id, x.ref, x.name, x.birth_year
    from jsonb_to_recordset(p_rows) as x(ref text, name text, cohort text, birth_year smallint)
    join alt.cohorts c on c.institution_id = i and c.key = x.cohort
    on conflict (institution_id, external_ref) do update set display_name = excluded.display_name, cohort_id = excluded.cohort_id
    returning 1)
  select count(*) into n from v;
  perform alt.audit('api', 'students_upsert', i::text, jsonb_build_object('rows', n));
  return n;
end $$;

create or replace function alt.api_ingest_attempts(p_sha text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = alt, pg_temp as $$
declare i smallint := alt.api_inst(p_sha); n int; unknown int; s int; jobs int := 0;
begin
  select count(*) into unknown from jsonb_to_recordset(p_rows) as x(student_ref text)
  where not exists (select 1 from alt.students st where st.institution_id = i and st.external_ref = x.student_ref);
  with v as (
    insert into alt.attempts (student_id, skill, source, band, raw_score, taken_at, via)
    select st.id, x.skill, x.source, x.band, x.raw_score, x.taken_at, 'api'
    from jsonb_to_recordset(p_rows) as x(student_ref text, skill text, source text, band numeric, raw_score smallint, taken_at timestamptz)
    join alt.students st on st.institution_id = i and st.external_ref = x.student_ref and st.erased_at is null
    returning student_id)
  select count(*) into n from v;
  for s in select distinct st.id from jsonb_to_recordset(p_rows) as x(student_ref text)
           join alt.students st on st.institution_id = i and st.external_ref = x.student_ref loop
    if alt.enqueue_readiness(s) then jobs := jobs + 1; end if;
  end loop;
  perform alt.audit('api', 'attempts_ingest', i::text, jsonb_build_object('rows', n, 'unknown', unknown));
  return jsonb_build_object('inserted', n, 'unknown_learners', unknown, 'readiness_jobs', jobs);
end $$;

create or replace function alt.api_submit_essay(p_sha text, p_ref text, p_prompt text, p_qtype text, p_body text, p_words int)
returns uuid language plpgsql security definer set search_path = alt, pg_temp as $$
declare i smallint := alt.api_inst(p_sha); st alt.students; pid int; id uuid; psha text;
begin
  select * into st from alt.students where institution_id = i and external_ref = p_ref and erased_at is null;
  if not found then raise exception 'unknown learner' using errcode = '22023'; end if;
  psha := encode(sha256(convert_to(p_prompt, 'UTF8')), 'hex');
  insert into alt.prompts (body, question_type, source, body_sha256) values (p_prompt, p_qtype, 'api', psha)
  on conflict (body_sha256) do update set body_sha256 = excluded.body_sha256 returning prompts.id into pid;
  insert into alt.essays (student_id, prompt_id, body, word_count, body_sha256, via)
  values (st.id, pid, p_body, p_words, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), 'api') returning essays.id into id;
  perform alt.enqueue_score(id);
  perform alt.audit('api', 'essay_submit', id::text, jsonb_build_object('institution', i));
  return id;
end $$;

create or replace function alt.api_essay(p_sha text, p_essay uuid) returns jsonb
language sql security definer set search_path = alt, pg_temp as $$
  select jsonb_build_object('id', e.id, 'student_ref', st.external_ref, 'status', e.status, 'submitted_at', e.submitted_at,
    'score', case when s.id is null then null else jsonb_build_object('model_version', s.model_version, 'overall', s.overall,
      'interval80', jsonb_build_array(s.lo80, s.hi80), 'criteria', jsonb_build_object('TR', s.tr, 'CC', s.cc, 'LR', s.lr, 'GRA', s.gra),
      'flags', s.flags, 'scored_at', s.valid_from) end)
  from alt.essays e join alt.students st on st.id = e.student_id
  left join alt.essay_scores s on s.essay_id = e.id and s.valid_to is null
  where e.id = p_essay and st.institution_id = alt.api_inst(p_sha)
$$;

create or replace function alt.api_readiness(p_sha text, p_ref text) returns jsonb
language sql security definer set search_path = alt, pg_temp as $$
  select jsonb_build_object('student_ref', st.external_ref, 'cohort', c.key,
    'target', jsonb_build_object('overall', c.target_overall, 'min_skill', c.target_min_skill, 'deadline', c.deadline),
    'readiness', case when r.id is null then null else jsonb_build_object('status', r.status, 'p_target', r.p_target,
      'overall_now', r.overall_now, 'binding_skill', r.binding, 'skills', r.skills, 'model_version', r.model_version,
      'calibration_id', r.calibration_id, 'computed_at', r.valid_from) end)
  from alt.students st join alt.cohorts c on c.id = st.cohort_id
  left join alt.readiness r on r.student_id = st.id and r.valid_to is null
  where st.institution_id = alt.api_inst(p_sha) and st.external_ref = p_ref and st.erased_at is null
$$;

create or replace function alt.api_official(p_sha text, p_ref text, p_row jsonb) returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare i smallint := alt.api_inst(p_sha); st alt.students; id int;
begin
  select * into st from alt.students where institution_id = i and external_ref = p_ref and erased_at is null;
  if not found then raise exception 'unknown learner' using errcode = '22023'; end if;
  insert into alt.official_results (student_id, test_date, reading, listening, writing, speaking, overall, verified, via)
  values (st.id, (p_row->>'test_date')::date, (p_row->>'reading')::numeric, (p_row->>'listening')::numeric,
          (p_row->>'writing')::numeric, (p_row->>'speaking')::numeric, (p_row->>'overall')::numeric,
          coalesce(p_row->>'verified', 'self_reported'), 'api')
  on conflict (student_id, test_date) do update set reading = excluded.reading, listening = excluded.listening,
    writing = excluded.writing, speaking = excluded.speaking, overall = excluded.overall, verified = excluded.verified
  returning official_results.id into id;
  perform alt.audit('api', 'official_result', st.id::text, jsonb_build_object('test_date', p_row->>'test_date'));
  return id;
end $$;

-- ------------------------------------------------------------------ grants
revoke all on all functions in schema alt from public;
grant execute on function alt.uid(), alt.me(), alt.my_role(), alt.my_inst(), alt.my_students(), alt.my_cohorts(),
  alt.can_see_student(int) to alt_user, alt_worker, alt_api;
grant execute on function alt.hit(text, int, int), alt.take_token(text, double precision, double precision), alt.log_llm(text, text, text, int, boolean, int)
  to alt_user, alt_worker, alt_api;
grant execute on function alt.submit_essay(int, text, int), alt.submit_review(uuid, numeric, numeric, numeric, numeric, text),
  alt.save_feedback(uuid, text, text, text, jsonb, int), alt.ai_allowed(uuid), alt.save_report(smallint, text, jsonb, jsonb, text, int),
  alt.record_consent(int, text, text, text), alt.revoke_consent(int, text), alt.purge_expired(),
  alt.request_dsr(int, text), alt.complete_dsr(int), alt.save_calibration(jsonb, jsonb), alt.calibration_pairs(),
  alt.start_rescore(int), alt.create_api_key(smallint, text, text, text), alt.revoke_api_key(int),
  alt.dlq_replay(), alt.dlq_list(int), alt.q_stats(), alt.verify_chains()
  to alt_user;
grant execute on function alt.q_read(int, int), alt.q_delete(bigint), alt.q_fail(bigint, int, text, int), alt.q_stats(),
  alt.worker_run_start(text, text), alt.worker_run_end(bigint, int, int), alt.w_essay(uuid), alt.record_score(uuid, text, boolean, jsonb, text),
  alt.score_failed(uuid), alt.w_learner(int), alt.record_readiness(int, jsonb, text), alt.ai_allowed(uuid)
  to alt_worker;
grant execute on function alt.api_inst(text), alt.api_idem_get(text, text), alt.api_idem_put(text, text, text, int, jsonb),
  alt.api_upsert_students(text, jsonb), alt.api_ingest_attempts(text, jsonb), alt.api_submit_essay(text, text, text, text, text, int),
  alt.api_essay(text, uuid), alt.api_readiness(text, text), alt.api_official(text, text, jsonb), alt.q_stats()
  to alt_api;
