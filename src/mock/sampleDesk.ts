import { LLTV } from '../config.ts'
import {
  clampCredit,
  creditedPerWsNetWad,
  morphoPriceFromCredited,
  pauseSpotWad,
} from '../lib/oracleMath.ts'
import { ORACLE_PRICE_SCALE } from '../lib/units.ts'
import type { Desk, RawPosition } from '../types.ts'

const WAD = 10n ** 18n

/**
 * Internally consistent illustration used only when live RPC and Morpho both fail.
 * Round levels, not a snapshot of the book.
 */
export function sampleDesk(reason: string): Desk {
  const twapWad = 350n * WAD
  const navWad = 175n * WAD
  const index = 3_780_000_000n
  const spotWad = 326n * WAD
  const { clampedWad, regime } = clampCredit(twapWad, navWad)
  const creditedWad = creditedPerWsNetWad(clampedWad, index)
  const morphoPrice = morphoPriceFromCredited(creditedWad)
  const reserveUsdg = 230_000n * 1_000_000n
  const reserveNet = (reserveUsdg * 10n ** 21n) / spotWad

  const positions: RawPosition[] = [
    position('0x1111111111111111111111111111111111111111', 4n * WAD, morphoPrice, 1_020_000_000_000_000_000n),
    position('0x2222222222222222222222222222222222222222', 12n * WAD, morphoPrice, 1_040_000_000_000_000_000n),
    position('0x3333333333333333333333333333333333333333', 3n * WAD, morphoPrice, 1_080_000_000_000_000_000n),
    position('0x4444444444444444444444444444444444444444', 40n * WAD, morphoPrice, 1_150_000_000_000_000_000n),
    position('0x5555555555555555555555555555555555555555', 8n * WAD, morphoPrice, 1_280_000_000_000_000_000n),
    position('0x6666666666666666666666666666666666666666', 25n * WAD, morphoPrice, 1_600_000_000_000_000_000n),
    position('0x7777777777777777777777777777777777777777', 15n * WAD, morphoPrice, 2_100_000_000_000_000_000n),
  ]

  const borrowRaw = positions.reduce((sum, row) => sum + row.borrowRaw, 0n)
  const collateralRaw = positions.reduce((sum, row) => sum + row.collateralRaw, 0n) + 20n * WAD

  return {
    mode: 'mock',
    fetchedAt: Date.now(),
    blockNumber: null,
    blockTimestamp: null,
    warnings: [
      `SAMPLE BOOK — live fetch failed (${reason}). These figures are a frozen illustration, not the market.`,
    ],
    supplyRaw: borrowRaw + 8_000n * 1_000_000n,
    borrowRaw,
    collateralRaw,
    utilization: null,
    supplyApy: 1.05,
    borrowApy: 1.26,
    chainLastUpdate: null,
    spotWad,
    twapWad,
    navWad,
    index,
    creditedWad,
    morphoPrice,
    regime,
    liquidationsEnabled: true,
    pauseReason: 'none',
    pauseSpotWad: pauseSpotWad(twapWad),
    checkpointAt: null,
    twapMinSec: 1800,
    twapMaxSec: 14400,
    reserveUsdg,
    reserveNet,
    positions,
    borrowerCount: positions.length,
    footnote: { borrowRaw: 170n * 1_000_000n, supplyRaw: 1_600n * 1_000_000n, utilization: 0.11 },
  }
}

function position(address: string, collateralRaw: bigint, morphoPrice: bigint, health: bigint): RawPosition {
  const value = (collateralRaw * morphoPrice) / ORACLE_PRICE_SCALE
  const borrowRaw = (value * LLTV) / health
  return {
    address,
    collateralRaw,
    borrowRaw,
    indexedHealth: null,
  }
}
