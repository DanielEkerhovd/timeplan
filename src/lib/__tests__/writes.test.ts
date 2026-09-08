import { describe, expect, it } from 'vitest'
import { tracked, writingNow } from '../writes'

describe('writingNow', () => {
  it('er sann mens en skriving pågår', async () => {
    let duringWrite = false
    await tracked(async () => {
      duringWrite = writingNow()
    })
    expect(duringWrite).toBe(true)
  })

  it('holder seg sann et lite øyeblikk etter at skrivingen er ferdig', async () => {
    await tracked(async () => {})
    // Svar som var underveis kan fortsatt være utdaterte rett etterpå.
    expect(writingNow(700)).toBe(true)
    // Med et vindu på null er det ro igjen.
    expect(writingNow(0)).toBe(false)
  })

  it('teller flere skrivinger samtidig, og slipper først når alle er ferdige', async () => {
    let release = () => {}
    const slow = tracked(() => new Promise<void>((r) => (release = r)))
    await tracked(async () => {})
    expect(writingNow(0)).toBe(true)
    release()
    await slow
    expect(writingNow(0)).toBe(false)
  })
})
