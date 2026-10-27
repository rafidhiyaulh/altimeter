import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { getT, titled } from '@/lib/i18n-server'
import { llmModel } from '@/lib/llm'
import { prior, writingModel } from '@/lib/scoring'
import { ago, dateTime, num, pct } from '@/lib/format'
import { Badge, Card, Lead, PageHead } from '@/components/ui'
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
    const routes = await tx`select route, method, count(*)::int as n, count(*) filter (where status >= 500)::int as errors,
        percentile_disc(0.5) within group (order by ms) as p50, percentile_disc(0.95) within group (order by ms) as p95
      from alt.request_log where at > now() - interval '24 hours' group by route, method order by n desc limit 8`
    const [tot] = await tx`select count(*)::int as n, count(*) filter (where status >= 500)::int as errors,
        percentile_disc(0.95) within group (order by ms) as p95 from alt.request_log where at > now() - interval '24 hours'`
    const alerts = await tx`select kind, message, opened_at, last_seen_at, resolved_at from alt.alerts
      where resolved_at is null or resolved_at > now() - interval '24 hours' order by resolved_at is null desc, opened_at desc limit 6`
    return { s, keys, insts, audit, routes, tot, alerts }
  })
  const s = d.s
  const openAlerts = d.alerts.filter(a => !a.resolved_at)
  const ACTION: Record<string, string> = {
    report: t('Laporan dibuat', 'Report drafted'), rescore_batch: t('Batch dinilai ulang', 'Batch re-scored'), attempts_ingest: t('Skor masuk lewat API', 'Scores received via API'),
    feedback: t('Feedback dibuat', 'Feedback drafted'), essay_submit: t('Esai dikirim', 'Essay submitted'), review: t('Esai dicek guru', 'Essay checked by a teacher'),
    consent_grant: t('Izin diberikan', 'Consent given'), consent_revoke: t('Izin dicabut', 'Consent revoked'), calibration: t('Koreksi dihitung ulang', 'Correction recalculated'),
    dsr_request: t('Permintaan data dibuka', 'Data request opened'), dsr_complete: t('Permintaan data selesai', 'Data request completed'),
    api_key_create: t('API key dibuat', 'API key created'), api_key_revoke: t('API key dicabut', 'API key revoked'), dlq_replay: t('Job gagal diulang', 'Failed jobs retried'),
    official_result: t('Hasil IELTS resmi masuk', 'Official IELTS result received'), purge: t('Penghapusan data lama', 'Old data deleted'), students_upsert: t('Data learner disinkron', 'Learners synced'),
  }
  const ACTOR: Record<string, string> = { user: t('oleh pengguna', 'by a user'), api: t('lewat API', 'via API') }
  const pillars = [
    { tech: 'Relational database', title: t('Data tidak bisa diubah diam-diam', 'Data cannot be changed silently'),
      body: t('Skor lama tidak ditimpa, tapi disimpan sebagai versi. Review dan audit dikunci dengan hash berantai.', 'Old scores are never overwritten, only versioned. Reviews and audit rows are locked by a hash chain.'),
      facts: [[t('Learner', 'Learners'), num(s.students)], [t('Attempt (14 partisi)', 'Attempts (14 partitions)'), num(s.attempts)], [t('Versi skor', 'Score versions'), `${num(s.score_versions)} (${num(s.closed_versions)} ${t('ditutup', 'closed')})`],
        [t('Versi forecast', 'Forecast versions'), num(s.readiness_versions)], [t('Rantai hash', 'Hash chains'), s.chains.audit_broken_at == null && s.chains.review_broken_at == null ? t('utuh', 'intact') : t('RUSAK', 'BROKEN')]] },
    { tech: 'APIs + backend', title: t('API untuk aplikasi Acsent', 'An API for the Acsent app'),
      body: t('Aplikasi Acsent mengirim skor ke sini. Request ditandatangani, aman dikirim ulang, dan dibatasi per menit.', 'The Acsent app sends scores here. Requests are signed, safe to retry and rate limited.'),
      facts: [['OpenAPI', '/api/v1/openapi'], [t('API key aktif', 'Active API keys'), num(d.keys.filter(k => !k.revoked_at).length)]] },
    { tech: 'Distributed systems', title: t('Pekerjaan berat lewat antrean', 'Heavy work goes through a queue'),
      body: t('Penilaian esai dan forecast dikerjakan beberapa worker sekaligus. Job yang gagal 3 kali dipisah agar bisa diulang.', 'Essay scoring and forecasts run on several workers at once. A job that fails 3 times is set aside to retry later.'),
      facts: [[t('Antrean / DLQ', 'Queue / DLQ'), `${num(s.queue.depth)} / ${num(s.queue.dlq)}`], [t('Run worker 24 jam', 'Worker runs, 24 h'), num(s.runs_24h)],
        [t('Job diproses 24 jam', 'Jobs processed, 24 h'), num(s.processed_24h)], [t('Gagal', 'Failed'), num(s.failed_24h)]] },
    { tech: 'AI / ML', title: t('AI yang diukur, bukan ditebak', 'AI that is measured, not guessed'),
      body: t('Model skor writing dan forecast diuji dengan data asli. Feedback AI wajib mengutip esai, jika tidak, dibuang.', 'The writing scorer and forecast are tested on real data. AI feedback must quote the essay or it is dropped.'),
      facts: [[t('Model writing', 'Writing model'), writingModel.version], [t('Model readiness', 'Readiness model'), prior.version], ['LLM', llmModel() ?? '-'],
        [t('Panggilan LLM / sukses', 'LLM calls / ok'), `${num(s.llm_calls)} / ${pct(s.llm_ok == null ? null : Number(s.llm_ok))}`], [t('Butir tak ber-grounding dibuang', 'Ungrounded items dropped'), num(s.llm_dropped)]] },
    { tech: 'Cloud + deployment', title: t('Server di Singapura', 'Servers in Singapore'),
      body: t('Aplikasi dan database di Singapura, dekat dengan pengguna Indonesia. Bisa juga dijalankan sendiri dengan Docker.', 'App and database in Singapore, close to Indonesian users. Can also run anywhere with Docker.'),
      facts: [[t('Region', 'Region'), process.env.VERCEL_REGION === 'sin1' ? t('Singapura', 'Singapore') : (process.env.VERCEL_REGION ?? t('lokal', 'local'))], ['Health', '/api/health']] },
    { tech: 'Security / networking', title: t('Data anak dilindungi', 'Children\'s data protected'),
      body: t('Tiap institusi hanya melihat datanya sendiri, dicek langsung di database. Esai anak tidak ke AI tanpa izin wali.', 'Each school sees only its own data, enforced in the database. A minor\'s essay never goes to AI without guardian consent.'),
      facts: [[t('Baris audit', 'Audit rows'), num(s.audit_rows)], [t('Review di ledger', 'Reviews in ledger'), num(s.reviews)]] },
  ]
  return (
    <>
      <PageHead title={t('Sistem & API', 'System & API')} sub={t('Cara Altimeter dibangun, dengan angka langsung dari sistem.', 'How Altimeter is built, with live numbers from the system.')} />
      <Lead>
        {openAlerts.length === 0 && d.tot.n === 0 ? t('Semua normal. Belum ada request API dalam 24 jam terakhir. Dicek otomatis tiap menit.', 'All clear. No API requests in the last 24 hours yet. Checked automatically every minute.')
          : openAlerts.length === 0
          ? t(`Semua normal. ${num(d.tot.n)} request API dalam 24 jam, ${pct(d.tot.n ? d.tot.errors / d.tot.n : 0, 1)} error server, 95% selesai dalam ${num(d.tot.p95 ?? 0)} ms. Dicek otomatis tiap menit.`,
              `All clear. ${num(d.tot.n)} API requests in 24 hours, ${pct(d.tot.n ? d.tot.errors / d.tot.n : 0, 1)} server errors, 95% answered within ${num(d.tot.p95 ?? 0)} ms. Checked automatically every minute.`)
          : t(`${openAlerts.length} alert terbuka. Lihat daftar di bawah.`, `${openAlerts.length} open alert(s). See the list below.`)}
      </Lead>
      <div className="cols-2" style={{ marginBottom: 20 }}>
        <Card title={t('Waktu respons API, 24 jam', 'API response times, 24 hours')} sub={t('Setiap request dicatat setelah dijawab, jadi pencatatan tidak memperlambat.', 'Every request is logged after it is answered, so logging never slows it down.')} pad={false}>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>{t('Route', 'Route')}</th><th className="num">{t('Request', 'Requests')}</th><th className="num">{t('Error server', 'Server errors')}</th><th className="num">p50</th><th className="num">p95</th></tr></thead>
            <tbody>{d.routes.map(r => (
              <tr key={r.method + r.route}><td><span className="muted small">{r.method}</span> <span className="mono small">{r.route}</span></td><td className="num">{num(r.n)}</td>
                <td className={`num ${r.errors ? 'bad' : ''}`}>{num(r.errors)}</td><td className="num">{num(r.p50)} ms</td><td className="num">{num(r.p95)} ms</td></tr>))}
              {d.routes.length === 0 && <tr><td colSpan={5} className="muted">{t('Belum ada request dalam 24 jam.', 'No requests in the last 24 hours.')}</td></tr>}
            </tbody>
          </table></div>
        </Card>
        <Card title={t('Alert', 'Alerts')} sub={t('Antrean macet, job gagal, error atau API lambat. Dibuka dan ditutup otomatis.', 'Stuck queue, failed jobs, errors or a slow API. Opened and closed automatically.')}>
          <ul className="divided">
            {d.alerts.map(a => (
              <li key={a.kind + a.opened_at}>
                <div className="row between"><Badge tone={a.resolved_at ? 'neutral' : 'bad'}>{a.resolved_at ? t('selesai', 'resolved') : t('terbuka', 'open')}</Badge>
                  <span className="muted small">{a.resolved_at ? t(`ditutup ${ago(a.resolved_at)}`, `closed ${ago(a.resolved_at)}`) : t(`sejak ${ago(a.opened_at)}`, `since ${ago(a.opened_at)}`)}</span></div>
                <p className="small" style={{ marginTop: 4 }}>{a.message}</p>
              </li>
            ))}
            {d.alerts.length === 0 && <li className="muted">{t('Tidak ada alert dalam 24 jam terakhir.', 'No alerts in the last 24 hours.')}</li>}
          </ul>
        </Card>
      </div>
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
          <Card title={t('Antrean saat ini', 'Queue right now')} sub={t('Diperbarui tiap 2 detik. Tombol di bawah untuk uji beban dan uji ketahanan.', 'Refreshes every 2 seconds. Use the buttons to load test and fault test.')}><OpsPanel /></Card>
          <Card title={t('API key partner', 'Partner API keys')} sub={<>{t('Satu key per institusi. Dokumentasi: ', 'One key per institution. Docs: ')}<a href="/api/v1/openapi">OpenAPI 3.1</a></>}>
            <ApiKeys institutions={d.insts as unknown as { id: number; name: string }[]} keys={d.keys as never} />
          </Card>
          <Card title={t('Aktivitas terbaru', 'Latest activity')} sub={<>{t('Dari audit log ', 'From the ')}<Term k="ledger">{t('berantai hash', 'hash-chained')}</Term>{t('', ' audit log')}</>}>
            <ul className="divided">{d.audit.map(a => (
              <li key={a.seq} className="row between"><span><span className="mono small muted">#{a.seq}</span> {ACTION[a.action] ?? a.action} <span className="muted small">{ACTOR[a.actor_kind] ?? a.actor_kind}</span></span><span className="muted small">{dateTime(a.at)}</span></li>))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  )
}
