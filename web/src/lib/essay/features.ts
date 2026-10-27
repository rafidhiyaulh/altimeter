// Essay features for the writing scorer. This file is the ONLY implementation: the training pipeline
// (scripts/dump-features.mjs -> ml/) and the serving worker both call extractFeatures(), so a model
// trained in Python sees exactly the numbers it will see in production.
// Plain, erasable TypeScript only (Node runs it directly with type stripping).

export type Lexicon = { words: string[] }            // ordered by training-corpus document frequency
export type FeatureVector = Record<string, number>

const WORD = /[a-z]+(?:'[a-z]+)?/g

export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .trim()
}

export function tokenize(s: string): string[] {
  return normalizeText(s).toLowerCase().match(WORD) ?? []
}

export function sentencesOf(s: string): string[] {
  return normalizeText(s)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(x => x.trim())
    .filter(x => (x.match(/[A-Za-z]/g) ?? []).length >= 3)
}

export function paragraphsOf(s: string): string[] {
  return normalizeText(s).split(/\n+/).map(x => x.trim()).filter(x => x.length > 0)
}

const STOP = new Set(('a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those ' +
  'there their they them he she his her we our you your i me my not no do does did have has had can could will would should ' +
  'may might must so than then too very also such more most many much some any all each other into about over after before ' +
  'which who whom whose what when where why how while because although though however therefore thus one people').split(' '))

const CONNECTIVES = [
  'however', 'moreover', 'furthermore', 'in addition', 'additionally', 'consequently', 'therefore', 'thus', 'hence',
  'as a result', 'on the other hand', 'in contrast', 'nevertheless', 'nonetheless', 'whereas', 'although', 'even though',
  'despite', 'in spite of', 'for example', 'for instance', 'such as', 'in particular', 'firstly', 'secondly', 'thirdly',
  'finally', 'lastly', 'in conclusion', 'to conclude', 'to sum up', 'in summary', 'overall', 'similarly', 'likewise',
  'meanwhile', 'subsequently', 'accordingly', 'in other words', 'that is to say', 'notably', 'admittedly', 'conversely',
]
const SUBORDINATORS = ['which', 'who', 'whom', 'whose', 'that', 'although', 'because', 'while', 'whereas', 'if', 'unless', 'since', 'when', 'whether', 'so that']

// Memorised "template" phrases: a few are normal, many signal a pre-learned essay frame.
const STOCK = [
  'it is undeniable that', 'in this day and age', 'a double-edged sword', 'has both advantages and disadvantages',
  'this essay will discuss', 'this essay will examine', 'from my point of view', 'there is no denying that',
  'it is widely believed that', 'it is a well-known fact', 'nowadays', 'in the modern world', 'play a vital role',
  'play an important role', 'last but not least', 'with the advent of', 'it goes without saying', 'all in all',
]

