/**
 * The deck content model: what a presentation says, independent of how a design system draws it.
 *
 * A deck is `{ title, date?, presenter?, slides: Slide[] }`. Every slide has a `kind` and that
 * kind's fields below, plus optional `notes` (speaker notes, carried into the PPTX). All text
 * is plain text; the renderer escapes it. A design system draws every kind in
 * `systems/<id>/layouts.mjs`, so the same deck renders in any system.
 *
 * Kinds and fields (counts are what layouts are designed for):
 *   cover       title, subtitle?, eyebrow?
 *   agenda      title, items: string[3–6]
 *   section     number ("01"), title, subtitle?
 *   statement   text (one or two sentences, shown large), attribution?
 *   text        eyebrow?, title, body
 *   points      title, items: {title, body}[3]
 *   image-text  title, body, image: Image
 *   metrics     title, items: {value, label}[3–4]
 *   two-column  title, columns: {title, body}[2]
 *   timeline    title, steps: {when, title, body?}[3–5]
 *   quote       text, name, role?
 *   table       title, columns: string[2–4], rows: string[][2–5]
 *   big-number  value, label, body?
 *   bullets     title, items: string[3–6]
 *   team        title, people: {name, role, image?: Image}[2–4]
 *   image       image: Image, caption?
 *   chart       title, chart: Chart (see charts.mjs), caption?
 *   custom      title?, eyebrow?, html (a fragment Aeven writes; see SKILL.md "Custom slides")
 *   closing     title, subtitle?, contact?
 *
 * Image: `{ src?, alt }`. `src` is a file path or URL of the user's own picture; without it the
 * design system draws its placeholder for that slot.
 */

import { validateChart } from './charts.mjs'

/** Every slide kind a deck may use; a system draws each one, or `chart` and `custom` through its `frame`. */
export const KINDS = [
  'cover', 'agenda', 'section', 'statement', 'text', 'points', 'image-text', 'metrics',
  'two-column', 'timeline', 'quote', 'table', 'big-number', 'bullets', 'team', 'image', 'chart', 'custom', 'closing',
]

/** Throws when a deck uses an unknown kind or misses a required field. */
export function validateDeck(deck) {
  const required = {
    cover: ['title'], agenda: ['title', 'items'], section: ['number', 'title'], statement: ['text'],
    text: ['title', 'body'], points: ['title', 'items'], 'image-text': ['title', 'body', 'image'],
    metrics: ['title', 'items'], 'two-column': ['title', 'columns'], timeline: ['title', 'steps'],
    quote: ['text', 'name'], table: ['title', 'columns', 'rows'], 'big-number': ['value', 'label'],
    bullets: ['title', 'items'], team: ['title', 'people'], image: ['image'], chart: ['title', 'chart'],
    custom: ['html'], closing: ['title'],
  }
  if (!Array.isArray(deck?.slides) || deck.slides.length === 0) throw new Error('deck.slides must be a non-empty array')
  deck.slides.forEach((slide, i) => {
    const fields = required[slide.kind]
    if (!fields) throw new Error(`slide ${i + 1}: unknown kind "${slide.kind}" (kinds: ${KINDS.join(', ')})`)
    for (const field of fields) {
      if (slide[field] === undefined || slide[field] === '') throw new Error(`slide ${i + 1} (${slide.kind}): missing "${field}"`)
    }
    if (slide.kind === 'chart') {
      try { validateChart(slide.chart) } catch (error) { throw new Error(`slide ${i + 1} (chart): ${error.message}`) }
    }
  })
  return deck
}

/**
 * The gallery deck for a design system: twenty slides that show every kind, written as template
 * guidance (what each slide is for and what goes on it), the way presentation templates label
 * their placeholders. A user's deck replaces all of it.
 * @param {string} name - the template's display name, shown on the cover.
 */
