/**
 * The CV content model, the gallery's sample CV, and validation.
 *
 * A CV is JSON content; a design system (`systems/<NN-id>/`) draws it. Every system reads the
 * same fields, so a CV renders in any system and keeps that system's design.
 *
 * {
 *   "system": "black",                     design system id (`node render.mjs --list`)
 *   "lang": "en",                          the CV's language, for hyphenation and the HTML lang
 *   "name": "Maya Laurent",                required
 *   "role": "Product designer",            one line under the name
 *   "greeting": "Hello, I'm",              optional line above the name; "" leaves it out
 *   "photo": { "src": "me.jpg", "alt": "…", "focus": [60, 30], "zoom": 1.5 },   the portrait, path
 *                                          relative to cv.json; focus is the point kept in view, in %
 *                                          (x, y); zoom crops into it where a design shows a small photo
 *   "backdrop": { "src": "wide.jpg" },     optional second picture behind About; defaults to photo
 *   "profile": "Two to four sentences.",   the about paragraph
 *   "contact": [ { "label": "Email", "value": "maya@example.com" } ],   2–7 rows: email, phone,
 *                                          city, website, LinkedIn, date of birth…
 *   "skills": [ { "name": "Interaction design", "level": 90, "note": "Expert, 8 years" } ],
 *                                          0–6, level 0–100; drawn as rings or bars
 *   "languages": [ { "name": "French", "level": "Native", "value": 100 } ],   0–5, value 0–100
 *   "sections": [ … ],                     the main column, in order (see below)
 *   "sidebar": [ … ],                      extra side-column sections: kinds text, tags, list
 *   "labels": { "roleLead": "I'm a", "skillsIntro": "What I do best", "languagesIntro": "Reading and writing", "about": "About", "profile": "Professional profile", "contact": "Contact",
 *               "skills": "Skills", "languages": "Languages" }    headings, in the CV's language
 * }
 *
 * A section is one of:
 *   { "kind": "timeline", "title": "Experience", "intro"?: "12 years in product design",
 *     "items": [ { "org": "Northwind", "title": "Lead designer", "dates": "2019 – now",
 *                  "place"?: "Lyon", "text"?: "One or two sentences.", "points"?: ["…", "…"],
 *                  "icon"?: "briefcase" } ] }               jobs, education, volunteering
 *   { "kind": "text", "title": "…", "text": "…" }
 *   { "kind": "tags", "title": "Tools", "items": ["Figma", "Framer"] }
 *   { "kind": "list", "title": "Awards", "items": [ { "title": "…", "meta"?: "2022", "text"?: "…" } ] }
 *
 * Icons for timeline items (ICONS below); without one, a timeline section's items take
 * briefcase, then the next icons in turn, and an education-like section takes cap, book, laptop.
 *
 * Pages: content flows onto as many A4 pages as it needs; a whole entry moves to the next page,
 * never half of one. Keep a CV to one or two pages.
 */

/** Line icons a timeline item may name. */
export const ICONS = ['briefcase', 'plane', 'compass', 'pen', 'code', 'chart', 'megaphone', 'camera', 'cap', 'book', 'laptop', 'award', 'globe', 'heart', 'flask', 'building']

/** Section kinds in the main column and in the side column. */
export const MAIN_KINDS = ['timeline', 'text', 'tags', 'list']
export const SIDE_KINDS = ['text', 'tags', 'list']

/** Default headings; a CV's `labels` overrides each one. */
export const DEFAULT_LABELS = { roleLead: "I'm a", skillsIntro: 'What I do best', languagesIntro: 'Reading and writing', about: 'About', profile: 'Professional profile', contact: 'Contact', skills: 'Skills', languages: 'Languages' }

/** The folder the sample CV's pictures live in. */
export const SAMPLES_DIR = new URL('../samples/', import.meta.url)

