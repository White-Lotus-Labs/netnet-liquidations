import { ADDRESSES } from '../config.ts'
import type { ScenarioModel } from './model.ts'
import { SPOT_SCALE } from './units.ts'

export type QuoteProvider = 'kyberswap' | '0x' | 'lifi'

export type RouteFill = {
  source: string
  pool: string | null
  shareBps: number
}

export type SizedQuote = {
  netRaw: bigint
  usdgOutRaw: bigint
  avgPriceWad: bigint
  fills: RouteFill[]
  provider: QuoteProvider
}

export type QuoteBook = {
  status: 'loading' | 'live' | 'unavailable'
  fetchedAt: number | null
  warning: string | null
  points: SizedQuote[]
  providers: QuoteProvider[]
}

export type ImpactSource = 'aggregator' | 'canonical'

export type ImpactView = {
  source: ImpactSource
  providerLabel: string
  /** Banner when the buy zone is not driven by router quotes. */
  alert: string | null
  note: string | null
  bandLow: bigint | null
  bandHigh: bigint | null
  routerUsdgOut: bigint | null
  routerAvg: bigint | null
  routerMarginal: bigint | null
  routerTouch: bigint | null
  routerExact: boolean
  fills: RouteFill[]
  fillNetRaw: bigint | null
  canonicalUsdgOut: bigint | null
  canonicalBefore: bigint | null
  canonicalAfter: bigint | null
}

const CANONICAL_ALERT =
  'Router quotes are unavailable, so this buy zone is the canonical Uniswap v2 pool only. Other NET venues are missing and the dump is overstated.'

export function emptyBook(warning: string | null, status: QuoteBook['status'] = 'unavailable'): QuoteBook {
  return { status, fetchedAt: null, warning, points: [], providers: [] }
}

export function avgPriceWad(netRaw: bigint, usdgOutRaw: bigint): bigint | null {
  if (netRaw <= 0n || usdgOutRaw < 0n) return null
  return (usdgOutRaw * SPOT_SCALE) / netRaw
}

export function providerLabel(provider: QuoteProvider): string {
  switch (provider) {
    case 'kyberswap':
      return 'KyberSwap aggregator'
    case '0x':
      return '0x Swap API'
    case 'lifi':
      return 'LI.FI'
    default: {
      const neverProvider: never = provider
      return neverProvider
    }
  }
}

const SOURCE_NAMES: Record<string, string> = {
  uniswap: 'Uniswap v2',
  'uniswap-v2': 'Uniswap v2',
  uniswapv3: 'Uniswap v3',
  'uniswap-v3': 'Uniswap v3',
  'uniswap-v4': 'Uniswap v4',
  'up-v3': 'Up v3',
  'alandale-v4': 'Alandale v4',
  'raphael-v2': 'Raphael v2',
}

export function fillLabel(fill: RouteFill): string {
  const known = SOURCE_NAMES[fill.source]
  const name = known ?? fill.source
  const canonical = fill.pool !== null && fill.pool.toLowerCase() === ADDRESSES.pair.toLowerCase()
  return canonical ? `${name} · canonical pair` : name
}

export type SizeExecution = {
  netRaw: bigint
  usdgOutRaw: bigint
  avgPriceWad: bigint
  marginalPriceWad: bigint
  touchPriceWad: bigint
  exact: boolean
  fills: RouteFill[]
  fillNetRaw: bigint
  provider: QuoteProvider
}

export function executionAt(points: SizedQuote[], netRaw: bigint): SizeExecution | null {
  if (netRaw <= 0n || points.length === 0) return null
  const sorted = [...points].sort((a, b) => (a.netRaw < b.netRaw ? -1 : 1))
  const touch = sorted[0]?.avgPriceWad
  if (touch === undefined) return null
  const last = sorted[sorted.length - 1]
  if (last === undefined) return null
  const slack = last.netRaw / 200n
  if (netRaw > last.netRaw + slack) return null

  const hiIndex = sorted.findIndex((point) => point.netRaw >= netRaw)
  const hi = hiIndex === -1 ? sorted.length - 1 : hiIndex
  const upper = sorted[hi]
  if (upper === undefined) return null
  const lower = hi === 0 ? null : sorted[hi - 1]

  if (lower === null || upper.netRaw === netRaw) {
    const scaledOut = upper.netRaw === netRaw ? upper.usdgOutRaw : (upper.usdgOutRaw * netRaw) / upper.netRaw
    return {
      netRaw,
      usdgOutRaw: scaledOut,
      avgPriceWad: upper.avgPriceWad,
      marginalPriceWad: upper.avgPriceWad,
      touchPriceWad: touch,
      exact: upper.netRaw === netRaw,
      fills: upper.fills,
      fillNetRaw: upper.netRaw,
      provider: upper.provider,
    }
  }

  const span = upper.netRaw - lower.netRaw
  if (span <= 0n) return null
  const usdg = lower.usdgOutRaw + ((upper.usdgOutRaw - lower.usdgOutRaw) * (netRaw - lower.netRaw)) / span
  const avg = avgPriceWad(netRaw, usdg)
  if (avg === null) return null
  const marginal = ((upper.usdgOutRaw - lower.usdgOutRaw) * SPOT_SCALE) / span
  return {
    netRaw,
    usdgOutRaw: usdg,
    avgPriceWad: avg,
    marginalPriceWad: marginal,
    touchPriceWad: touch,
    exact: false,
    fills: upper.fills,
    fillNetRaw: upper.netRaw,
    provider: upper.provider,
  }
}

