import { ADDRESSES, CHAIN_ID, MORPHO_GRAPHQL } from '../config.ts'
import type { FootnoteMarket, RawPosition } from '../types.ts'

export type MorphoBook = {
  supplyRaw: bigint | null
  borrowRaw: bigint | null
  collateralRaw: bigint | null
  utilization: number | null
  supplyApy: number | null
  borrowApy: number | null
  apiTimestamp: number | null
  positions: RawPosition[]
  borrowerCount: number | null
  footnote: FootnoteMarket | null
}

const POSITIONS_QUERY = `
query Positions($market: String!, $chain: Int!, $first: Int!, $skip: Int!) {
  marketPositions(
    first: $first
    skip: $skip
    orderBy: HealthFactor
    orderDirection: Asc
    where: {
      marketUniqueKey_in: [$market]
      chainId_in: [$chain]
      borrowShares_gte: "1"
    }
  ) {
    pageInfo { countTotal }
    items {
      healthFactor
      user { address }
      state { collateral borrowAssets }
    }
  }
}
`

const MARKET_QUERY = `
query Markets($market: String!, $footnote: String!, $chain: Int!) {
  marketById(marketId: $market, chainId: $chain) {
    state {
      supplyAssets
      borrowAssets
      collateralAssets
      utilization
      supplyApy
      borrowApy
      timestamp
    }
  }
  footnote: marketById(marketId: $footnote, chainId: $chain) {
    state { borrowAssets supplyAssets utilization }
  }
}
`

export async function readMorpho(signal?: AbortSignal): Promise<MorphoBook> {
  const market = await gql<{
    marketById: { state: MarketState } | null
    footnote: { state: { borrowAssets: unknown; supplyAssets: unknown; utilization: number | null } } | null
  }>(
    MARKET_QUERY,
    { market: ADDRESSES.marketId, footnote: ADDRESSES.footnoteMarketId, chain: CHAIN_ID },
    signal,
  )

  const state = market.marketById?.state
  const positions = await readAllPositions(signal)
  const footnoteState = market.footnote?.state

  return {
    supplyRaw: state ? asBig(state.supplyAssets, 'supply') : null,
    borrowRaw: state ? asBig(state.borrowAssets, 'borrow') : null,
    collateralRaw: state ? asBig(state.collateralAssets, 'collateral') : null,
    utilization: state?.utilization ?? null,
    supplyApy: state?.supplyApy ?? null,
    borrowApy: state?.borrowApy ?? null,
    apiTimestamp: state?.timestamp ?? null,
    positions: positions.items,
    borrowerCount: positions.total,
    footnote: footnoteState
      ? {
          borrowRaw: asBig(footnoteState.borrowAssets, 'footnote borrow'),
          supplyRaw: asBig(footnoteState.supplyAssets, 'footnote supply'),
          utilization: footnoteState.utilization,
        }
      : null,
  }
}

async function readAllPositions(signal?: AbortSignal): Promise<{ items: RawPosition[]; total: number | null }> {
  const pageSize = 100
  const first = await fetchPage(0, pageSize, signal)
  const items = [...first.items]
  const total = first.total
  const skips: number[] = []
  const cap = total ?? pageSize
  for (let skip = pageSize; skip < cap && skip < 2_000; skip += pageSize) skips.push(skip)
  const rest = await Promise.all(skips.map((skip) => fetchPage(skip, pageSize, signal)))
  for (const page of rest) items.push(...page.items)
  return { items, total }
}

async function fetchPage(
  skip: number,
  first: number,
  signal?: AbortSignal,
): Promise<{ items: RawPosition[]; total: number | null }> {
  const data = await gql<{
    marketPositions: {
      pageInfo: { countTotal: number | null }
      items: Array<{
        healthFactor: number | null
        user: { address: string }
        state: { collateral: unknown; borrowAssets: unknown }
      }>
    }
  }>(POSITIONS_QUERY, { market: ADDRESSES.marketId, chain: CHAIN_ID, first, skip }, signal)

  const block = data.marketPositions
  return {
    total: block.pageInfo.countTotal,
    items: block.items.map((item) => ({
      address: item.user.address,
      collateralRaw: asBig(item.state.collateral, 'collateral') ?? 0n,
      borrowRaw: asBig(item.state.borrowAssets, 'borrow') ?? 0n,
      indexedHealth: typeof item.healthFactor === 'number' && Number.isFinite(item.healthFactor) ? item.healthFactor : null,
    })),
  }
}

type MarketState = {
  supplyAssets: unknown
  borrowAssets: unknown
  collateralAssets: unknown
  utilization: number | null
  supplyApy: number | null
  borrowApy: number | null
  timestamp: number | null
}

export async function gql<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(MORPHO_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  })
  if (!response.ok) throw new Error(`Morpho API HTTP ${response.status}`)
  const json = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> }
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message ?? 'GraphQL error').join('; '))
  }
  if (!json.data) throw new Error('Morpho API returned no data')
  return json.data
}

function asBig(value: unknown, label: string): bigint | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (value === null || value === undefined) return null
  throw new Error(`${label} from Morpho was not a precise integer`)
}
