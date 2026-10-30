/** Language choice for one spoken fragment: script first, then Latin stopwords, then the language already reading. */

/** Scripts that name their language outright, so no word statistics are needed. */
const SCRIPTS: readonly { readonly pattern: RegExp; readonly language: string }[] = [
  { pattern: /[\u3040-\u30ff]/, language: 'ja' },
  { pattern: /[\uac00-\ud7af\u1100-\u11ff]/, language: 'ko' },
  { pattern: /[\u4e00-\u9fff\uf900-\ufaff\u3400-\u4dbf]/, language: 'zh' },
  { pattern: /[\u0600-\u06ff\u0750-\u077f]/, language: 'ar' },
  { pattern: /[\u0590-\u05ff]/, language: 'he' },
  { pattern: /[\u0400-\u04ff]/, language: 'ru' },
  { pattern: /[\u0370-\u03ff]/, language: 'el' },
  { pattern: /[\u0900-\u097f]/, language: 'hi' },
  { pattern: /[\u0e00-\u0e7f]/, language: 'th' },
]

/** Letters a language spells and its Latin neighbours do not, which decide a short fragment. */
const LETTERS: readonly { readonly pattern: RegExp; readonly language: string }[] = [
  { pattern: /[ñ¿¡]/, language: 'es' },
  { pattern: /[ãõ]/, language: 'pt' },
  { pattern: /[çœ]/, language: 'fr' },
  { pattern: /ß/, language: 'de' },
  { pattern: /[ąćęłńśźż]/, language: 'pl' },
  { pattern: /[ığş]/, language: 'tr' },
  { pattern: /[șțăî]/, language: 'ro' },
  { pattern: /[řěů]/, language: 'cs' },
  { pattern: /[őű]/, language: 'hu' },
  { pattern: /[øæ]/, language: 'da' },
]

