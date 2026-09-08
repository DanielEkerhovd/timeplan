import type { ActivityColor } from './types'

/**
 * The 8-swatch palette from the mockups. Only the key is stored in the database;
 * the hex values live in src/index.css (light and dark).
 * soft = card background, accent = dot / bar, ink = text on soft, sub = secondary text on soft.
 */
export interface Palette {
  soft: string
  accent: string
  ink: string
  sub: string
  label: string
}

const v = (c: ActivityColor, part: 'soft' | 'accent' | 'ink' | 'sub') => `var(--act-${c}-${part})`
const labels: Record<ActivityColor, string> = { yellow: 'Yellow', green: 'Green', coral: 'Coral', purple: 'Purple', blue: 'Blue', teal: 'Teal', pink: 'Pink', grey: 'Grey' }

/** Values are CSS variables (see index.css), so they follow light/dark mode automatically. */
export const palette = Object.fromEntries(
  (Object.keys(labels) as ActivityColor[]).map((c) => [c, { soft: v(c, 'soft'), accent: v(c, 'accent'), ink: v(c, 'ink'), sub: v(c, 'sub'), label: labels[c] }]),
) as Record<ActivityColor, Palette>