// Error patterns common for Indonesian and other Asian learners of English (articles, plurals, verb forms).
// Each regex is matched on the lowercased text; counts are per 100 words.
const ERROR_PATTERNS: [string, RegExp][] = [
  ['a_vowel', /\ba (?:[aeio][a-z]+)\b/g],
  ['an_consonant', /\ban (?:[bcdfgjklmnpqrstvwxyz][a-z]+)\b/g],
  ['uncountable_plural', /\b(?:informations|advices|equipments|furnitures|knowledges|researches|evidences|homeworks|feedbacks|staffs|luggages)\b/g],
  ['irregular_plural', /\b(?:peoples|childrens|womens|mens|persons who is)\b/g],
  ['double_comparative', /\bmore (?:better|worse|easier|harder|bigger|smaller|cheaper|faster|higher|lower)\b/g],
  ['modal_to', /\b(?:can|could|will|would|should|must|may|might) to [a-z]+/g],
  ['modal_past', /\b(?:can|could|will|would|should|must|may|might) (?:went|did|was|were|had|made|got|took|gave)\b/g],
  ['did_past', /\b(?:did|didn't|does|doesn't|do not|don't) (?:went|did|was|were|had|made|got|took|gave|came)\b/g],
  ['agreement_they_is', /\b(?:they|we|you|people|students|children) (?:is|was|has)\b/g],
  ['agreement_it_are', /\b(?:it|he|she|this|that) (?:are|were|have)\b/g],
  ['the_most_of', /\bthe most of\b/g],
  ['lack_of_of', /\black of of\b/g],
  ['although_but', /\balthough [^.]{1,80}, but\b/g],
  ['despite_of', /\bdespite of\b/g],
  ['discuss_about', /\bdiscuss about\b/g],
  ['make_to', /\bmake [a-z]+ to [a-z]+/g],
  ['very_adj_superlative', /\bvery (?:best|worst|most)\b/g],
  ['every_plural', /\bevery [a-z]+s\b(?<!\bevery (?:class|process|business|address|access|success|bus))/g],
]

const PRONOUNS = new Set(['it', 'they', 'this', 'that', 'these', 'those', 'he', 'she', 'them', 'their', 'its'])
const OPINION = /\b(?:i (?:believe|think|feel|would argue|agree|disagree|strongly)|in my (?:opinion|view)|my (?:view|opinion) is|from my perspective)\b/
const CONCLUSION = /\b(?:in conclusion|to conclude|to sum up|in summary|overall,|all in all|to summarise|to summarize)\b/
const QUESTION_BOTH = /\bdiscuss both\b|\bboth (?:these )?views\b/
const QUESTION_ADV = /\badvantages?\b.*\bdisadvantages?\b|\bpositive\b.*\bnegative\b/
const QUESTION_CAUSE = /\b(?:causes?|reasons?|why)\b.*\b(?:solutions?|solve|measures|tackle|address)\b/
const QUESTION_OPINION = /\b(?:to what extent|do you agree|agree or disagree|your opinion|what do you think)\b/

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

function countPhrase(text: string, phrase: string): number {
  let n = 0
  let i = text.indexOf(phrase)
  while (i >= 0) {
    const before = i === 0 ? ' ' : text[i - 1]
    const after = text[i + phrase.length] ?? ' '
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) n++
    i = text.indexOf(phrase, i + phrase.length)
  }
  return n
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1))
}

// Moving-average type-token ratio: length-robust lexical diversity.
function mattr(tokens: string[], w = 50): number {
  if (tokens.length === 0) return 0
  if (tokens.length <= w) return new Set(tokens).size / tokens.length
  const counts = new Map<string, number>()
  for (let i = 0; i < w; i++) counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1)
  let total = counts.size
  for (let i = w; i < tokens.length; i++) {
    const out = tokens[i - w]
    const c = counts.get(out)! - 1
    if (c === 0) counts.delete(out)
    else counts.set(out, c)
    counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1)
    total += counts.size
  }
  return total / (tokens.length - w + 1) / w
}

export type LexIndex = Map<string, number>
const lexCache = new WeakMap<Lexicon, LexIndex>()
export function lexIndex(lex: Lexicon): LexIndex {
  let ix = lexCache.get(lex)
  if (!ix) {
    ix = new Map(lex.words.map((w, i) => [w, i + 1]))
    lexCache.set(lex, ix)
  }
  return ix
}

export function questionType(prompt: string): string {
  const p = normalizeText(prompt).toLowerCase()
  if (QUESTION_BOTH.test(p)) return 'discuss_both'
  if (QUESTION_ADV.test(p)) return 'adv_disadv'
  if (QUESTION_CAUSE.test(p)) return 'cause_solution'
  if (QUESTION_OPINION.test(p)) return 'opinion'
  return 'two_part'
}