/** High-frequency words that separate the Latin languages this plugin reads. */
const STOPWORDS: Readonly<Record<string, readonly string[]>> = {
  en: ['the', 'and', 'that', 'you', 'is', 'are', 'of', 'to', 'for', 'with', 'this', 'it', 'we', 'not',
    'have', 'a', 'in', 'on', 'at', 'was', 'were', 'be', 'been', 'has', 'had', 'do', 'does', 'did', 'but',
    'or', 'if', 'so', 'as', 'my', 'your', 'its', 'our', 'their', 'can', 'will', 'would', 'there', 'what',
    'when', 'which', 'how', 'more', 'than', 'then', 'them', 'they', 'he', 'she', 'me', 'us', 'him', 'her',
    'one', 'also', 'just', 'only', 'into', 'from', 'about', 'over', 'here', 'should', 'could', 'these',
    'those', 'been', 'being', 'because', 'while', 'after', 'before', 'again', 'still', 'every', 'some'],
  nl: ['het', 'een', 'van', 'dat', 'niet', 'ik', 'zijn', 'wordt', 'maar', 'ook', 'nog', 'voor', 'met',
    'dit', 'de', 'en', 'is', 'op', 'te', 'je', 'hij', 'zij', 'ze', 'we', 'wij', 'jij', 'die', 'er', 'aan',
    'als', 'bij', 'om', 'uit', 'naar', 'kan', 'wel', 'geen', 'wat', 'hoe', 'dan', 'nu', 'hier', 'hem',
    'haar', 'ons', 'jullie', 'deze', 'waar', 'waarom', 'omdat', 'tussen', 'na', 'goed', 'veel', 'weer',
    'worden', 'heeft', 'hebben', 'kunnen', 'moet', 'moeten', 'zich', 'elkaar', 'steeds'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'einen', 'einem', 'mit', 'für', 'auch',
    'sich', 'wird', 'werden', 'haben', 'hat', 'dem', 'den', 'des', 'zu', 'im', 'auf', 'es', 'sie', 'wir',
    'ich', 'kann', 'können', 'mehr', 'sehr', 'aber', 'oder', 'wenn', 'wie', 'dass', 'diese', 'dieser',
    'kein', 'keine', 'noch', 'schon', 'nur', 'dann', 'hier', 'dort', 'beim', 'vom', 'zum', 'zur', 'über',
    'unter', 'nach', 'vor', 'aus', 'bei', 'durch', 'gegen', 'ohne', 'sind', 'war', 'waren', 'sein', 'muss'],
  es: ['que', 'los', 'las', 'una', 'por', 'para', 'con', 'como', 'pero', 'más', 'este', 'esta', 'hay',
    'muy', 'la', 'el', 'en', 'y', 'de', 'un', 'se', 'su', 'lo', 'al', 'del', 'es', 'no', 'si', 'mi', 'tu',
    'te', 'le', 'ya', 'sin', 'son', 'fue', 'era', 'esto', 'eso', 'aquí', 'ahora', 'porque', 'cuando',
    'donde', 'también', 'sino', 'entre', 'sobre', 'hasta', 'desde', 'todo', 'bien', 'así', 'cada',
    'va', 'van', 'ser', 'estar', 'tiene', 'tienen', 'hace', 'puede', 'debe', 'otra', 'otro', 'mismo',
    'hacia', 'según', 'nada', 'nunca', 'siempre', 'menos', 'algo', 'parte', 'vez', 'solo', 'sólo'],
  fr: ['le', 'la', 'les', 'des', 'une', 'est', 'et', 'que', 'qui', 'dans', 'pour', 'avec', 'pas', 'sur',
    'plus', 'au', 'aux', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'nous', 'vous', 'ils', 'elles', 'être',
    'avoir', 'fait', 'tout', 'comme', 'mais', 'ou', 'donc', 'très', 'aussi', 'encore', 'entre', 'sans'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'di', 'che', 'e', 'è', 'un', 'una', 'per', 'con', 'non', 'sono',
    'del', 'della', 'dei', 'degli', 'nel', 'nella', 'come', 'più', 'anche', 'questo', 'questa', 'ma',
    'se', 'ci', 'si', 'ha', 'hanno', 'essere', 'fare', 'molto', 'ancora', 'dopo', 'prima'],
  pt: ['o', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
    'que', 'para', 'com', 'não', 'se', 'por', 'mais', 'como', 'mas', 'ao', 'aos', 'é', 'são', 'foi',
    'tem', 'têm', 'ser', 'estar', 'muito', 'também', 'ainda', 'entre', 'sobre', 'depois', 'antes'],
  sv: ['och', 'att', 'det', 'som', 'på', 'är', 'av', 'för', 'med', 'den', 'till', 'inte', 'har', 'de',
    'om', 'ett', 'han', 'men', 'var', 'jag', 'sig', 'från', 'vi', 'så', 'kan', 'man', 'när', 'år', 'säger'],
  da: ['og', 'att', 'det', 'som', 'på', 'er', 'af', 'for', 'med', 'den', 'til', 'ikke', 'har', 'de',
    'om', 'et', 'han', 'men', 'var', 'jeg', 'sig', 'fra', 'vi', 'så', 'kan', 'man', 'når', 'år'],
  no: ['og', 'å', 'det', 'som', 'på', 'er', 'av', 'for', 'med', 'den', 'til', 'ikke', 'har', 'de',
    'om', 'et', 'han', 'men', 'var', 'jeg', 'seg', 'fra', 'vi', 'så', 'kan', 'man', 'når', 'år'],
  fi: ['ja', 'on', 'ei', 'että', 'se', 'hän', 'mutta', 'kun', 'niin', 'myös', 'vain', 'voi', 'olla',
    'ovat', 'tämä', 'sen', 'joka', 'kanssa', 'jälkeen', 'ennen', 'sitten', 'vielä', 'jo'],
  pl: ['i', 'w', 'z', 'na', 'do', 'nie', 'to', 'jest', 'się', 'że', 'jak', 'ale', 'po', 'co', 'tak',
    'ten', 'ta', 'te', 'dla', 'od', 'przez', 'oraz', 'już', 'jeszcze', 'tylko', 'bardzo', 'może'],
  tr: ['ve', 'bir', 'bu', 'ile', 'için', 'de', 'da', 'ne', 'olarak', 'çok', 'daha', 'gibi', 'ama',
    'var', 'yok', 'sonra', 'önce', 'kadar', 'her', 'en', 'ise', 'değil', 'olan'],
  cs: ['a', 'v', 'se', 'na', 'je', 'to', 'že', 's', 'z', 'do', 'ale', 'jak', 'po', 'pro', 'co', 'tak',
    'ten', 'ta', 'ty', 'od', 'už', 'ještě', 'jen', 'velmi', 'může', 'být', 'jsou'],
  ro: ['și', 'în', 'de', 'la', 'cu', 'pe', 'un', 'o', 'este', 'sunt', 'nu', 'că', 'mai', 'pentru',
    'din', 'care', 'dar', 'sau', 'dacă', 'foarte', 'după', 'înainte', 'fost', 'are'],
  hu: ['a', 'az', 'és', 'hogy', 'nem', 'is', 'egy', 'van', 'már', 'csak', 'még', 'de', 'ha', 'mint',
    'volt', 'lesz', 'kell', 'lehet', 'nagyon', 'után', 'előtt', 'között', 'ez', 'azt'],
}

/** A language's own letters outrank two stopwords, because a neighbour does not spell them. */
const LETTER_WEIGHT = 2

/**
 * Pick the language whose voice should read one fragment.
 * @param text - fragment about to be synthesized.
 * @param fallback - language already being read, used when the fragment carries no signal of its own.
 * @returns a primary language subtag the Host maps to a voice.
 */
export function detectLanguage(text: string, fallback: string): string {
  for (const { pattern, language } of SCRIPTS) if (pattern.test(text)) return language
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length === 0) return fallback
  const scores: Record<string, number> = {}
  for (const { pattern, language } of LETTERS) if (pattern.test(text)) scores[language] = LETTER_WEIGHT
  for (const [language, markers] of Object.entries(STOPWORDS)) {
    let score = scores[language] ?? 0
    for (const word of words) if (markers.includes(word)) score += 1
    scores[language] = score
  }
  let best = fallback
  let bestScore = 0
  for (const [language, score] of Object.entries(scores)) {
    if (score > bestScore) { best = language; bestScore = score }
  }
  return best
}
