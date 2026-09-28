import { LLTV } from '../config.ts'
import type { Desk, RawPosition } from '../types.ts'
import { wadToNumber } from './format.ts'
import {
  estimateSeizure,
  healthWad,
  liquidationIncentive,
  liquidationTrigger,
  liqCreditedWad,
  ltvWad,
  type Trigger,
} from './liquidation.ts'
import { netRawFromWsNet } from './oracleMath.ts'
import { impactCurve, moveBps, priceAfterSell, quoteUsdgOut, repriceReserves, type CurvePoint, type Reserves } from './uniswap.ts'
import { WAD, minBigint } from './units.ts'

export type ScenarioId = 'liquidatable' | 'hf105' | 'hf110' | 'hf120' | 'top10' | 'custom'

export const SCENARIO_ORDER: ScenarioId[] = [
  'liquidatable',
  'hf105',
  'hf110',
  'hf120',
  'top10',
  'custom',
]

export type HealthSource = 'oracle' | 'indexed' | 'unavailable'

export type EnrichedPosition = {
  address: string
  collateralRaw: bigint
  borrowRaw: bigint
  healthWad: bigint | null
  healthSource: HealthSource
  ltvWad: bigint | null
  liqCreditedWad: bigint | null
  trigger: Trigger
  distanceWad: bigint | null
  seizedWsRaw: bigint | null
  seizedNetRaw: bigint | null
  badDebtRaw: bigint
  runwayDays: number | null
}

export type Slice = {
  position: EnrichedPosition
  debtRaw: bigint
  seizedWsRaw: bigint | null
  seizedNetRaw: bigint | null
  badDebtRaw: bigint
}

export type TriggerKind = 'none' | 'liquidatable' | 'twap' | 'nav' | 'mixed'

export type ScenarioModel = {
  id: ScenarioId
  slices: Slice[]
  debtRaw: bigint
  seizedWsRaw: bigint | null
  seizedNetRaw: bigint | null
  flowNetRaw: bigint | null
  badDebtRaw: bigint
  usdgOutRaw: bigint | null
  spotBeforeWad: bigint | null
  spotAfterWad: bigint | null
  moveBps: bigint | null
  referenceSpotWad: bigint | null
  repricedAfterWad: bigint | null
  triggerLowWad: bigint | null
  triggerHighWad: bigint | null
  triggerKind: TriggerKind
  curve: CurvePoint[]
  markerNetRaw: bigint | null
}

const HF105 = 1_050_000_000_000_000_000n
const HF110 = 1_100_000_000_000_000_000n
const HF120 = 1_200_000_000_000_000_000n

const LIF = liquidationIncentive(LLTV)

export function scenarioLabel(id: ScenarioId): string {
  switch (id) {
    case 'liquidatable':
      return 'Already liquidatable'
    case 'hf105':
      return 'Health < 1.05'
    case 'hf110':
      return 'Health < 1.10'
    case 'hf120':
      return 'Health < 1.20'
    case 'top10':
      return 'Top 10 debt'
    case 'custom':
      return 'Custom notional'
    default: {
      const neverId: never = id
      return neverId
    }
  }
}

export function flatCreditRunwayDays(health: bigint | null, borrowApy: number | null): number | null {
  if (health === null || health <= WAD || borrowApy === null || borrowApy <= 0) return null
  const ratio = wadToNumber(health)
  const years = Math.log(ratio) / Math.log(1 + borrowApy)
  if (!Number.isFinite(years) || years < 0) return null
  return years * 365.25
}

function indexedHealthWad(indexed: number | null): bigint | null {
  if (indexed === null || !Number.isFinite(indexed) || indexed <= 0) return null
  return BigInt(Math.round(indexed * 1e9)) * 1_000_000_000n
}

export function enrichPositions(desk: Desk): EnrichedPosition[] {
  const price = desk.morphoPrice
  const credited = desk.creditedWad
  return desk.positions
    .filter((position) => position.borrowRaw > 0n && position.collateralRaw > 0n)
    .map((position) => enrichOne(position, desk, price, credited))
    .sort(byHealth)
}

