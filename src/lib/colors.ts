import type { ActivityColor } from './types'

/**
 * The 8-swatch palette from the mockups. Only the key is stored in the database;
 * the hex values live here so a colour can be tuned in one place.
 * soft = card background, accent = dot / bar, ink = text on soft, sub = secondary text on soft.
 */
export interface Palette {
  soft: string
  accent: string
  ink: string
  sub: string
  label: string
}

export const palette: Record<ActivityColor, Palette> = {
  yellow: { soft: '#FFF6DA', accent: '#F0CF7E', ink: '#6B4E00', sub: '#8A6A10', label: 'Yellow' },
  green: { soft: '#E1F1E5', accent: '#8FCBA6', ink: '#2F6B45', sub: '#4E8A63', label: 'Green' },
  coral: { soft: '#FBE3D6', accent: '#F0A58E', ink: '#8A3F1C', sub: '#A65C3A', label: 'Coral' },
  purple: { soft: '#E8E1F5', accent: '#C9B8EA', ink: '#4E3A7A', sub: '#7A66A8', label: 'Purple' },
  blue: { soft: '#E3ECF7', accent: '#9FBEE3', ink: '#2C4F73', sub: '#4F6E93', label: 'Blue' },
  teal: { soft: '#DDF1EE', accent: '#8FD0C8', ink: '#1F5F58', sub: '#3F8078', label: 'Teal' },
  pink: { soft: '#FBE2EC', accent: '#EFA9C4', ink: '#86304F', sub: '#A6506F', label: 'Pink' },
  grey: { soft: '#ECEAE5', accent: '#C9C5BE', ink: '#4E4B46', sub: '#7A7368', label: 'Grey' },
}
