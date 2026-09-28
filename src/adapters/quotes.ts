import { ADDRESSES, CHAIN_ID, KYBER_ROUTES, ZEROX_PRICE } from '../config.ts'
import { avgPriceWad, emptyBook, type QuoteBook, type RouteFill, type SizedQuote } from '../lib/quoteBook.ts'

const NET_UNIT = 1_000_000_000n
const MAX_QUOTE_NET = 8_000n * NET_UNIT

/** Whole-NET rungs. The scenario size is added when it is not already on a rung. */
export const QUOTE_RUNGS_NET = [1n, 5n, 15n, 40n, 80n, 150n, 300n, 600n] as const

export function rungRaw(wholeNet: bigint): bigint {
  return wholeNet * NET_UNIT
}

type CacheSlot = { stamp: number; quote: SizedQuote }

let activeStamp = -1
const cache = new Map<string, CacheSlot>()
const failed = new Map<string, string>()

function resetIfStamp(stamp: number) {
  if (stamp === activeStamp) return
  activeStamp = stamp
  cache.clear()
  failed.clear()
}

export function quoteBookSnapshot(): QuoteBook {
  const points = [...cache.values()]
    .filter((slot) => slot.stamp === activeStamp)
    .map((slot) => slot.quote)
    .sort((a, b) => (a.netRaw < b.netRaw ? -1 : 1))
  const providers = [...new Set(points.map((point) => point.provider))]
  const failNotes = [...new Set(failed.values())]
  const warning = failNotes.length > 0 ? failNotes.join(' ') : null
  if (points.length === 0) {
    return emptyBook(warning ?? 'No router quote returned for NET → USDG.', 'unavailable')
  }
  return {
    status: 'live',
    fetchedAt: Date.now(),
    warning,
    points,
    providers,
  }
}

function dedupeSizes(sizes: bigint[]): bigint[] {
  const map = new Map<string, bigint>()
  for (const size of sizes) {
    if (size <= 0n || size > MAX_QUOTE_NET) continue
    map.set(size.toString(), size)
  }
  return [...map.values()].sort((a, b) => (a < b ? -1 : 1))
}

export function zeroxApiKey(): string {
  const injected = typeof __ZEROX_API_KEY__ === 'string' ? __ZEROX_API_KEY__.trim() : ''
  const fromVite = import.meta.env.VITE_ZEROX_API_KEY
  const vite = typeof fromVite === 'string' ? fromVite.trim() : ''
  return injected || vite
}

export async function loadQuotes(stamp: number, sizes: bigint[], signal: AbortSignal): Promise<void> {
  resetIfStamp(stamp)
  const todo = dedupeSizes(sizes).filter((size) => {
    const key = size.toString()
    return !cache.has(key) && !failed.has(key)
  })
  await mapPool(todo, 3, async (size) => {
    if (signal.aborted || stamp !== activeStamp) return
    try {
      const quote = await quoteOne(size, signal)
      if (signal.aborted || stamp !== activeStamp) return
      if (quote === null) {
        failed.set(size.toString(), 'A router size returned no NET/USDG liquidity.')
        return
      }
      cache.set(size.toString(), { stamp, quote })
    } catch (error) {
      if (signal.aborted || stamp !== activeStamp || isAbort(error)) return
      const message = error instanceof Error ? error.message : 'Router quote failed'
      failed.set(size.toString(), message)
    }
  })
}

async function quoteOne(netRaw: bigint, signal: AbortSignal): Promise<SizedQuote | null> {
  const key = zeroxApiKey()
  const [fromKyber, fromZero] = await Promise.all([
    quoteKyber(netRaw, signal).catch(swallowAbort),
    key ? quoteZeroX(netRaw, signal, key).catch(swallowAbort) : Promise.resolve(null),
  ])
  const best = better(fromKyber, fromZero)
  if (best) return best
  return quoteLifi(netRaw, signal).catch(swallowAbort)
}

