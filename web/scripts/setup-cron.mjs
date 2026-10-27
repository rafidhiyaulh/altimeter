// pg_cron jobs for Altimeter (names prefixed alt-, so they never collide with other apps on the project):
//   alt-worker-sweep   every minute: if the job queue is not empty, call /api/worker 3 times in parallel
//                      through pg_net (competing consumers). The bearer secret lives in Supabase Vault.
//   alt-retention      daily 02:15 WIB: delete essay text / AI feedback past the retention policy.
//   alt-monitor        every minute: open or close alerts (stuck queue, dead letters, failures, API errors and latency).
// usage: node --env-file=../.env.local scripts/setup-cron.mjs https://<public-url>
import { runSql, lit } from './lib/dbq.mjs'

const url = process.argv[2]
if (!url?.startsWith('https://')) throw new Error('pass the public https URL')
runSql(`
insert into alt.settings (key, value) values ('worker_url', ${lit(url + '/api/worker')})
  on conflict (key) do update set value = excluded.value;
do $$
declare s uuid;
begin
  select id into s from vault.secrets where name = 'alt_worker_secret';
  if s is null then perform vault.create_secret(${lit(process.env.ALT_WORKER_SECRET)}, 'alt_worker_secret', 'Altimeter worker bearer');
  else perform vault.update_secret(s, ${lit(process.env.ALT_WORKER_SECRET)}); end if;
end $$;
select cron.unschedule(jobname) from cron.job where jobname in ('alt-worker-sweep', 'alt-retention', 'alt-monitor');
select cron.schedule('alt-worker-sweep', '* * * * *', $job$
  select net.http_post(
    url := (select value from alt.settings where key = 'worker_url'),
    headers := jsonb_build_object('content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alt_worker_secret')),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 55000)
  from generate_series(1, 3)
  where (select queue_length from pgmq.metrics('alt_jobs')) > 0
$job$);
select cron.schedule('alt-retention', '15 19 * * *', $job$ select alt.purge_expired() $job$);
select cron.schedule('alt-monitor', '* * * * *', $job$ select alt.monitor() $job$);
`)
console.log(runSql(`select jobname, schedule, active from cron.job where jobname like 'alt-%' order by jobname`))