/** The CV every template is shown with in the gallery. */
export function sampleCv(system = 'black') {
  // Photo paths are relative to `samples/` (SAMPLES_DIR).
  return {
    system,
    lang: 'en',
    name: 'Thomas Berger',
    role: 'Art director / UX designer',
    photo: { src: 'model-AjJsc0hk9s0.jpg', alt: 'Thomas Berger', focus: [47, 30] },
    backdrop: { src: 'model-AjJsc0hk9s0.jpg' },
    greeting: "Hello, I'm",
    profile: 'Art director and UX designer with thirty years of brands, campaigns and digital products behind me. I lead teams from the first idea to the finished product, keep the craft high and the process simple, and still love sketching the first version myself.',
    contact: [
      { label: 'Email', value: 'thomas.berger@example.com' },
      { label: 'Phone', value: '+33 6 12 34 56 78' },
      { label: 'Location', value: 'Lyon, France' },
      { label: 'Website', value: 'thomasberger.studio' },
      { label: 'LinkedIn', value: 'linkedin.com/in/thomasberger' },
    ],
    skills: [
      { name: 'Art direction', level: 95, note: 'Expert, 30 years' },
      { name: 'UX design', level: 88, note: 'Advanced, 15 years' },
      { name: 'Brand identity', level: 90, note: 'Expert, 25 years' },
      { name: 'Film editing', level: 75, note: 'Fluent, 10 years' },
    ],
    languages: [
      { name: 'French', level: 'Native', value: 100 },
      { name: 'English', level: 'Fluent', value: 90 },
      { name: 'Spanish', level: 'Conversational', value: 55 },
    ],
    sections: [
      {
        kind: 'timeline',
        title: 'Experience',
        intro: 'Thirty years of design and direction',
        items: [
          { org: 'Northwind Health', title: 'Creative director', dates: '2015 – now', place: 'Lyon', icon: 'compass', text: 'Lead a team of five designing the patient app used by 2 million people.', points: ['Rebuilt booking around one flow; completion up 31%', 'Founded the design system shared by four product teams'] },
          { org: 'Atelier Rive', title: 'Art director', dates: '2006 – 2015', place: 'Paris', icon: 'briefcase', text: 'Designed and built the client portal for a studio of forty architects, from research to React components.' },
          { org: 'Panorama Media', title: 'Interaction designer', dates: '1999 – 2006', place: 'Paris', icon: 'plane', text: 'Shaped the reading experience of a news app with 600,000 daily readers across iOS, Android and web.' },
        ],
      },
      {
        kind: 'timeline',
        title: 'Education',
        intro: 'Design and computer science',
        items: [
          { org: 'ENSCI Les Ateliers', title: 'Master in interaction design', dates: '1992 – 1994', place: 'Paris', icon: 'cap', text: 'Thesis on interfaces for people with low vision, with honours.' },
          { org: 'Université Lyon 1', title: 'BSc in computer science', dates: '1989 – 1992', place: 'Lyon', icon: 'laptop', text: 'Human–computer interaction and web engineering.' },
        ],
      },
      {
        kind: 'list',
        title: 'Recognition',
        items: [
          { title: 'Red Dot Award, interface design', meta: '2023', text: 'Northwind patient app' },
          { title: 'Speaker, Paris Web', meta: '2022', text: 'Design systems that survive the second year' },
        ],
      },
    ],
    sidebar: [
      { kind: 'tags', title: 'Knowledge', items: ['Brand strategy', 'Photo direction', 'Web usability', 'Design systems', 'Typography', 'Grid & layout', 'Campaign concepts', 'Workshop facilitation', 'Video editing'] },
    ],
  }
}

/**
 * The sample CV a system's gallery shows: the shared sample with the system's own `sample`
 * fields (from its system.json) laid over it, so each template can show its own person.
 * @param {{ id: string, sample?: object }} system - a loaded system.
 * @returns {object} the CV.
 */
export function sampleFor(system) {
  const cv = { ...sampleCv(system.id), ...(system.sample ?? {}) }
  // A system shows its sample without a photo by setting photo and backdrop to null.
  for (const key of ['photo', 'backdrop']) if (cv[key] === null) delete cv[key]
  return cv
}

const isText = (v) => typeof v === 'string' && v.trim().length > 0
const fail = (path, message) => { throw new Error(`cv${path}: ${message}`) }

