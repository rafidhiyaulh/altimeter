import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { llmModel } from '@/lib/llm'
import { prior, writingModel } from '@/lib/scoring'
import { dateTime, num, pct } from '@/lib/format'
import { Card, PageHead } from '@/components/ui'
import { Term } from '@/components/Help'
import { ApiKeys, OpsPanel } from '@/components/OpsClient'

export const generateMetadata = titled('Sistem & API', 'System & API')

export default async function System() {
  const me = await requireMe(['platform'])
  const { t } = await getT()
  const d = await asUser(me, async tx => {
    const [s] = await tx`select
      (select count(*) from alt.students)::int as students, (select count(*) from alt.attempts)::int as attempts,
      (select count(*) from alt.essays)::int as essays, (select count(*) from alt.essay_scores)::int as score_versions,
      (select count(*) from alt.essay_scores where valid_to is not null)::int as closed_versions,
      (select count(*) from alt.readiness)::int as readiness_versions, (select count(*) from alt.reviews)::int as reviews,
      (select count(*) from alt.audit_log)::int as audit_rows,
      (select count(*) from alt.worker_runs where started_at > now() - interval '24 hours')::int as runs_24h,
      (select coalesce(sum(processed), 0) from alt.worker_runs where started_at > now() - interval '24 hours')::int as processed_24h,
      (select coalesce(sum(failed), 0) from alt.worker_runs where started_at > now() - interval '24 hours')::int as failed_24h,
      (select count(*) from alt.llm_log)::int as llm_calls, (select avg(ok::int) from alt.llm_log) as llm_ok, (select avg(ms) from alt.llm_log where ok) as llm_ms,
      (select coalesce(sum(dropped), 0) from alt.llm_log)::int as llm_dropped,
      alt.q_stats() as queue, alt.verify_chains() as chains`
    const keys = await tx`select k.id, i.name as institution, k.prefix, k.label, k.created_at, k.last_used_at, k.revoked_at
      from alt.api_keys k join alt.institutions i on i.id = k.institution_id order by k.id desc`
    const insts = await tx`select id, name from alt.institutions order by id`
    const audit = await tx`select seq, at, actor_kind, action, target from alt.audit_log order by seq desc limit 8`
    return { s, keys, insts, audit }
  })
  const s = d.s
  const pillars = [
    { tech: 'Relational database', title: t('Integritas di database', 'Integrity in the database'),
      body: t('Partisi bulanan, skor bitemporal, ledger berantai hash.', 'Monthly partitions, bitemporal scores, hash-chained ledgers.'),
      facts: [[t('Learner', 'Learners'), num(s.students)], [t('Attempt (14 partisi)', 'Attempts (14 partitions)'), num(s.attempts)], [t('Versi skor', 'Score versions'), `${num(s.score_versions)} (${num(s.closed_versions)} ${t('ditutup', 'closed')})`],
        [t('Versi forecast', 'Forecast versions'), num(s.readiness_versions)], [t('Rantai hash', 'Hash chains'), s.chains.audit_broken_at == null && s.chains.review_broken_at == null ? t('utuh', 'intact') : t('RUSAK', 'BROKEN')]] },
    { tech: 'APIs + backend', title: t('API aman diulang', 'Retry-safe API'),
      body: t('OpenAPI 3.1, HMAC, idempotency, RFC 9457, rate limit.', 'OpenAPI 3.1, HMAC, idempotency, RFC 9457, rate limits.'),
      facts: [['OpenAPI', '/api/v1/openapi'], [t('API key', 'API keys'), num(d.keys.length)]] },
    { tech: 'Distributed systems', title: t('Antrean paralel', 'Parallel queue'),
      body: t('pgmq, worker paralel, DLQ, pg_cron, secret di Vault.', 'pgmq, parallel workers, DLQ, pg_cron, secret in Vault.'),
      facts: [[t('Antrean / DLQ', 'Queue / DLQ'), `${num(s.queue.depth)} / ${num(s.queue.dlq)}`], [t('Run worker 24 jam', 'Worker runs, 24 h'), num(s.runs_24h)],
        [t('Job diproses 24 jam', 'Jobs processed, 24 h'), num(s.processed_24h)], [t('Gagal', 'Failed'), num(s.failed_24h)]] },
    { tech: 'AI / ML', title: t('Model terukur, LLM dibatasi', 'Measured models, bounded LLM'),
      body: t('LightGBM + Kalman + kalibrasi. LLM wajib mengutip.', 'LightGBM + Kalman + calibration. The LLM must quote.'),
      facts: [[t('Model writing', 'Writing model'), writingModel.version], [t('Model readiness', 'Readiness model'), prior.version], ['LLM', llmModel() ?? '-'],
        [t('Panggilan LLM / sukses', 'LLM calls / ok'), `${num(s.llm_calls)} / ${pct(s.llm_ok == null ? null : Number(s.llm_ok))}`], [t('Butir tak ber-grounding dibuang', 'Ungrounded items dropped'), num(s.llm_dropped)]] },
    { tech: 'Cloud + deployment', title: t('Singapura, bisa self-host', 'Singapore, self-hostable'),
      body: t('Vercel sin1, Supabase Singapura, Dockerfile.', 'Vercel sin1, Supabase Singapore, Dockerfile.'),
      facts: [[t('Region', 'Region'), process.env.VERCEL_REGION ?? 'local'], ['Commit', process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '-'], ['Health', '/api/health']] },
    { tech: 'Security / networking', title: t('Data anak dilindungi', 'Minors\' data protected'),
      body: t('RLS, role terpisah, izin wali, CSP/HSTS, audit.', 'RLS, split roles, guardian consent, CSP/HSTS, audit.'),
      facts: [[t('Baris audit', 'Audit rows'), num(s.audit_rows)], [t('Review di ledger', 'Reviews in ledger'), num(s.reviews)]] },
  ]
  return (
    <>
      <PageHead title={t('Sistem & API', 'System & API')} sub={t('Enam lapisan, angka langsung dari sistem.', 'Six layers, live numbers.')} />
      <div className="cols-2">
        <Card title={t('Cara kerja', 'How it works')}>
          {pillars.map((p, i) => (
            <div key={p.tech} className="pillar">
              <span className="no">{i + 1}</span>
              <div>
                <div className="layer-tech">{p.tech}</div>
                <div className="strong">{p.title}</div>
                <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>{p.body}</p>
                <div className="kv" style={{ marginTop: 8 }}>{p.facts.map(([k, v]) => <div key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
              </div>
            </div>
          ))}
        </Card>
        <div className="stack-16">
          <Card title={t('Antrean langsung', 'Live queue')} sub={<><Term k="dlq">DLQ</Term> · {t('diperbarui tiap 2 detik', 'refreshes every 2 seconds')}</>}><OpsPanel /></Card>
          <Card title={t('API key partner', 'Partner API keys')} sub={<a href="/api/v1/openapi">OpenAPI 3.1</a>}>
            <ApiKeys institutions={d.insts as unknown as { id: number; name: string }[]} keys={d.keys as never} />
          </Card>
          <Card title={t('Audit log terbaru', 'Latest audit log')} sub={<Term k="ledger">{t('berantai hash', 'hash-chained')}</Term>}>
            <ul className="divided">{d.audit.map(a => (
              <li key={a.seq} className="row between"><span><span className="mono small muted">#{a.seq}</span> {a.action} <span className="muted small">{a.actor_kind}{a.target ? ` · ${String(a.target).slice(0, 12)}` : ''}</span></span><span className="muted small">{dateTime(a.at)}</span></li>))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
