import 'server-only'
import { createHash } from 'node:crypto'

// Gemini through its OpenAI-compatible endpoint: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (or any
// OpenAI-compatible model run in-house). No key, no budget or an error => callers fall back to their
// deterministic output. The model never decides a score; whatever it writes must pass a grounding check.

export const llmConfigured = () => Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL)
export const llmModel = () => process.env.LLM_MODEL ?? null

type Msg = { role: 'system' | 'user'; content: string }

export async function chat(messages: Msg[], opts: { json?: object; maxTokens?: number; timeoutMs?: number } = {}) {
  if (!llmConfigured()) return { text: null as string | null, ms: 0, sha: '' }
  const sha = createHash('sha256').update(JSON.stringify(messages)).digest('hex')
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 25000)
  try {
    const res = await fetch(process.env.LLM_BASE_URL!.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 1400,
        reasoning_effort: 'none',
        ...(opts.json ? { response_format: { type: 'json_schema', json_schema: { name: 'out', strict: true, schema: opts.json } } } : {}),
      }),
    })
    if (!res.ok) {
      console.error('llm http', res.status, (await res.text()).slice(0, 300))
      return { text: null, ms: Date.now() - started, sha }
    }
    const body = await res.json()
    return { text: (body?.choices?.[0]?.message?.content as string | undefined)?.trim() ?? null, ms: Date.now() - started, sha }
  } catch (e) {
    console.error('llm error', (e as Error).name)
    return { text: null, ms: Date.now() - started, sha }
  } finally {
    clearTimeout(timer)
  }
}

export function parseJson<T>(text: string | null): T | null {
  if (!text) return null
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T
  } catch {
    return null
  }
}

const NUM = /\d[\d.,]*%?/g

function numbersIn(v: unknown, acc = new Set<string>()): Set<string> {
  if (v == null) return acc
  if (typeof v === 'number') {
    const add = (s: string) => acc.add(s)
    add(String(v)); add(v.toFixed(0)); add(v.toFixed(1)); add(v.toFixed(2))
    add((v * 100).toFixed(0)); add((v * 100).toFixed(1))
    add(Math.round(v).toLocaleString('en-US')); add(Math.round(v).toLocaleString('id-ID'))
  } else if (typeof v === 'string') {
    for (const m of v.match(NUM) ?? []) acc.add(m.replace(/%$/, ''))
  } else if (Array.isArray(v)) v.forEach(x => numbersIn(x, acc))
  else if (typeof v === 'object') Object.values(v as object).forEach(x => numbersIn(x, acc))
  return acc
}

// Every number in the text must be derivable from the source facts, otherwise reject the text.
export function grounded(text: string, source: unknown, extra: string[] = []) {
  const ok = numbersIn(source)
  extra.forEach(x => ok.add(x))
  for (const n of ['1', '2', '3', '4', '5', '250', '40']) ok.add(n)
  const norm = (s: string) => s.replace(/%$/, '').replace(/[.,]$/, '')
  const variants = (s: string) => [s, s.replace(/,/g, ''), s.replace(/\./g, ''), s.replace(/,/g, '.'), s.replace(/\./g, ',')]
  const unexplained = (text.match(NUM) ?? []).map(norm).filter(n => !variants(n).some(x => ok.has(x)))
  return { ok: unexplained.length === 0, unexplained }
}

// A quote is grounded only if it appears verbatim in the essay (whitespace and case relaxed).
export function quoteIn(quote: string, essay: string) {
  const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
  const q = squash(quote)
  return q.length >= 3 && squash(essay).includes(q)
}
