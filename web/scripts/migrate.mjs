// Apply db/migrations/*.sql in order, each once and in its own transaction, over HTTPS (Supabase
// Management API through the CLI; see dbq.sh). Pass a file name to re-apply that file.
// Also sets the alt_app login password from ALT_APP_PASSWORD (via a temp file, never on the command line).
// usage: node --env-file=../.env.local scripts/migrate.mjs [0003_runtime.sql]
import { readdirSync, readFileSync } from 'node:fs'
import { runSql } from './lib/dbq.mjs'

const DIR = new URL('../../db/migrations/', import.meta.url)
const only = process.argv[2]
runSql(`create schema if not exists alt;
        create table if not exists alt.schema_migrations (name text primary key, applied_at timestamptz not null default now());`)
const done = new Set(runSql('select name from alt.schema_migrations').map(r => r.name))
for (const name of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(name) && name !== only) continue
  process.stdout.write(`apply ${name} ... `)
  const body = readFileSync(new URL(name, DIR), 'utf8')
  runSql(`begin;\n${body}\n;insert into alt.schema_migrations (name) values ('${name}') on conflict (name) do update set applied_at = now();\ncommit;`)
  console.log('ok')
}
if (process.env.ALT_APP_PASSWORD) {
  runSql(`alter role alt_app with login password '${process.env.ALT_APP_PASSWORD.replace(/'/g, "''")}'`)
  console.log('alt_app password set')
}