function plausible(avg: bigint, spot: bigint | null): boolean {
  if (avg <= 0n) return false
  if (spot === null || spot <= 0n) return true
  if (avg * 10n < spot) return false
  if (avg > spot * 10n) return false
  return true
}

function canonicalBand(model: ScenarioModel): { low: bigint | null; high: bigint | null } {
  if (model.triggerKind === 'liquidatable' && model.spotAfterWad !== null && model.spotBeforeWad !== null) {
    return orderBand(model.spotAfterWad, model.spotBeforeWad)
  }
  if (
    (model.triggerKind === 'twap' || model.triggerKind === 'mixed') &&
    model.repricedAfterWad !== null &&
    model.triggerHighWad !== null
  ) {
    return orderBand(model.repricedAfterWad, model.triggerHighWad)
  }
  return { low: null, high: null }
}

function orderBand(a: bigint, b: bigint): { low: bigint; high: bigint } {
  return a < b ? { low: a, high: b } : { low: b, high: a }
}

function canonicalView(model: ScenarioModel, alert: string | null, note: string | null): ImpactView {
  const band = canonicalBand(model)
  return {
    source: 'canonical',
    providerLabel: 'Canonical Uniswap v2 only',
    alert,
    note,
    bandLow: band.low,
    bandHigh: band.high,
    routerUsdgOut: null,
    routerAvg: null,
    routerMarginal: null,
    routerTouch: null,
    routerExact: false,
    fills: [],
    fillNetRaw: null,
    canonicalUsdgOut: model.usdgOutRaw,
    canonicalBefore: model.spotBeforeWad,
    canonicalAfter: model.spotAfterWad,
  }
}

export function buildImpactView(model: ScenarioModel, book: QuoteBook | null): ImpactView {
  const flow = model.flowNetRaw
  const spot = model.spotBeforeWad
  const usable = (book?.points ?? []).filter((point) => plausible(point.avgPriceWad, spot))

  if (flow === null || flow <= 0n || model.triggerKind === 'none' || model.triggerKind === 'nav') {
    return canonicalView(model, null, book?.warning ?? null)
  }

  if (book?.status === 'loading') {
    return canonicalView(
      model,
      null,
      'Router quotes are still loading. The band is the canonical pool until they land.',
    )
  }

  if (usable.length === 0) {
    return canonicalView(model, CANONICAL_ALERT, book?.warning ?? null)
  }

  const exec = executionAt(usable, flow)
  if (exec === null) {
    return canonicalView(
      model,
      CANONICAL_ALERT,
      'This sale is larger than the quoted ladder. The band falls back to the canonical pool.',
    )
  }

  const band = orderBand(
    exec.marginalPriceWad < exec.touchPriceWad ? exec.marginalPriceWad : exec.touchPriceWad,
    exec.marginalPriceWad > exec.touchPriceWad ? exec.marginalPriceWad : exec.touchPriceWad,
  )

  return {
    source: 'aggregator',
    providerLabel: providerLabel(exec.provider),
    alert: null,
    note: book?.warning ?? null,
    bandLow: band.low,
    bandHigh: band.high,
    routerUsdgOut: exec.usdgOutRaw,
    routerAvg: exec.avgPriceWad,
    routerMarginal: exec.marginalPriceWad,
    routerTouch: exec.touchPriceWad,
    routerExact: exec.exact,
    fills: exec.fills,
    fillNetRaw: exec.fillNetRaw,
    canonicalUsdgOut: model.usdgOutRaw,
    canonicalBefore: model.spotBeforeWad,
    canonicalAfter: model.spotAfterWad,
  }
}

export function quoteStatusLabel(book: QuoteBook | null): string {
  if (book === null || book.status === 'loading') return 'Quoting router depth…'
  if (book.status === 'live') {
    const who = book.providers.map((provider) => providerLabel(provider)).join(' + ')
    return who.length > 0
      ? `Impact via router/aggregator (Matcha-style) · ${who}`
      : 'Impact via router/aggregator (Matcha-style)'
  }
  return 'Canonical Uniswap v2 only'
}

export function routerMultiple(routerOut: bigint | null, canonicalOut: bigint | null): string | null {
  if (routerOut === null || canonicalOut === null || canonicalOut <= 0n) return null
  const milli = (routerOut * 1000n) / canonicalOut
  const whole = milli / 1000n
  const frac = milli % 1000n
  return `${whole.toString()}.${frac.toString().padStart(3, '0')}×`
}

export function chartQuotes(points: SizedQuote[], maxNet: bigint | null): SizedQuote[] {
  const sorted = [...points].sort((a, b) => (a.netRaw < b.netRaw ? -1 : 1))
  if (maxNet === null || maxNet <= 0n) return sorted
  const visible: SizedQuote[] = []
  for (const point of sorted) {
    visible.push(point)
    if (point.netRaw >= maxNet) break
  }
  return visible
}