export function sampleDeck(name) {
  return validateDeck({
    title: name,
    date: 'Month 2026',
    presenter: 'Your name',
    slides: [
      { kind: 'cover', eyebrow: 'Presentation template', title: name, subtitle: 'Tell Aeven your topic and it builds every slide in this design, with you.',
        notes: 'Speaker notes go here. Aeven writes them with the slides, so you know what to say on each one.' },
      { kind: 'agenda', title: 'Agenda', items: ['Where we are', 'What we found', 'What we propose', 'The plan', 'Next steps'] },
      { kind: 'section', number: '01', title: 'Section title', subtitle: 'One line on what this part covers' },
      { kind: 'statement', text: 'One sentence that says what this whole presentation is about.', attribution: 'Your key message' },
      { kind: 'text', eyebrow: 'Context', title: 'Slide title',
        body: 'A short paragraph that sets the scene: why this matters, and why now. Two or three sentences are enough; Aeven writes them with you from your notes, documents or an existing deck.' },
      { kind: 'points', title: 'Three key points', items: [
        { title: 'First point', body: 'One line that explains it.' },
        { title: 'Second point', body: 'One line that explains it.' },
        { title: 'Third point', body: 'One line that explains it.' },
      ] },
      { kind: 'image-text', title: 'A picture and its story', image: { alt: 'Your image' },
        body: 'Add your own photo, chart or screenshot; Aeven places it in this frame and writes the words beside it.' },
      { kind: 'section', number: '02', title: 'The numbers', subtitle: 'The evidence behind the story' },
      { kind: 'metrics', title: 'Key numbers', items: [
        { value: '48%', label: 'A number that matters' },
        { value: '2.4M', label: 'Another key figure' },
        { value: '12', label: 'Months, weeks or days' },
        { value: '91', label: 'A score or a rating' },
      ] },
      { kind: 'two-column', title: 'Two sides of the story', columns: [
        { title: 'Today', body: 'How things are now: the problem, in your own words.' },
        { title: 'Tomorrow', body: 'How things will be: the change you propose.' },
      ] },
      { kind: 'timeline', title: 'Timeline', steps: [
        { when: 'Q1', title: 'Start', body: 'What happens first' },
        { when: 'Q2', title: 'Build', body: 'What gets made' },
        { when: 'Q3', title: 'Launch', body: 'When it goes live' },
        { when: 'Q4', title: 'Grow', body: 'What comes after' },
      ] },
      { kind: 'quote', text: 'A quote from a customer, a colleague or an expert that backs up your point.', name: 'Full Name', role: 'Role, Company' },
      { kind: 'chart', title: 'Growth by quarter', caption: 'Charts take your own numbers and the template\'s colours.', chart: {
        type: 'column', labels: ['Q1', 'Q2', 'Q3', 'Q4'],
        series: [{ name: 'This year', values: [42, 58, 71, 96] }, { name: 'Last year', values: [30, 37, 45, 52] }],
      } },
      { kind: 'table', title: 'Compare the options', columns: ['', 'Option A', 'Option B', 'Option C'], rows: [
        ['Cost', 'Low', 'Medium', 'High'],
        ['Time', '3 months', '6 months', '9 months'],
        ['Risk', 'Medium', 'Low', 'Low'],
      ] },
      { kind: 'big-number', value: '3×', label: 'One big number', body: 'For the moment a single figure tells the whole story.' },
      { kind: 'bullets', title: 'Takeaways', items: [
        'One short line per takeaway',
        'Keep each one simple and concrete',
        'Three to six points work best',
        'Aeven turns your notes into these',
      ] },
      { kind: 'team', title: 'The team', people: [
        { name: 'Full Name', role: 'Job title' },
        { name: 'Full Name', role: 'Job title' },
        { name: 'Full Name', role: 'Job title' },
        { name: 'Full Name', role: 'Job title' },
      ] },
      { kind: 'image', image: { alt: 'Your image' }, caption: 'A full-screen picture: your product, your place or your people' },
      { kind: 'custom', eyebrow: 'Anything else', title: 'Your own layout', html: `<div style="display:grid;grid-template-columns:auto 1fr 1fr;grid-template-rows:1fr 1fr auto;gap:12px;height:100%">
  <span style="grid-row:1/3;writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;color:var(--avn-muted);font-size:14px;letter-spacing:.08em;text-transform:uppercase">Impact</span>
  <div style="background:var(--avn-accent-1);color:var(--avn-on-accent);border-radius:12px;padding:20px;font-size:22px">Quick wins</div>
  <div style="border:1px solid var(--avn-rule);border-radius:12px;padding:20px;font-size:22px">Big bets</div>
  <div style="border:1px solid var(--avn-rule);border-radius:12px;padding:20px;font-size:22px">Fill-ins</div>
  <div style="border:1px solid var(--avn-rule);border-radius:12px;padding:20px;font-size:22px;color:var(--avn-muted)">Not now</div>
  <span></span><span style="grid-column:2/4;text-align:center;color:var(--avn-muted);font-size:14px;letter-spacing:.08em;text-transform:uppercase">Effort</span>
</div>` },
      { kind: 'closing', title: 'Thank you', subtitle: 'Questions and discussion', contact: 'name@company.com' },
    ],
  })
}
