import { describe, expect, it } from 'vitest'
import { DEPTH_TIERS, PETALS_FULL, PETALS_LIGHT, petalCountFor, petalField, petalRgb, seeded, tierFor, wrap } from './petals.ts'

const desktop = { reducedMotion: false, saveData: false, coarse: false, narrow: false }

describe('petal budget', () => {
  it('draws 40 on desktop, 16 on phones or save-data, none under reduced motion', () => {
    expect(petalCountFor(desktop)).toBe(PETALS_FULL)
    expect(PETALS_FULL).toBe(40)
    expect(petalCountFor({ ...desktop, coarse: true })).toBe(PETALS_LIGHT)
    expect(petalCountFor({ ...desktop, narrow: true })).toBe(PETALS_LIGHT)
    expect(petalCountFor({ ...desktop, saveData: true })).toBe(PETALS_LIGHT)
    expect(PETALS_LIGHT).toBe(16)
    expect(petalCountFor({ ...desktop, reducedMotion: true, coarse: true })).toBe(0)
  })
})

describe('petal field', () => {
  it('is the same field on every visit', () => {
    const a = seeded(7)
    const b = seeded(7)
    for (let i = 0; i < 5; i++) expect(a()).toBe(b())
    expect(Array.from(petalField(40).x)).toEqual(Array.from(petalField(40).x))
  })

  it('keeps seeds in range and draws far petals first', () => {
    const field = petalField(40)
    for (let i = 0; i < field.count; i++) {
      expect(field.x[i]).toBeGreaterThanOrEqual(0)
      expect(field.x[i]).toBeLessThan(1)
      expect(field.speed[i]).toBeGreaterThanOrEqual(0.8 - 1e-6)
      expect(field.speed[i]).toBeLessThanOrEqual(1.2 + 1e-6)
      if (i > 0) expect(field.z[i]).toBeGreaterThanOrEqual(field.z[i - 1])
    }
  })

  it('wraps at the edges both ways', () => {
    expect(wrap(5, 4)).toBe(1)
    expect(wrap(-1, 4)).toBe(3)
    expect(wrap(0, 4)).toBe(0)
    expect(wrap(1e6 + 0.5, 10)).toBeCloseTo(0.5, 6)
  })

  it('dims far petals and keeps near ones at full colour', () => {
    expect(tierFor(0)).toBe(0)
    expect(tierFor(0.999)).toBe(DEPTH_TIERS.length - 1)
    expect(tierFor(1)).toBe(DEPTH_TIERS.length - 1)
    expect(petalRgb([0.7, 0.25, 0.4], 1)).toBe('rgb(179 64 102)')
    expect(petalRgb([0.93, 0.6, 0.7], 0.5)).toBe('rgb(119 77 89)')
  })
})
