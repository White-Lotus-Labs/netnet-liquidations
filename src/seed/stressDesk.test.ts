import { describe, expect, it } from 'vitest'
import { buildScenario, enrichPositions } from '../lib/model.ts'
import { wadToNumber } from '../lib/format.ts'
import { dec, stressDesk } from './stressDesk.ts'

describe('18:02 Warsaw stress seed', () => {
  const desk = stressDesk()

  it('is the mid haircut band, with the snapshot pause and pool', () => {
    expect(desk.mode).toBe('seed')
    expect(desk.regime).toBe('haircut')
    expect(desk.liquidationsEnabled).toBe(true)
    expect(desk.borrowerCount).toBe(192)
    expect(desk.positions).toHaveLength(30)
    expect(wadToNumber(desk.navWad!)).toBeCloseTo(174.745, 2)
    expect(wadToNumber(desk.twapWad!)).toBeCloseTo(349.9893, 3)
    expect(wadToNumber(desk.creditedWad!)).toBeCloseTo(1191.76, 1)
    expect(wadToNumber(desk.spotWad!)).toBeCloseTo(336.248, 2)
    expect(wadToNumber(desk.pauseSpotWad!)).toBeCloseTo(297.491, 2)
    expect(desk.spotWad! > desk.pauseSpotWad!).toBe(true)
  })

  it('reproduces the health buckets from the stress note', () => {
    const rows = enrichPositions(desk)
    expect(rows[0]?.address).toBe('0x505BD4496939C8763Ad84717305E71EB1fF9D472')
    expect(rows[0]?.trigger.kind).toBe('twap')
    if (rows[0]?.trigger.kind === 'twap') {
      expect(wadToNumber(rows[0].trigger.twapWad)).toBeCloseTo(347.8, 1)
    }

    const hf105 = buildScenario(desk, rows, 'hf105', 0n)
    const hf110 = buildScenario(desk, rows, 'hf110', 0n)
    const hf120 = buildScenario(desk, rows, 'hf120', 0n)
    const now = buildScenario(desk, rows, 'liquidatable', 0n)

    expect(now.slices).toHaveLength(0)
    expect(hf105.slices).toHaveLength(5)
    expect(hf110.slices).toHaveLength(14)
    expect(hf120.slices).toHaveLength(30)
    expect(hf105.debtRaw).toBe(dec('5571.90', 6))
    expect(hf110.debtRaw).toBe(dec('23639.03', 6))
    expect(hf120.debtRaw).toBe(dec('129164.13', 6))
    expect(hf105.flowNetRaw).not.toBeNull()
    expect(hf105.spotBeforeWad).not.toBeNull()
    expect(hf105.spotAfterWad).not.toBeNull()
    expect(hf105.curve.length).toBeGreaterThan(2)
  })

  it('keeps the facility about 30× the 10% pool guide', () => {
    const guide = desk.reserveUsdg! / 10n
    const multiple = Number((desk.borrowRaw! * 1000n) / guide) / 1000
    expect(multiple).toBeCloseTo(29.6, 1)
    const utilization = Number((desk.borrowRaw! * 10_000n) / desk.supplyRaw!) / 10_000
    expect(utilization).toBeCloseTo(0.9982, 4)
  })
})
