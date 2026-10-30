/**
 * Choosing the voice for one fragment: a script names its language outright, a language's own letters
 * and stopwords separate the Latin ones, and the language already being read speaks anything else.
 */
import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../src/client/language.ts'

describe('detectLanguage', () => {
  it('names a script\u2019s language without scoring words', () => {
    expect(detectLanguage('こんにちは', 'en')).toBe('ja')
    expect(detectLanguage('안녕하세요', 'en')).toBe('ko')
    expect(detectLanguage('你好世界', 'en')).toBe('zh')
    expect(detectLanguage('مرحبا', 'en')).toBe('ar')
    expect(detectLanguage('שלום', 'en')).toBe('he')
    expect(detectLanguage('Привет', 'en')).toBe('ru')
    expect(detectLanguage('Γειά σου', 'en')).toBe('el')
    expect(detectLanguage('नमस्ते', 'en')).toBe('hi')
    expect(detectLanguage('สวัสดี', 'en')).toBe('th')
  })

  it('reads a mixed Japanese fragment as Japanese, the first script that matches', () => {
    expect(detectLanguage('日本語のテキスト', 'en')).toBe('ja')
  })

  it('lets a script outrank stopwords the fragment also carries', () => {
    expect(detectLanguage('the answer is 你好', 'en')).toBe('zh')
  })

  it('identifies a Latin language by the letters only it spells', () => {
    expect(detectLanguage('¡Hola!', 'en')).toBe('es')
    expect(detectLanguage('Ação', 'en')).toBe('pt')
    expect(detectLanguage('Français', 'en')).toBe('fr')
    expect(detectLanguage('Straße', 'en')).toBe('de')
    expect(detectLanguage('Łódź', 'en')).toBe('pl')
    expect(detectLanguage('Işık', 'en')).toBe('tr')
    expect(detectLanguage('Țară', 'en')).toBe('ro')
    expect(detectLanguage('řeka', 'en')).toBe('cs')
    expect(detectLanguage('ősz', 'en')).toBe('hu')
    expect(detectLanguage('Blåbær', 'en')).toBe('da')
  })

  it('counts high-frequency words for English', () => {
    expect(detectLanguage('the quick brown fox and the dog', 'fr')).toBe('en')
  })

  it('counts high-frequency words for Dutch, ahead of English sharing some of them', () => {
    expect(detectLanguage('het is niet goed dat we gaan', 'en')).toBe('nl')
  })

  it('counts high-frequency words for German', () => {
    expect(detectLanguage('die Katze und das ist nicht ein Hund', 'en')).toBe('de')
  })

  it('counts high-frequency words for Spanish, French, Italian and Portuguese', () => {
    expect(detectLanguage('el perro y la casa de mi madre', 'en')).toBe('es')
    expect(detectLanguage('le chat et le chien dans la maison', 'en')).toBe('fr')
    expect(detectLanguage('il gatto e il cane sono nella casa', 'en')).toBe('it')
    expect(detectLanguage('o gato e o cão têm sido muito bons', 'en')).toBe('pt')
  })

  it('counts high-frequency words for the North Germanic and Finnish languages', () => {
    expect(detectLanguage('och att det som på är', 'en')).toBe('sv')
    expect(detectLanguage('og å det som på er ikke', 'en')).toBe('no')
    expect(detectLanguage('ja on että se hän mutta', 'en')).toBe('fi')
  })

  it('counts high-frequency words for Polish, Czech, Turkish, Romanian and Hungarian', () => {
    expect(detectLanguage('nie to jest się że jak ale', 'en')).toBe('pl')
    expect(detectLanguage('je to že s z do ale', 'en')).toBe('cs')
    expect(detectLanguage('ve bir bu için çok daha gibi', 'en')).toBe('tr')
    expect(detectLanguage('și în de la cu pe un o', 'en')).toBe('ro')
    expect(detectLanguage('az és hogy nem is egy van', 'en')).toBe('hu')
  })

  it('falls back to the language already being read when the fragment carries no signal', () => {
    expect(detectLanguage('Zzz', 'fr')).toBe('fr')
  })

  it('falls back when the fragment carries no letters at all', () => {
    expect(detectLanguage('12345', 'es')).toBe('es')
    expect(detectLanguage('', 'nl')).toBe('nl')
  })
})
