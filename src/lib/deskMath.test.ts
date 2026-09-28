import { describe, expect, it } from 'vitest'
import { LLTV } from '../config.ts'
import { sampleDesk } from '../mock/sampleDesk.ts'
import { describeBuyZone } from './buyZone.ts'
import { liquidationIncentive, liqCreditedWad, healthWad } from './liquidation.ts'
import { buildScenario, enrichPositions, scenarioLabel } from './model.ts'
import { clampCredit, haircutTwap, isDiverged, pauseSpotWad } from './oracleMath.ts'
import { priceAfterSell, quoteUsdgOut } from './uniswap.ts'
import { ORACLE_PRICE_SCALE, WAD } from './units.ts'

describe('oracle clamp', () => {
  const nav = 175n * WAD
  const twap = 350n * WAD

  it('haircuts TWAP by 10% inside the band', () => {
    const credit = clampCredit(twap, nav)
    expect(credit.regime).toBe('haircut')
    expect(credit.clampedWad).toBe(haircutTwap(twap))
    expect(credit.clampedWad).toBe(315n * WAD)
  })

  it('pins credit at 5× NAV in a melt-up', () => {
    const credit = clampCredit(2_000n * WAD, nav)
    expect(credit.regime).toBe('cap')
    expect(credit.clampedWad).toBe(nav * 5n)
  })

  it('pins credit at NAV when the haircut is below backing', () => {
    const credit = clampCredit(100n * WAD, nav)
    expect(credit.regime).toBe('nav-floor')
    expect(credit.clampedWad).toBe(nav)
  })

  it('pauses only when spot is strictly under TWAP × 0.85', () => {
    expect(pauseSpotWad(100n * WAD)).toBe(85n * WAD)
    expect(isDiverged(84n * WAD, 100n * WAD)).toBe(true)
    expect(isDiverged(85n * WAD, 100n * WAD)).toBe(false)
  })
})

describe('liquidation', () => {
  it('matches the Morpho 62.5% incentive', () => {
    expect(liquidationIncentive(LLTV)).toBe(1_126_760_563_380_281_690n)
  })

  it('is health 1 exactly at the credited liquidation price', () => {
    const collateral = 2n * WAD
    const credited = 1_000n * WAD
    const price = credited * 1_000_000n
    const value = (collateral * price) / ORACLE_PRICE_SCALE
    const borrow = (value * LLTV) / WAD
    expect(healthWad(collateral, borrow, price)).toBe(WAD)
    expect(liqCreditedWad(collateral, borrow)).toBe(credited)
  })
})

describe('uniswap impact', () => {
  it('sells NET into USDG with the 0.30% fee', () => {
    const reserves = { reserveNet: 1_000n * 1_000_000_000n, reserveUsdg: 300_000n * 1_000_000n }
    const tenNet = 10n * 1_000_000_000n
    const inWithFee = tenNet * 997n
    const expected = (reserves.reserveUsdg * inWithFee) / (reserves.reserveNet * 1000n + inWithFee)
    expect(quoteUsdgOut(tenNet, reserves)).toBe(expected)
    const before = priceAfterSell(0n, reserves)
    const after = priceAfterSell(tenNet, reserves)
    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(after! < before!).toBe(true)
  })
})

describe('buy zone copy', () => {
  const desk = sampleDesk('test')

  it('names a price band for the near-health bucket', () => {
    const rows = enrichPositions(desk)
    const model = buildScenario(desk, rows, 'hf105', 0n)
    expect(model.slices.length).toBeGreaterThan(0)
    expect(model.triggerKind).toBe('twap')
    const copy = describeBuyZone({
      label: scenarioLabel('hf105'),
      model,
      desk,
      facilityMultiple: 2,
      runwayDays: 30,
    })
    expect(copy.headline).toContain('USDG/NET')
    expect(copy.headline).toContain('if')
    expect(copy.caveats.some((line) => line.includes('15%'))).toBe(true)
    expect(copy.caveats.some((line) => line.includes('0.30%'))).toBe(true)
  })

  it('does not invent a spot print for an empty bucket', () => {
    const copy = describeBuyZone({
      label: scenarioLabel('liquidatable'),
      model: buildScenario(desk, enrichPositions(desk), 'liquidatable', 0n),
      desk,
      facilityMultiple: null,
      runwayDays: null,
    })
    expect(copy.headline).toContain('No borrowers')
  })
})
