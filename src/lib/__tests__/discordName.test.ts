import { describe, expect, it } from 'vitest'
import { discordNameFrom } from '../discordName'

describe('discordNameFrom', () => {
  it('tar visningsnavnet før kontonavnet', () => {
    expect(
      discordNameFrom({ preferred_username: 'fabbiel', full_name: 'fabbiel', global_name: 'Fabe' }),
    ).toBe('Fabe')
  })

  it('finner global_name under custom_claims', () => {
    expect(discordNameFrom({ name: 'fabbiel', custom_claims: { global_name: 'Fabe' } })).toBe('Fabe')
  })

  it('faller tilbake til kontonavnet når det ikke finnes noe visningsnavn', () => {
    expect(discordNameFrom({ full_name: 'fabbiel' })).toBe('fabbiel')
  })

  it('hopper over tomme verdier', () => {
    expect(discordNameFrom({ global_name: '   ', full_name: 'fabbiel' })).toBe('fabbiel')
  })

  it('gir null når det ikke er noe å hente', () => {
    expect(discordNameFrom({})).toBe(null)
    expect(discordNameFrom(undefined)).toBe(null)
  })
})
