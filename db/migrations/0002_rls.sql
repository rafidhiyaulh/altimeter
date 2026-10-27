-- Row-level security. The app verifies the Supabase Auth JWT, sets `request.jwt.claims` and then
-- `SET LOCAL ROLE alt_user` inside every request transaction. These policies alone decide what a person
-- sees: an institution admin sees their institution, a teacher their cohorts, a learner only themselves,
-- Acsent platform staff everything. Writes never go through tables directly, only through functions.

create or replace function alt.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

create or replace function alt.me() returns alt.profiles
language sql stable security definer set search_path = alt, pg_temp as $$
  select * from alt.profiles where user_id = alt.uid()
$$;

create or replace function alt.my_role() returns text language sql stable as $$ select (alt.me()).role $$;
create or replace function alt.my_inst() returns smallint language sql stable as $$ select (alt.me()).institution_id $$;

-- Learners and cohorts visible to the current user. Policies call these inside (select ...), so Postgres
-- evaluates them once per statement (initPlan) instead of once per row.
create or replace function alt.my_students() returns int[]
language sql stable security definer set search_path = alt, pg_temp as $$
  select coalesce(array_agg(s.id), '{}')
  from alt.students s join alt.profiles p on p.user_id = alt.uid()
  where p.role = 'platform'
     or (p.role = 'inst_admin' and s.institution_id = p.institution_id)
     or (p.role = 'teacher' and s.cohort_id in (select t.cohort_id from alt.teacher_cohorts t where t.user_id = p.user_id))
     or (p.role = 'student' and s.user_id = p.user_id)
$$;

create or replace function alt.my_cohorts() returns smallint[]
language sql stable security definer set search_path = alt, pg_temp as $$
  select coalesce(array_agg(c.id), '{}')
  from alt.cohorts c join alt.profiles p on p.user_id = alt.uid()
  where p.role = 'platform'
     or (p.role = 'inst_admin' and c.institution_id = p.institution_id)
     or (p.role = 'teacher' and c.id in (select t.cohort_id from alt.teacher_cohorts t where t.user_id = p.user_id))
     or (p.role = 'student' and c.id in (select s.cohort_id from alt.students s where s.user_id = p.user_id))
$$;

create or replace function alt.can_see_student(p_student int) returns boolean
language sql stable as $$ select p_student = any (alt.my_students()) $$;

revoke all on all functions in schema alt from public;
grant execute on function alt.uid(), alt.me(), alt.my_role(), alt.my_inst(), alt.my_students(), alt.my_cohorts(),
  alt.can_see_student(int) to alt_user, alt_worker, alt_api;

do $$
declare t text;
begin
  foreach t in array array['institutions', 'cohorts', 'profiles', 'teacher_cohorts', 'students', 'consents', 'attempts',
    'prompts', 'essays', 'essay_scores', 'essay_feedback', 'review_queue', 'reviews', 'official_results', 'readiness',
    'readiness_pending', 'calibrations', 'models', 'reports', 'api_keys', 'idempotency', 'audit_log', 'rate_limits',
    'token_buckets', 'worker_runs', 'settings', 'retention_policies', 'purge_runs', 'dsr_requests', 'llm_log', 'load_tests']
  loop
    execute format('alter table alt.%I enable row level security', t);
  end loop;
end $$;

grant select on alt.institutions, alt.cohorts, alt.profiles, alt.teacher_cohorts, alt.students, alt.consents, alt.attempts,
  alt.prompts, alt.essays, alt.essay_scores, alt.essay_feedback, alt.review_queue, alt.reviews, alt.official_results,
  alt.readiness, alt.calibrations, alt.models, alt.reports, alt.api_keys, alt.audit_log, alt.worker_runs,
  alt.retention_policies, alt.purge_runs, alt.dsr_requests, alt.llm_log, alt.load_tests
  to alt_user;
