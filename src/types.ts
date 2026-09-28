import type { Regime } from './lib/oracleMath.ts'

export type PauseReason = 'none' | 'divergence' | 'twap-reverted' | 'price-reverted' | 'unknown'

export type RawPosition = {
  address: string
  collateralRaw: bigint
  borrowRaw: bigint
  /** Morpho API health, used only when the live oracle price is unavailable. */
  indexedHealth: number | null
}

export type FootnoteMarket = {
  borrowRaw: bigint | null
  supplyRaw: bigint | null
  utilization: number | null
}

export type Desk = {
  mode: 'live' | 'mock'
  fetchedAt: number
  blockNumber: number | null
  blockTimestamp: number | null
  warnings: string[]
  supplyRaw: bigint | null
  borrowRaw: bigint | null
  collateralRaw: bigint | null
  utilization: number | null
  supplyApy: number | null
  borrowApy: number | null
  chainLastUpdate: number | null
  spotWad: bigint | null
  twapWad: bigint | null
  navWad: bigint | null
  index: bigint | null
  creditedWad: bigint | null
  morphoPrice: bigint | null
  regime: Regime | null
  liquidationsEnabled: boolean | null
  pauseReason: PauseReason
  pauseSpotWad: bigint | null
  checkpointAt: number | null
  twapMinSec: number | null
  twapMaxSec: number | null
  reserveUsdg: bigint | null
  reserveNet: bigint | null
  positions: RawPosition[]
  borrowerCount: number | null
  footnote: FootnoteMarket | null
}
