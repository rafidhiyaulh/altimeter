-- Hash payloads must use exactly the stored representation (numeric(2,1): 6.0, not 6), otherwise
-- alt.verify_chains() recomputes a different hash. Found by verify_chains on the first seeded review.
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
  ov := (floor((p_tr + p_cc + p_lr + p_gra) / 4 * 2 + 0.5) / 2)::numeric(2,1);
  p_tr := p_tr::numeric(2,1); p_cc := p_cc::numeric(2,1); p_lr := p_lr::numeric(2,1); p_gra := p_gra::numeric(2,1);
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