export function extractFeatures(prompt: string, essay: string, lex: Lexicon): FeatureVector {
  const ix = lexIndex(lex)
  const text = normalizeText(essay)
  const lower = text.toLowerCase()
  const tokens = tokenize(text)
  const n = Math.max(1, tokens.length)
  const per100 = (k: number) => (k / n) * 100
  const sents = sentencesOf(text)
  const sentLens = sents.map(s => tokenize(s).length).filter(x => x > 0)
  const paras = paragraphsOf(text)
  const content = tokens.filter(t => !STOP.has(t) && t.length > 2)
  const ranks = content.map(t => ix.get(t) ?? 0)
  const known = ranks.filter(r => r > 0)
  const counts = new Map<string, number>()
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
  const hapax = [...counts.values()].filter(c => c === 1).length

  const promptTokens = new Set(tokenize(prompt).filter(t => !STOP.has(t) && t.length > 2))
  const essaySet = new Set(content)
  const covered = [...promptTokens].filter(t => essaySet.has(t)).length
  const firstPara = paras[0]?.toLowerCase() ?? ''
  const lastPara = paras[paras.length - 1]?.toLowerCase() ?? ''
  const firstParaTokens = new Set(tokenize(firstPara))
  const introCover = promptTokens.size ? [...promptTokens].filter(t => firstParaTokens.has(t)).length / promptTokens.size : 0

  const connectiveHits = CONNECTIVES.map(c => countPhrase(lower, c))
  const subordinators = SUBORDINATORS.reduce((a, c) => a + countPhrase(lower, c), 0)
  const stock = STOCK.reduce((a, c) => a + countPhrase(lower, c), 0)
  const errorCounts = ERROR_PATTERNS.map(([, re]) => count(lower, re))
  const qt = questionType(prompt)

  const f: FeatureVector = {
    n_words: tokens.length,
    log_words: Math.log(n),
    n_sentences: sents.length,
    n_paragraphs: paras.length,
    words_per_paragraph: tokens.length / Math.max(1, paras.length),
    sent_len_mean: mean(sentLens),
    sent_len_sd: sd(sentLens),
    sent_len_max: sentLens.length ? Math.max(...sentLens) : 0,
    word_len_mean: mean(tokens.map(t => t.length)),
    long_word_ratio: tokens.filter(t => t.length >= 8).length / n,
    mattr50: mattr(tokens),
    hapax_ratio: hapax / n,
    distinct_ratio: counts.size / n,
    oov_ratio: content.length ? ranks.filter(r => r === 0).length / content.length : 0,
    log_rank_mean: known.length ? mean(known.map(r => Math.log(r))) : 0,
    rare_2k_ratio: known.length ? known.filter(r => r > 2000).length / known.length : 0,
    rare_5k_ratio: known.length ? known.filter(r => r > 5000).length / known.length : 0,
    connectives_per_sent: connectiveHits.reduce((a, b) => a + b, 0) / Math.max(1, sents.length),
    connectives_distinct: connectiveHits.filter(c => c > 0).length,
    subordinators_per_sent: subordinators / Math.max(1, sents.length),
    pronoun_ratio: tokens.filter(t => PRONOUNS.has(t)).length / n,
    passive_per100: per100(count(lower, /\b(?:is|are|was|were|be|been|being)\s+[a-z]+ed\b/g)),
    stock_phrases: stock,
    errors_per100: per100(errorCounts.reduce((a, b) => a + b, 0)),
    error_kinds: errorCounts.filter(c => c > 0).length,
    lowercase_sentence_start: sents.filter(s => /^[a-z]/.test(s)).length / Math.max(1, sents.length),
    lowercase_i_per100: per100(count(text, /(?:^|\s)i(?:\s|'|$)/g)),
    comma_no_space_per100: per100(count(text, /,[A-Za-z]/g)),
    space_before_punct_per100: per100(count(text, /\s[,.;:!?]/g)),
    repeated_word_per100: per100(count(lower, /\b([a-z]+)\s+\1\b/g)),
    exclaim_question: count(text, /[!?]/g),
    contractions_per100: per100(count(lower, /\b[a-z]+n't\b|\b(?:i'm|it's|they're|we're|you're|i've|we've|that's)\b/g)),
    prompt_coverage: promptTokens.size ? covered / promptTokens.size : 0,
    intro_prompt_coverage: introCover,
    has_opinion: OPINION.test(lower) ? 1 : 0,
    has_conclusion: CONCLUSION.test(lastPara) ? 1 : 0,
    conclusion_anywhere: CONCLUSION.test(lower) ? 1 : 0,
    q_discuss_both: qt === 'discuss_both' ? 1 : 0,
    q_adv_disadv: qt === 'adv_disadv' ? 1 : 0,
    q_cause_solution: qt === 'cause_solution' ? 1 : 0,
    q_opinion: qt === 'opinion' ? 1 : 0,
    under_250: tokens.length < 250 ? 1 : 0,
  }
  ERROR_PATTERNS.forEach(([k], i) => { f[`err_${k}`] = per100(errorCounts[i]) })
  return f
}

export const FEATURE_NAMES: string[] = Object.keys(extractFeatures('Discuss both views.', 'A short essay.\n\nIt has two paragraphs.', { words: [] }))

// Short, human-readable evidence for the feedback layer: which error patterns fired, with the exact text.
export function errorEvidence(essay: string, max = 6): { kind: string; quote: string }[] {
  const text = normalizeText(essay)
  const lower = text.toLowerCase()
  const out: { kind: string; quote: string }[] = []
  for (const [kind, re] of ERROR_PATTERNS) {
    for (const m of lower.matchAll(new RegExp(re.source, 'g'))) {
      if (m.index == null) continue
      out.push({ kind, quote: text.slice(m.index, m.index + m[0].length) })
      if (out.length >= max) return out
    }
  }
  return out
}
