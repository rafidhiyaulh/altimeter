import { bilingual, tr } from './i18n'

// Human names for the writing model's features (shown in "why this band").
export const FEATURE = bilingual({
  n_words: ['Jumlah kata', 'Word count'], log_words: ['Panjang esai', 'Essay length'], n_sentences: ['Jumlah kalimat', 'Sentences'],
  n_paragraphs: ['Jumlah paragraf', 'Paragraphs'], words_per_paragraph: ['Kata per paragraf', 'Words per paragraph'],
  sent_len_mean: ['Panjang kalimat rata-rata', 'Average sentence length'], sent_len_sd: ['Variasi panjang kalimat', 'Sentence length variety'],
  sent_len_max: ['Kalimat terpanjang', 'Longest sentence'], word_len_mean: ['Panjang kata rata-rata', 'Average word length'],
  long_word_ratio: ['Porsi kata panjang', 'Share of long words'], mattr50: ['Keragaman kosakata', 'Vocabulary diversity'],
  hapax_ratio: ['Kata yang muncul sekali', 'Words used once'], distinct_ratio: ['Kata unik', 'Distinct words'],
  oov_ratio: ['Kata tak dikenali (ejaan)', 'Unrecognised words (spelling)'], log_rank_mean: ['Kelangkaan kata', 'Word rarity'],
  rare_2k_ratio: ['Kata di luar 2.000 teratas', 'Words beyond the top 2,000'], rare_5k_ratio: ['Kata di luar 5.000 teratas', 'Words beyond the top 5,000'],
  connectives_per_sent: ['Penghubung per kalimat', 'Linking devices per sentence'], connectives_distinct: ['Ragam penghubung', 'Range of linking devices'],
  subordinators_per_sent: ['Klausa bawahan per kalimat', 'Subordinate clauses per sentence'], pronoun_ratio: ['Porsi kata ganti', 'Pronoun share'],
  passive_per100: ['Kalimat pasif', 'Passive voice'], stock_phrases: ['Frasa template', 'Template phrases'],
  errors_per100: ['Kesalahan pola umum', 'Common-pattern errors'], error_kinds: ['Jenis kesalahan', 'Kinds of error'],
  lowercase_sentence_start: ['Kalimat diawali huruf kecil', 'Sentences starting lowercase'], lowercase_i_per100: ['"i" huruf kecil', 'Lowercase "i"'],
  comma_no_space_per100: ['Koma tanpa spasi', 'Comma without a space'], space_before_punct_per100: ['Spasi sebelum tanda baca', 'Space before punctuation'],
  repeated_word_per100: ['Kata berulang', 'Repeated words'], exclaim_question: ['Tanda seru / tanya', 'Exclamation / question marks'],
  contractions_per100: ['Singkatan informal', 'Informal contractions'], prompt_coverage: ['Kata kunci soal yang dibahas', 'Prompt key words covered'],
  intro_prompt_coverage: ['Kata kunci soal di pembuka', 'Prompt key words in the introduction'], has_opinion: ['Posisi pendapat jelas', 'Clear position'],
  has_conclusion: ['Paragraf kesimpulan', 'Concluding paragraph'], conclusion_anywhere: ['Penanda kesimpulan', 'Conclusion marker'],
  q_discuss_both: ['Soal: bahas dua pandangan', 'Prompt: discuss both views'], q_adv_disadv: ['Soal: untung-rugi', 'Prompt: advantages / disadvantages'],
  q_cause_solution: ['Soal: sebab-solusi', 'Prompt: causes / solutions'], q_opinion: ['Soal: pendapat', 'Prompt: opinion'], under_250: ['Di bawah 250 kata', 'Under 250 words'],
} as const)
export const featureLabel = (k: string) => (FEATURE as Record<string, string>)[k] ?? (k.startsWith('err_') ? tr('Pola kesalahan: ', 'Error pattern: ') + k.slice(4).replace(/_/g, ' ') : k)

export const FLAG = bilingual({
  too_short: ['Terlalu pendek', 'Too short'], off_topic: ['Mungkin keluar topik', 'Possibly off topic'],
  unusual_vocabulary: ['Banyak kata tak dikenali', 'Many unrecognised words'], template_heavy: ['Banyak frasa template', 'Template-heavy'],
  borderline: ['Dekat batas band', 'Close to the next band'],
} as const)
export const flagLabel = (k: string) => (FLAG as Record<string, string>)[k] ?? k
