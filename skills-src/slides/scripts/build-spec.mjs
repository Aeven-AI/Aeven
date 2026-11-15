/**
 * Builds the single deck spec every renderer reads (`spec/templates.json`) from
 * the harvested template list and its sections. Accent hues vary by family; the
 * surface, type scale, and layout geometry stay the ones measured off the Figma
 * source deck (see SKILL.md).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { SECTIONS } from './content.mjs'

const FAMILY_ACCENT = {
  editorial: { accent: '#5864FF', artA: '#2B1B8A', artB: '#7C6BFF' },
  swiss: { accent: '#5864FF', artA: '#152E8C', artB: '#5D8BFF' },
  darktech: { accent: '#4F7BFF', artA: '#0F2B6B', artB: '#38A2FF' },
  gradient: { accent: '#7A5CFF', artA: '#4A1D9E', artB: '#B36BFF' },
  paper: { accent: '#6F6AFF', artA: '#2A2660', artB: '#9C93FF' },
  retro: { accent: '#6D6BFF', artA: '#3A1C7A', artB: '#FF7AC6' },
  report: { accent: '#5468E8', artA: '#172A6E', artB: '#6E8DFF' },
  photo: { accent: '#5A6BFF', artA: '#1B2C6B', artB: '#8AA7FF' },
  playful: { accent: '#6C5CFF', artA: '#4B1FA6', artB: '#FF8AD1' },
  corporate: { accent: '#4D63E0', artA: '#12255E', artB: '#6E9BFF' },
}

const FALLBACK_SECTIONS = [
  'The problem', 'The product', 'The evidence', 'The market', 'The plan', 'The team', 'The ask',
]

const { templates } = JSON.parse(readFileSync(new URL('./templates.json', import.meta.url), 'utf8'))

const spec = {
  design: {
    width: 1280,
    height: 720,
    surface: '#0E1821',
    coverSurface: '#080E1F',
    light: '#DCE0E6',
    white: '#FAFAFA',
    muted: '#BAC1CC',
    inkOnLight: '#525761',
    sourceFile: 'https://www.figma.com/design/dzRN7x0uzKr3UqQWumW80b/Design-Presentation-Deck--Community-',
  },
  templates: templates.map(template => ({
    id: template.id,
    name: template.name,
    family: template.family,
    display: template.display,
    sub: template.sub,
    sections: SECTIONS[template.id] ?? FALLBACK_SECTIONS,
    ...(FAMILY_ACCENT[template.family] ?? FAMILY_ACCENT.swiss),
    slides: [
      'cover', 'stage', 'divider', 'two-col', 'cards', 'divider', 'metrics', 'rows', 'stage',
      'timeline', 'divider', 'quote', 'cards', 'diagram', 'metrics', 'two-col', 'rows', 'stage',
      'divider', 'end',
    ],
  })),
}

mkdirSync(new URL('../spec/', import.meta.url), { recursive: true })
writeFileSync(new URL('../spec/templates.json', import.meta.url), `${JSON.stringify(spec, null, 2)}\n`)
console.log(`wrote spec/templates.json with ${spec.templates.length} templates`)
