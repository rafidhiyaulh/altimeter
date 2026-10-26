-- PL/pgSQL variables named `id` collide with the `id` column in WHERE clauses (42702). Found by the SIT
-- (learner essay submit returned 500). Renamed to v_id.
-- A learner submits an essay: stored, hashed, queued for scoring. 5 essays per 10 minutes per learner.
create or replace function alt.submit_essay(p_prompt int, p_body text, p_words int) returns uuid
language plpgsql security definer set search_path = alt, pg_temp as $$
declare st alt.students; v_id uuid;
begin
  if alt.my_role() <> 'student' then raise exception 'learners only' using errcode = '42501'; end if;
  select * into st from alt.students where user_id = alt.uid() and erased_at is null;
  if not found then raise exception 'no learner record' using errcode = '42501'; end if;
  if length(p_body) not between 200 and 12000 then raise exception 'essay length out of range' using errcode = '22023'; end if;
  if not exists (select 1 from alt.prompts where id = p_prompt) then raise exception 'unknown prompt' using errcode = '22023'; end if;
  if not alt.hit('essay:' || st.id, 5, 600) then raise exception 'too many essays, try again in a few minutes' using errcode = '22023'; end if;
  insert into alt.essays (student_id, prompt_id, body, word_count, body_sha256, via)
  values (st.id, p_prompt, p_body, p_words, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), 'app') returning essays.id into v_id;
  perform alt.enqueue_score(v_id);
  perform alt.audit('user', 'essay_submit', v_id::text, jsonb_build_object('words', p_words));
  return v_id;
end $$;

create or replace function alt.save_feedback(p_essay uuid, p_lang text, p_source text, p_model text, p_content jsonb, p_dropped int)
returns bigint language plpgsql security definer set search_path = alt, pg_temp as $$
declare e alt.essays; v_id bigint;
begin
  select * into e from alt.essays where id = p_essay;
  if not found or not alt.can_see_student(e.student_id) then raise exception 'not found' using errcode = '42501'; end if;
  insert into alt.essay_feedback (essay_id, lang, source, model, content, dropped, created_by)
  values (p_essay, p_lang, p_source, p_model, p_content, p_dropped, alt.uid()) returning essay_feedback.id into v_id;
  perform alt.audit('user', 'feedback', p_essay::text, jsonb_build_object('source', p_source, 'dropped', p_dropped));
  return v_id;
end $$;


-- The Management API connects as postgres; membership lets the SIT check RLS by SET ROLE alt_user.
grant alt_user, alt_worker, alt_api to postgres;