function enrichOne(
  position: RawPosition,
  desk: Desk,
  price: bigint | null,
  credited: bigint | null,
): EnrichedPosition {
  const oracleHealth = price === null ? null : healthWad(position.collateralRaw, position.borrowRaw, price)
  const indexed = indexedHealthWad(position.indexedHealth)
  const health = oracleHealth ?? indexed
  const healthSource: HealthSource =
    oracleHealth !== null ? 'oracle' : indexed !== null ? 'indexed' : 'unavailable'
  const ltv = price === null ? null : ltvWad(position.collateralRaw, position.borrowRaw, price)
  const liq = liqCreditedWad(position.collateralRaw, position.borrowRaw)
  const distance =
    credited !== null && liq !== null && credited > 0n ? ((credited - liq) * WAD) / credited : null

  let trigger: Trigger = { kind: 'unavailable' }
  if (health !== null && liq !== null && desk.index !== null && desk.navWad !== null && healthSource === 'oracle') {
    trigger = liquidationTrigger({
      liqCredited: liq,
      index: desk.index,
      navWad: desk.navWad,
      health,
    })
  } else if (health !== null && health < WAD && healthSource === 'oracle') {
    trigger = { kind: 'liquidatable' }
  }

  let seizedWsRaw: bigint | null = null
  let badDebtRaw = 0n
  if (health !== null && price !== null) {
    const seizure = estimateSeizure({
      collateralRaw: position.collateralRaw,
      borrowRaw: position.borrowRaw,
      morphoPrice: price,
      health,
      lif: LIF,
    })
    seizedWsRaw = seizure.seizedWsRaw
    badDebtRaw = seizure.badDebtRaw
  }

  const seizedNetRaw =
    seizedWsRaw !== null && desk.index !== null ? netRawFromWsNet(seizedWsRaw, desk.index) : null

  return {
    address: position.address,
    collateralRaw: position.collateralRaw,
    borrowRaw: position.borrowRaw,
    healthWad: health,
    healthSource,
    ltvWad: ltv,
    liqCreditedWad: liq,
    trigger,
    distanceWad: distance,
    seizedWsRaw,
    seizedNetRaw,
    badDebtRaw,
    runwayDays: flatCreditRunwayDays(health, desk.borrowApy),
  }
}

function byHealth(a: EnrichedPosition, b: EnrichedPosition): number {
  if (a.healthWad === null && b.healthWad === null) return a.borrowRaw > b.borrowRaw ? -1 : 1
  if (a.healthWad === null) return 1
  if (b.healthWad === null) return -1
  if (a.healthWad === b.healthWad) return a.borrowRaw > b.borrowRaw ? -1 : 1
  return a.healthWad < b.healthWad ? -1 : 1
}

function scaleNullable(value: bigint | null, take: bigint, full: bigint): bigint | null {
  if (value === null || full <= 0n) return null
  return (value * take) / full
}

function sliceOf(position: EnrichedPosition, debtRaw: bigint): Slice {
  const take = minBigint(debtRaw, position.borrowRaw)
  return {
    position,
    debtRaw: take,
    seizedWsRaw: scaleNullable(position.seizedWsRaw, take, position.borrowRaw),
    seizedNetRaw: scaleNullable(position.seizedNetRaw, take, position.borrowRaw),
    badDebtRaw: (position.badDebtRaw * take) / position.borrowRaw,
  }
}

function candidates(rows: EnrichedPosition[], id: ScenarioId): EnrichedPosition[] {
  switch (id) {
    case 'liquidatable':
      return rows.filter((row) => row.healthWad !== null && row.healthWad < WAD)
    case 'hf105':
      return rows.filter((row) => row.healthWad !== null && row.healthWad < HF105)
    case 'hf110':
      return rows.filter((row) => row.healthWad !== null && row.healthWad < HF110)
    case 'hf120':
      return rows.filter((row) => row.healthWad !== null && row.healthWad < HF120)
    case 'top10':
      return [...rows].sort((a, b) => (a.borrowRaw > b.borrowRaw ? -1 : 1)).slice(0, 10)
    case 'custom':
      return rows
    default: {
      const neverId: never = id
      return neverId
    }
  }
}

function slicesFor(rows: EnrichedPosition[], id: ScenarioId, customDebtRaw: bigint): Slice[] {
  const picked = candidates(rows, id)
  if (id !== 'custom') return picked.map((row) => sliceOf(row, row.borrowRaw))
  if (customDebtRaw <= 0n) return []
  const slices: Slice[] = []
  let remaining = customDebtRaw
  for (const row of picked) {
    if (remaining <= 0n) break
    const take = minBigint(row.borrowRaw, remaining)
    if (take <= 0n) continue
    slices.push(sliceOf(row, take))
    remaining -= take
  }
  return slices
}

function sumNullable(values: Array<bigint | null>): bigint | null {
  let total = 0n
  for (const value of values) {
    if (value === null) return null
    total += value
  }
  return total
}

function spotSensitive(trigger: Trigger): boolean {
  return trigger.kind === 'twap' || trigger.kind === 'liquidatable'
}

