-- Monitoring: a request log for every API call (route, status, duration) and alerts that a pg_cron job
-- opens and closes every minute. One open alert per kind (partial unique index); an alert that clears
-- is closed, not deleted, so the history stays. Only the platform team can read either table.

create table if not exists alt.request_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  route text not null,
  method text not null,
  status smallint not null,
  ms int not null check (ms >= 0)
);
create index if not exists request_log_at on alt.request_log (at);

create table if not exists alt.alerts (
  id bigint generated always as identity primary key,
  kind text not null,
  message text not null,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists alerts_one_open on alt.alerts (kind) where resolved_at is null;

alter table alt.request_log enable row level security;
alter table alt.alerts enable row level security;
drop policy if exists p_read on alt.request_log;
create policy p_read on alt.request_log for select to alt_user using ((select alt.my_role()) = 'platform');
drop policy if exists p_read on alt.alerts;
create policy p_read on alt.alerts for select to alt_user using ((select alt.my_role()) = 'platform');
grant select on alt.request_log, alt.alerts to alt_user;

-- Written after the response is sent, from the app's worker role; no user can write it.
create or replace function alt.log_request(p_route text, p_method text, p_status int, p_ms int) returns void
language sql security definer set search_path = alt, pg_temp as $$
  insert into alt.request_log (route, method, status, ms) values (left(p_route, 120), left(p_method, 8), p_status, greatest(p_ms, 0));
$$;
revoke all on function alt.log_request(text, text, int, int) from public;
grant execute on function alt.log_request(text, text, int, int) to alt_worker;

-- Open, refresh or close one alert kind.
create or replace function alt.set_alert(p_kind text, p_on boolean, p_message text) returns void
language plpgsql security definer set search_path = alt, pg_temp as $$
begin
  if p_on then
    insert into alt.alerts (kind, message) values (p_kind, p_message)
    on conflict (kind) where resolved_at is null do update set message = excluded.message, last_seen_at = now();
  else
    update alt.alerts set resolved_at = now() where kind = p_kind and resolved_at is null;
  end if;
end $$;

-- Every minute (pg_cron): check the queue, the dead-letter queue, worker failures and API health over the
-- last 15 minutes. Thresholds are deliberately simple; each alert says what to look at.
create or replace function alt.monitor() returns int
language plpgsql security definer set search_path = alt, pg_temp as $$
declare q jsonb := alt.q_stats(); n int; errs int; p95 int; wfail int; open_n int;
begin
  perform alt.set_alert('queue_stuck', coalesce((q ->> 'oldest_s')::int, 0) > 180,
    format('The oldest job has waited %s s. Check that workers are being called (cron alt-worker-sweep).', q ->> 'oldest_s'));
  perform alt.set_alert('dead_letters', coalesce((q ->> 'dlq')::int, 0) > 0,
    format('%s job(s) failed 3 times and sit in the dead-letter queue. Inspect and replay them on the System page.', q ->> 'dlq'));
  select coalesce(sum(failed), 0) into wfail from alt.worker_runs where started_at > now() - interval '15 minutes';
  perform alt.set_alert('worker_failures', wfail > 0, format('%s job attempt(s) failed in the last 15 minutes.', wfail));
  select count(*), count(*) filter (where status >= 500), percentile_disc(0.95) within group (order by ms)
    into n, errs, p95 from alt.request_log where at > now() - interval '15 minutes';
  perform alt.set_alert('api_errors', n >= 20 and errs::numeric / n > 0.05,
    format('%s of %s API requests failed with a server error in the last 15 minutes.', errs, n));
  perform alt.set_alert('api_slow', n >= 20 and p95 > 2000,
    format('API p95 is %s ms over the last 15 minutes (threshold 2000 ms).', p95));
  delete from alt.request_log where at < now() - interval '14 days';
  select count(*) into open_n from alt.alerts where resolved_at is null;
  return open_n;
end $$;
revoke all on function alt.monitor() from public;

-- For /api/health: how many alerts are open (a number only, no messages).
create or replace function alt.open_alerts() returns int
language sql stable security definer set search_path = alt, pg_temp as $$
  select count(*)::int from alt.alerts where resolved_at is null
$$;
revoke all on function alt.open_alerts() from public;
grant execute on function alt.open_alerts() to alt_worker;