-- partitions are never readable directly (that would bypass the parent's policies)
do $$
declare p text;
begin
  for p in select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class pp on pp.oid = i.inhparent
           join pg_namespace n on n.oid = pp.relnamespace where n.nspname = 'alt' and pp.relname = 'attempts'
  loop
    execute format('revoke all on alt.%I from alt_user, alt_worker, alt_api', p);
  end loop;
end $$;

drop policy if exists p_read on alt.institutions;
create policy p_read on alt.institutions for select to alt_user
  using ((select alt.my_role()) = 'platform' or id = (select alt.my_inst()));

drop policy if exists p_read on alt.cohorts;
create policy p_read on alt.cohorts for select to alt_user using (id = any ((select alt.my_cohorts())::smallint[]));

drop policy if exists p_read on alt.profiles;
create policy p_read on alt.profiles for select to alt_user
  using (user_id = (select alt.uid()) or (select alt.my_role()) = 'platform'
         or ((select alt.my_role()) = 'inst_admin' and institution_id = (select alt.my_inst())));

drop policy if exists p_read on alt.teacher_cohorts;
create policy p_read on alt.teacher_cohorts for select to alt_user
  using (user_id = (select alt.uid()) or cohort_id = any ((select alt.my_cohorts())::smallint[]) and (select alt.my_role()) in ('platform', 'inst_admin'));

drop policy if exists p_read on alt.students;
create policy p_read on alt.students for select to alt_user using (id = any ((select alt.my_students())::int[]));

do $$
declare t text;
begin
  foreach t in array array['consents', 'attempts', 'essays', 'official_results', 'readiness', 'dsr_requests'] loop
    execute format('drop policy if exists p_read on alt.%I', t);
    execute format('create policy p_read on alt.%I for select to alt_user using (student_id = any ((select alt.my_students())::int[]))', t);
  end loop;
  foreach t in array array['essay_scores', 'essay_feedback', 'review_queue', 'reviews'] loop
    execute format('drop policy if exists p_read on alt.%I', t);
    execute format('create policy p_read on alt.%I for select to alt_user using (essay_id in (select e.id from alt.essays e))', t);
  end loop;
end $$;

drop policy if exists p_read on alt.prompts;
create policy p_read on alt.prompts for select to alt_user using ((select alt.my_role()) is not null);

drop policy if exists p_read on alt.calibrations;
create policy p_read on alt.calibrations for select to alt_user using ((select alt.my_role()) is not null);

drop policy if exists p_read on alt.models;
create policy p_read on alt.models for select to alt_user using ((select alt.my_role()) is not null);

drop policy if exists p_read on alt.reports;
create policy p_read on alt.reports for select to alt_user
  using (cohort_id = any ((select alt.my_cohorts())::smallint[]) and (select alt.my_role()) <> 'student');

drop policy if exists p_read on alt.api_keys;
create policy p_read on alt.api_keys for select to alt_user
  using ((select alt.my_role()) = 'platform' or ((select alt.my_role()) = 'inst_admin' and institution_id = (select alt.my_inst())));

drop policy if exists p_read on alt.audit_log;
create policy p_read on alt.audit_log for select to alt_user using ((select alt.my_role()) = 'platform');

drop policy if exists p_read on alt.llm_log;
create policy p_read on alt.llm_log for select to alt_user using ((select alt.my_role()) = 'platform');

drop policy if exists p_read on alt.worker_runs;
create policy p_read on alt.worker_runs for select to alt_user using ((select alt.my_role()) in ('platform', 'inst_admin', 'teacher'));

drop policy if exists p_read on alt.load_tests;
create policy p_read on alt.load_tests for select to alt_user using ((select alt.my_role()) = 'platform');

drop policy if exists p_read on alt.retention_policies;
create policy p_read on alt.retention_policies for select to alt_user using ((select alt.my_role()) in ('platform', 'inst_admin'));

drop policy if exists p_read on alt.purge_runs;
create policy p_read on alt.purge_runs for select to alt_user using ((select alt.my_role()) in ('platform', 'inst_admin'));
-- idempotency, rate_limits, token_buckets, settings, readiness_pending: no policy => invisible to alt_user.

-- Convenience views run with the CALLER's rights, so they inherit every policy above.
create or replace view alt.v_essay_current with (security_invoker = true) as
  select e.id, e.student_id, e.prompt_id, e.word_count, e.submitted_at, e.status, e.via, e.purged_at,
         s.model_version, s.tr, s.cc, s.lr, s.gra, s.overall, s.overall_raw, s.lo80, s.hi80, s.flags, s.valid_from as scored_at,
         q.reason as review_reason, q.done_at as reviewed_at
  from alt.essays e
  left join alt.essay_scores s on s.essay_id = e.id and s.valid_to is null
  left join alt.review_queue q on q.essay_id = e.id;

create or replace view alt.v_learner with (security_invoker = true) as
  select st.id, st.institution_id, st.cohort_id, st.external_ref, st.display_name, st.birth_year, st.user_id, st.erased_at,
         st.synthetic_engagement,
         (st.birth_year is not null and st.birth_year > extract(year from now())::int - 18) as is_minor,
         exists (select 1 from alt.consents c where c.student_id = st.id and c.scope = 'ai_feedback' and c.revoked_at is null) as ai_consent,
         r.status, r.p_target, r.p_overall, r.overall_now, r.overall_at_deadline, r.weeks_left, r.binding, r.priority,
         r.recoverable, r.skills, r.valid_from as readiness_at, r.calibration_id,
         (select max(a.taken_at) from alt.attempts a where a.student_id = st.id) as last_activity,
         (select count(*) from alt.attempts a where a.student_id = st.id and a.taken_at > now() - interval '14 days') as attempts_14d
  from alt.students st
  left join alt.readiness r on r.student_id = st.id and r.valid_to is null;

grant select on alt.v_essay_current, alt.v_learner to alt_user;
