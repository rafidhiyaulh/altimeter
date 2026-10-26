// SQL over HTTPS: Supabase Management API through the CLI, as the postgres role. Used by the migration,
// seed and setup scripts (direct Postgres TCP is not always available from a dev laptop).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workdir = process.env.ALT_SUPABASE_WORKDIR ?? `${process.env.HOME}/Developer/perisai`

export function runSql(text) {
  const dir = mkdtempSync(join(tmpdir(), 'alt-sql-'))
  const f = join(dir, 'q.sql')
  writeFileSync(f, text, { mode: 0o600 })
  try {
    const out = execFileSync('supabase', ['db', 'query', '--linked', '--workdir', workdir, '--output-format', 'json', '-f', f],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    return JSON.parse(out.slice(out.indexOf('{'))).rows ?? []
  } catch (e) {
    const msg = String(e.stdout || '') + String(e.stderr || '') || String(e.message)
    throw new Error(msg.split('\n').filter(l => !/new version|recommend updating/i.test(l)).join('\n').slice(0, 3000))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export const lit = v => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