function swallowAbort(error: unknown): null {
  if (isAbort(error)) throw error
  return null
}

function better(a: SizedQuote | null, b: SizedQuote | null): SizedQuote | null {
  if (a === null) return b
  if (b === null) return a
  return b.usdgOutRaw > a.usdgOutRaw ? b : a
}

async function quoteKyber(netRaw: bigint, signal: AbortSignal): Promise<SizedQuote | null> {
  const url = new URL(KYBER_ROUTES)
  url.searchParams.set('tokenIn', ADDRESSES.net)
  url.searchParams.set('tokenOut', ADDRESSES.usdg)
  url.searchParams.set('amountIn', netRaw.toString())
  const payload = await getJson(url, signal)
  return parseKyber(payload, netRaw)
}

async function quoteZeroX(netRaw: bigint, signal: AbortSignal, key: string): Promise<SizedQuote | null> {
  const url = new URL(ZEROX_PRICE)
  url.searchParams.set('chainId', String(CHAIN_ID))
  url.searchParams.set('sellToken', ADDRESSES.net)
  url.searchParams.set('buyToken', ADDRESSES.usdg)
  url.searchParams.set('sellAmount', netRaw.toString())
  const payload = await getJson(url, signal, {
    '0x-api-key': key,
    '0x-version': 'v2',
  })
  return parseZeroX(payload, netRaw)
}

async function quoteLifi(netRaw: bigint, signal: AbortSignal): Promise<SizedQuote | null> {
  const url = new URL('https://li.quest/v1/quote')
  url.searchParams.set('fromChain', String(CHAIN_ID))
  url.searchParams.set('toChain', String(CHAIN_ID))
  url.searchParams.set('fromToken', ADDRESSES.net)
  url.searchParams.set('toToken', ADDRESSES.usdg)
  url.searchParams.set('fromAmount', netRaw.toString())
  url.searchParams.set('fromAddress', '0x0000000000000000000000000000000000000001')
  const payload = await getJson(url, signal)
  return parseLifi(payload, netRaw)
}