function classify(slices: Slice[]): {
  kind: TriggerKind
  low: bigint | null
  high: bigint | null
} {
  if (slices.length === 0) return { kind: 'none', low: null, high: null }
  const kinds = new Set(slices.map((slice) => slice.position.trigger.kind))
  if (kinds.size === 1 && kinds.has('liquidatable')) return { kind: 'liquidatable', low: null, high: null }
  if (kinds.size === 1 && kinds.has('nav')) {
    const levels = slices.flatMap((slice) =>
      slice.position.trigger.kind === 'nav' ? [slice.position.trigger.navWad] : [],
    )
    return { kind: 'nav', low: levels.length ? levels.reduce((a, b) => (a < b ? a : b)) : null, high: levels.length ? levels.reduce((a, b) => (a > b ? a : b)) : null }
  }
  const twaps = slices.flatMap((slice) =>
    slice.position.trigger.kind === 'twap' ? [slice.position.trigger.twapWad] : [],
  )
  if (kinds.size === 1 && kinds.has('twap')) {
    return {
      kind: 'twap',
      low: twaps.reduce((a, b) => (a < b ? a : b)),
      high: twaps.reduce((a, b) => (a > b ? a : b)),
    }
  }
  if (twaps.length === 0 && kinds.has('liquidatable')) return { kind: 'liquidatable', low: null, high: null }
  if (twaps.length === 0) return { kind: 'mixed', low: null, high: null }
  return {
    kind: 'mixed',
    low: twaps.reduce((a, b) => (a < b ? a : b)),
    high: twaps.reduce((a, b) => (a > b ? a : b)),
  }
}

export function buildScenario(
  desk: Desk,
  rows: EnrichedPosition[],
  id: ScenarioId,
  customDebtRaw: bigint,
): ScenarioModel {
  const slices = slicesFor(rows, id, customDebtRaw)
  const debtRaw = slices.reduce((sum, slice) => sum + slice.debtRaw, 0n)
  const seizedWsRaw = sumNullable(slices.map((slice) => slice.seizedWsRaw))
  const seizedNetRaw = sumNullable(slices.map((slice) => slice.seizedNetRaw))
  const badDebtRaw = slices.reduce((sum, slice) => sum + slice.badDebtRaw, 0n)
  const classified = classify(slices)
  const flowSlices = slices.filter((slice) => spotSensitive(slice.position.trigger) || classified.kind === 'twap' || classified.kind === 'liquidatable')
  const flowNetRaw =
    classified.kind === 'nav' || classified.kind === 'none'
      ? null
      : sumNullable(
          (classified.kind === 'mixed' ? slices.filter((slice) => spotSensitive(slice.position.trigger)) : flowSlices).map(
            (slice) => slice.seizedNetRaw,
          ),
        )

  const reserves = poolOf(desk)
  const spotBeforeWad = desk.spotWad
  let usdgOutRaw: bigint | null = null
  let spotAfterWad: bigint | null = null
  let bps: bigint | null = null
  if (reserves && flowNetRaw !== null && flowNetRaw > 0n) {
    usdgOutRaw = quoteUsdgOut(flowNetRaw, reserves)
    spotAfterWad = priceAfterSell(flowNetRaw, reserves)
    if (spotBeforeWad !== null && spotAfterWad !== null) bps = moveBps(spotBeforeWad, spotAfterWad)
  }

  let referenceSpotWad: bigint | null = null
  let repricedAfterWad: bigint | null = null
  if (
    reserves &&
    flowNetRaw !== null &&
    flowNetRaw > 0n &&
    classified.high !== null &&
    (classified.kind === 'twap' || classified.kind === 'mixed')
  ) {
    referenceSpotWad = classified.high
    const repriced = repriceReserves(reserves, classified.high)
    if (repriced) repricedAfterWad = priceAfterSell(flowNetRaw, repriced)
  }

  const depth = reserves ? reserves.reserveNet / 20n : 0n
  const marker = flowNetRaw
  const curveMax = marker !== null && marker > depth ? (marker * 5n) / 4n : depth
  const curve = reserves && curveMax > 0n ? impactCurve(curveMax, reserves) : []

  return {
    id,
    slices,
    debtRaw,
    seizedWsRaw,
    seizedNetRaw,
    flowNetRaw,
    badDebtRaw,
    usdgOutRaw,
    spotBeforeWad,
    spotAfterWad,
    moveBps: bps,
    referenceSpotWad,
    repricedAfterWad,
    triggerLowWad: classified.low,
    triggerHighWad: classified.high,
    triggerKind: classified.kind,
    curve,
    markerNetRaw: marker,
  }
}

function poolOf(desk: Desk): Reserves | null {
  if (desk.reserveNet === null || desk.reserveUsdg === null) return null
  if (desk.reserveNet <= 0n || desk.reserveUsdg <= 0n) return null
  return { reserveNet: desk.reserveNet, reserveUsdg: desk.reserveUsdg }
}

export function facilityStats(desk: Desk): { guideRaw: bigint | null; multiple: number | null } {
  if (desk.reserveUsdg === null) return { guideRaw: null, multiple: null }
  const guideRaw = desk.reserveUsdg / 10n
  if (desk.borrowRaw === null || guideRaw === 0n) return { guideRaw, multiple: null }
  const scaled = (desk.borrowRaw * 1000n) / guideRaw
  return { guideRaw, multiple: Number(scaled) / 1000 }
}

export function weakestRunway(rows: EnrichedPosition[]): number | null {
  let best: number | null = null
  for (const row of rows) {
    if (row.runwayDays === null) continue
    if (row.healthWad !== null && row.healthWad >= HF120) continue
    if (best === null || row.runwayDays < best) best = row.runwayDays
  }
  return best
}
