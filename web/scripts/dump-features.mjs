// Build the lexicon from the TRAINING split only, then write features for every essay with the same
// extractFeatures() the worker uses in production.
// usage: node scripts/dump-features.mjs ../ml/data/work/essays.jsonl ../ml/data/work/features.jsonl [--keep-lexicon]
import { readFileSync, writeFileSync } from 'node:fs'
import { extractFeatures, tokenize, FEATURE_NAMES } from '../src/lib/essay/features.ts'

const [src, dst] = process.argv.slice(2)
const keepLexicon = process.argv.includes('--keep-lexicon')
const LEX = new URL('../src/lib/essay/lexicon.json', import.meta.url)
const rows = readFileSync(src, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))

let lex
if (keepLexicon) {
  lex = JSON.parse(readFileSync(LEX, 'utf8'))
} else {
  const df = new Map()
  for (const r of rows.filter(r => r.split === 'train')) for (const t of new Set(tokenize(r.essay))) df.set(t, (df.get(t) ?? 0) + 1)
  const words = [...df.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 20000).map(([w]) => w)
  lex = { source: 'btnotpt/ielts_task_2 (Apache-2.0), training split, document frequency >= 3', words }
  writeFileSync(LEX, JSON.stringify(lex))
  console.log('lexicon words', words.length)
}

const out = rows.map(r => JSON.stringify({ id: r.id, ...extractFeatures(r.topic ?? '', r.essay, lex) }))
writeFileSync(dst, out.join('\n') + '\n')
console.log('features', FEATURE_NAMES.length, 'rows', out.length)