function checkSection(section, path, kinds) {
  if (!section || typeof section !== 'object') fail(path, 'must be an object')
  if (!kinds.includes(section.kind)) fail(`${path}.kind`, `must be one of ${kinds.join(', ')}`)
  if (!isText(section.title)) fail(`${path}.title`, 'is required')
  if (section.kind === 'text') { if (!isText(section.text)) fail(`${path}.text`, 'is required'); return }
  if (!Array.isArray(section.items) || section.items.length === 0) fail(`${path}.items`, 'needs at least one item')
  section.items.forEach((item, i) => {
    const at = `${path}.items[${i}]`
    if (section.kind === 'tags') { if (!isText(item)) fail(at, 'must be text'); return }
    if (!isText(item?.title)) fail(`${at}.title`, 'is required')
    if (section.kind === 'timeline') {
      if (item.icon !== undefined && !ICONS.includes(item.icon)) fail(`${at}.icon`, `must be one of ${ICONS.join(', ')}`)
      if (item.points !== undefined && !(Array.isArray(item.points) && item.points.every(isText))) fail(`${at}.points`, 'must be a list of text')
    }
  })
}

/**
 * Throws a message naming the first field that breaks the content model.
 * @param {object} cv - parsed cv.json.
 */
export function validateCv(cv) {
  if (!cv || typeof cv !== 'object') fail('', 'must be an object')
  if (!isText(cv.name)) fail('.name', 'is required')
  if (cv.photo !== undefined && !isText(cv.photo?.src)) fail('.photo.src', 'is required when photo is given')
  if (cv.photo?.zoom !== undefined && !(Number.isFinite(cv.photo.zoom) && cv.photo.zoom >= 1 && cv.photo.zoom <= 4)) fail('.photo.zoom', 'must be 1–4')
  if (cv.photo?.focus !== undefined && !(Array.isArray(cv.photo.focus) && cv.photo.focus.length === 2 && cv.photo.focus.every((n) => Number.isFinite(n) && n >= 0 && n <= 100))) fail('.photo.focus', 'must be [x, y] in % (0–100)')
  if (cv.backdrop !== undefined && !isText(cv.backdrop?.src)) fail('.backdrop.src', 'is required when backdrop is given')
  for (const [key, max] of [['contact', 7], ['skills', 6], ['languages', 5]]) {
    const list = cv[key] ?? []
    if (!Array.isArray(list)) fail(`.${key}`, 'must be a list')
    if (list.length > max) fail(`.${key}`, `holds at most ${max} items, has ${list.length}`)
  }
  ;(cv.contact ?? []).forEach((row, i) => { if (!isText(row?.label) || !isText(row?.value)) fail(`.contact[${i}]`, 'needs label and value') })
  ;(cv.skills ?? []).forEach((s, i) => {
    if (!isText(s?.name)) fail(`.skills[${i}].name`, 'is required')
    if (!(Number.isFinite(s.level) && s.level >= 0 && s.level <= 100)) fail(`.skills[${i}].level`, 'must be 0–100')
  })
  ;(cv.languages ?? []).forEach((l, i) => {
    if (!isText(l?.name)) fail(`.languages[${i}].name`, 'is required')
    if (l.value !== undefined && !(Number.isFinite(l.value) && l.value >= 0 && l.value <= 100)) fail(`.languages[${i}].value`, 'must be 0–100')
  })
  if (!Array.isArray(cv.sections ?? [])) fail('.sections', 'must be a list')
  ;(cv.sections ?? []).forEach((s, i) => checkSection(s, `.sections[${i}]`, MAIN_KINDS))
  if (!Array.isArray(cv.sidebar ?? [])) fail('.sidebar', 'must be a list')
  ;(cv.sidebar ?? []).forEach((s, i) => checkSection(s, `.sidebar[${i}]`, SIDE_KINDS))
}

/** The icon each item of a timeline section shows: its own, else the section's sequence. */
export function timelineIcons(section) {
  const education = /educat|school|studies|formation|estudio|学|教育/i.test(section.title)
  const sequence = education ? ['cap', 'book', 'laptop', 'award'] : ['briefcase', 'compass', 'plane', 'pen', 'chart', 'building']
  return section.items.map((item, i) => item.icon ?? sequence[i % sequence.length])
}