async function getJson(url: URL, signal: AbortSignal, headers?: Record<string, string>): Promise<unknown> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), 12_000)
  const onAbort = () => timeout.abort()
  signal.addEventListener('abort', onAbort)
  try {
    const response = await fetch(url, { signal: timeout.signal, headers })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${url.host} HTTP ${response.status}`)
    }
    return JSON.parse(text) as unknown
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

export function parseKyber(payload: unknown, requestedNet: bigint): SizedQuote | null {
  if (!isRecord(payload) || payload.code !== 0) return null
  const data = isRecord(payload.data) ? payload.data : null
  const summary = data && isRecord(data.routeSummary) ? data.routeSummary : null
  if (summary === null) return null
  const netRaw = asBig(summary.amountIn) ?? requestedNet
  const usdgOutRaw = asBig(summary.amountOut)
  if (usdgOutRaw === null || usdgOutRaw <= 0n || netRaw <= 0n) return null
  const avg = avgPriceWad(netRaw, usdgOutRaw)
  if (avg === null) return null
  const fills = kyberFills(summary.route, netRaw)
  return { netRaw, usdgOutRaw, avgPriceWad: avg, fills, provider: 'kyberswap' }
}

function kyberFills(route: unknown, netRaw: bigint): RouteFill[] {
  if (!Array.isArray(route)) return []
  const legs: Array<{ source: string; pool: string | null; raw: bigint }> = []
  for (const path of route) {
    if (!Array.isArray(path) || path.length === 0) continue
    const hop = path[0]
    if (!isRecord(hop)) continue
    const raw = asBig(hop.swapAmount)
    const source = typeof hop.exchange === 'string' ? hop.exchange : 'unknown'
    const pool = typeof hop.pool === 'string' ? hop.pool : null
    if (raw === null || raw <= 0n) continue
    legs.push({ source, pool, raw })
  }
  return shareFills(legs, netRaw)
}

export function parseZeroX(payload: unknown, requestedNet: bigint): SizedQuote | null {
  if (!isRecord(payload) || payload.liquidityAvailable === false) return null
  const netRaw = asBig(payload.sellAmount) ?? requestedNet
  const usdgOutRaw = asBig(payload.buyAmount)
  if (usdgOutRaw === null || usdgOutRaw <= 0n || netRaw <= 0n) return null
  const avg = avgPriceWad(netRaw, usdgOutRaw)
  if (avg === null) return null
  const route = isRecord(payload.route) ? payload.route : null
  const fills = route ? zeroXFills(route.fills) : []
  return { netRaw, usdgOutRaw, avgPriceWad: avg, fills, provider: '0x' }
}

function zeroXFills(fills: unknown): RouteFill[] {
  if (!Array.isArray(fills)) return []
  const legs: Array<{ source: string; pool: string | null; raw: bigint }> = []
  for (const fill of fills) {
    if (!isRecord(fill) || typeof fill.source !== 'string') continue
    const bps = typeof fill.proportionBps === 'string' || typeof fill.proportionBps === 'number' ? Number(fill.proportionBps) : 0
    if (!Number.isFinite(bps) || bps <= 0) continue
    legs.push({ source: fill.source, pool: null, raw: BigInt(Math.round(bps)) })
  }
  const total = legs.reduce((sum, leg) => sum + leg.raw, 0n)
  return shareFills(legs, total)
}

export function parseLifi(payload: unknown, requestedNet: bigint): SizedQuote | null {
  if (!isRecord(payload)) return null
  const estimate = isRecord(payload.estimate) ? payload.estimate : null
  if (estimate === null) return null
  const usdgOutRaw = asBig(estimate.toAmount)
  const netRaw = asBig(estimate.fromAmount) ?? requestedNet
  if (usdgOutRaw === null || usdgOutRaw <= 0n || netRaw <= 0n) return null
  const avg = avgPriceWad(netRaw, usdgOutRaw)
  if (avg === null) return null
  const tool = typeof payload.tool === 'string' ? payload.tool : 'lifi'
  return {
    netRaw,
    usdgOutRaw,
    avgPriceWad: avg,
    fills: [{ source: tool, pool: null, shareBps: 10_000 }],
    provider: 'lifi',
  }
}

export function shareFills(
  legs: Array<{ source: string; pool: string | null; raw: bigint }>,
  totalHint: bigint,
): RouteFill[] {
  const merged = new Map<string, { raw: bigint; pool: string | null }>()
  for (const leg of legs) {
    const key = `${leg.source}|${leg.pool ?? ''}`
    const prev = merged.get(key)
    if (prev) prev.raw += leg.raw
    else merged.set(key, { raw: leg.raw, pool: leg.pool })
  }
  const rows = [...merged.entries()].map(([key, value]) => ({
    source: key.slice(0, key.indexOf('|')),
    pool: value.pool,
    raw: value.raw,
  }))
  const total = rows.reduce((sum, row) => sum + row.raw, 0n) || totalHint
  if (total <= 0n) return []
  const drafted = rows.map((row) => {
    const share = Number((row.raw * 10_000n) / total)
    const rem = row.raw * 10_000n - BigInt(share) * total
    return { source: row.source, pool: row.pool, shareBps: share, rem }
  })
  let drift = 10_000 - drafted.reduce((sum, row) => sum + row.shareBps, 0)
  const byRem = [...drafted].sort((a, b) => (a.rem > b.rem ? -1 : 1))
  for (const row of byRem) {
    if (drift <= 0) break
    row.shareBps += 1
    drift -= 1
  }
  return drafted
    .sort((a, b) => b.shareBps - a.shareBps)
    .map((row) => ({ source: row.source, pool: row.pool, shareBps: row.shareBps }))
}

function asBig(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) return
      await fn(item)
    }
  })
  await Promise.all(workers)
}
