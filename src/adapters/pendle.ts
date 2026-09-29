import { ADDRESSES, CHAIN_ID, PENDLE_API } from '../config.ts'

export type PendleMarket = {
  address: string
  expiry: number
  /** Pendle reports APY as a fraction: 88.12 means +8,812% a year. */
  impliedApy: number
  underlyingApy: number
  liquidityUsd: number
  tvlUsd: number
  volumeUsd: number
}

export type PendleBook = {
  fetchedAt: number
  /** Nearest sNET maturity still trading. */
  active: PendleMarket | null
  /** Every sNET maturity Pendle lists, soonest expiry first. */
  markets: PendleMarket[]
  history: Array<{ t: number; impliedApy: number; underlyingApy: number; tvlUsd: number }>
}

type ApiMarket = {
  address: string
  expiry: string
  underlyingAsset: string
  details?: {
    impliedApy?: number
    underlyingApy?: number
    liquidity?: number
    totalTvl?: number
    tradingVolume?: number
  }
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : NaN)

export async function readPendle(signal?: AbortSignal): Promise<PendleBook> {
  const all = await getJson<{ markets: ApiMarket[] }>(`${PENDLE_API}/v1/markets/all?chainId=${CHAIN_ID}`, signal)
  const underlying = `${CHAIN_ID}-${ADDRESSES.pendleSnetUnderlying}`.toLowerCase()
  const now = Date.now()
  const markets = all.markets
    .filter((market) => market.underlyingAsset.toLowerCase() === underlying)
    .map((market) => ({
      address: market.address,
      expiry: Date.parse(market.expiry),
      impliedApy: num(market.details?.impliedApy),
      underlyingApy: num(market.details?.underlyingApy),
      liquidityUsd: num(market.details?.liquidity),
      tvlUsd: num(market.details?.totalTvl),
      volumeUsd: num(market.details?.tradingVolume),
    }))
    .sort((a, b) => a.expiry - b.expiry)
  const active = markets.find((market) => market.expiry > now) ?? null

  let history: PendleBook['history'] = []
  if (active) {
    try {
      const data = await getJson<{
        results: Array<{ timestamp: string; impliedApy: number; underlyingApy: number; tvl: number }>
      }>(`${PENDLE_API}/v2/${CHAIN_ID}/markets/${active.address}/historical-data?time_frame=day`, signal)
      history = data.results.map((row) => ({
        t: Date.parse(row.timestamp),
        impliedApy: num(row.impliedApy),
        underlyingApy: num(row.underlyingApy),
        tvlUsd: num(row.tvl),
      }))
    } catch (error) {
      if (signal?.aborted) throw error
    }
  }
  return { fetchedAt: now, active, markets, history }
}

/** PT discount to par implied by the market's own implied APY. */
export function ptDiscount(impliedApy: number, expiry: number, now = Date.now()): number | null {
  const years = (expiry - now) / (365 * 86_400_000)
  if (!(years > 0) || !Number.isFinite(impliedApy)) return null
  return 1 - Math.exp(-Math.log1p(impliedApy) * years)
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Pendle API HTTP ${response.status}`)
  return (await response.json()) as T
}
