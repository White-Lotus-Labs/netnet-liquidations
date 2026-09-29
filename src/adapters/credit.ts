import { ADDRESSES, CHAIN_ID } from '../config.ts'
import { gql } from './morpho.ts'

/** Display figures in whole USDG. Not token accounting. */
export type CreditMarket = {
  marketId: string
  collateral: string
  lltv: number
  capUsdg: number
  allocatedUsdg: number
  supplyUsdg: number
  borrowUsdg: number
  liquidityUsdg: number
  utilization: number
  borrowApy: number
  apyAtTarget: number
  rateAtTargetApr: number
  badDebtUsdg: number
  borrowers: number | null
  topBorrowers: Array<{ address: string; borrowUsdg: number; health: number | null }>
}

export type Exposure = { address: string; vaultUsdg: number; share: number; markets: string[] }

export type CreditBook = {
  fetchedAt: number
  vault: {
    totalAssetsUsdg: number
    liquidityUsdg: number
    sharePrice: number
    apy: number
    netApy: number
    maxApy: number
    performanceFee: number
    depositors: number
    topDepositors: Array<{ address: string; usdg: number }>
  }
  markets: CreditMarket[]
  /** Borrowers weighted by the vault's share of each market's supply. */
  exposures: Exposure[]
  loopback: {
    history: Array<{ t: number; borrowApy: number; utilization: number }>
    supplyDaily: Array<{ t: number; supplyUsdg: number }>
  }
}

const USDG = 1e6
const SECONDS_PER_YEAR = 31_536_000

const VAULT_QUERY = `
query Credit($vault: String!, $chain: Int!, $market: String!, $start: Int!, $end: Int!) {
  vault: vaultV2ByAddress(address: $vault, chainId: $chain) {
    totalAssets liquidity sharePrice apy netApy maxApy performanceFee
    positions(first: 500) { pageInfo { countTotal } items { user { address } assets } }
    caps(first: 50) {
      items {
        type absoluteCap allocation
        data {
          ... on MarketV1CapData {
            market {
              marketId lltv
              collateralAsset { symbol }
              state { supplyAssets borrowAssets liquidityAssets utilization borrowApy apyAtTarget rateAtTarget }
              badDebt { underlying }
            }
          }
        }
      }
    }
  }
  loopback: marketById(marketId: $market, chainId: $chain) {
    historicalState {
      borrowApy(options: { startTimestamp: $start, endTimestamp: $end, interval: HOUR }) { x y }
      utilization(options: { startTimestamp: $start, endTimestamp: $end, interval: HOUR }) { x y }
      supplyAssets(options: { startTimestamp: $start, endTimestamp: $end, interval: DAY }) { x y }
    }
  }
}
`

type Point = { x: number; y: number | string | null }
type CapMarket = {
  marketId: string
  lltv: string
  collateralAsset: { symbol: string } | null
  state: {
    supplyAssets: string | number
    borrowAssets: string | number
    liquidityAssets: string | number
    utilization: number
    borrowApy: number
    apyAtTarget: number
    rateAtTarget: string | number
  } | null
  badDebt: { underlying: string | number } | null
}
type VaultResponse = {
  vault: {
    totalAssets: string | number
    liquidity: string | number
    sharePrice: number
    apy: number
    netApy: number
    maxApy: number
    performanceFee: number
    positions: { pageInfo: { countTotal: number }; items: Array<{ user: { address: string }; assets: string | number }> }
    caps: { items: Array<{ type: string; absoluteCap: string | number; allocation: string | number; data: { market?: CapMarket } | null }> }
  } | null
  loopback: {
    historicalState: { borrowApy: Point[]; utilization: Point[]; supplyAssets: Point[] }
  } | null
}
type PositionsResponse = Record<
  string,
  { pageInfo: { countTotal: number }; items: Array<{ user: { address: string }; state: { borrowAssets: string | number }; healthFactor: number | null }> }
>

const usdg = (raw: string | number | null | undefined): number => (raw == null ? 0 : Number(raw) / USDG)

export async function readCredit(signal?: AbortSignal): Promise<CreditBook> {
  const end = Math.floor(Date.now() / 1000)
  const data = await gql<VaultResponse>(
    VAULT_QUERY,
    { vault: ADDRESSES.creditVault, chain: CHAIN_ID, market: ADDRESSES.marketId, start: end - 14 * 86_400, end },
    signal,
  )
  const vault = data.vault
  if (!vault) throw new Error('Morpho API has no NetNet Credit vault')

  const markets: CreditMarket[] = vault.caps.items.flatMap((cap) => {
    const market = cap.type === 'MarketV1' ? cap.data?.market : undefined
    if (!market?.state) return []
    return [
      {
        marketId: market.marketId,
        collateral: market.collateralAsset?.symbol ?? '?',
        lltv: Number(market.lltv) / 1e18,
        capUsdg: usdg(cap.absoluteCap),
        allocatedUsdg: usdg(cap.allocation),
        supplyUsdg: usdg(market.state.supplyAssets),
        borrowUsdg: usdg(market.state.borrowAssets),
        liquidityUsdg: usdg(market.state.liquidityAssets),
        utilization: market.state.utilization,
        borrowApy: market.state.borrowApy,
        apyAtTarget: market.state.apyAtTarget,
        rateAtTargetApr: (Number(market.state.rateAtTarget) / 1e18) * SECONDS_PER_YEAR,
        badDebtUsdg: usdg(market.badDebt?.underlying),
        borrowers: null,
        topBorrowers: [],
      },
    ]
  })
  markets.sort((a, b) => b.allocatedUsdg - a.allocatedUsdg)

  await attachBorrowers(markets, signal)

  const history = data.loopback?.historicalState
  const utilByT = new Map((history?.utilization ?? []).map((point) => [point.x, Number(point.y)]))
  return {
    fetchedAt: Date.now(),
    vault: {
      totalAssetsUsdg: usdg(vault.totalAssets),
      liquidityUsdg: usdg(vault.liquidity),
      sharePrice: vault.sharePrice,
      apy: vault.apy,
      netApy: vault.netApy,
      maxApy: vault.maxApy,
      performanceFee: vault.performanceFee,
      depositors: vault.positions.pageInfo.countTotal,
      topDepositors: vault.positions.items
        .map((item) => ({ address: item.user.address, usdg: usdg(item.assets) }))
        .sort((a, b) => b.usdg - a.usdg)
        .slice(0, 5),
    },
    markets,
    exposures: exposuresOf(markets),
    loopback: {
      history: (history?.borrowApy ?? [])
        .filter((point) => point.y !== null)
        .map((point) => ({ t: point.x * 1000, borrowApy: Number(point.y), utilization: utilByT.get(point.x) ?? NaN }))
        .sort((a, b) => a.t - b.t),
      supplyDaily: (history?.supplyAssets ?? [])
        .filter((point) => point.y !== null)
        .map((point) => ({ t: point.x * 1000, supplyUsdg: usdg(point.y) }))
        .sort((a, b) => a.t - b.t),
    },
  }
}

/** One aliased query for the top borrowers of every funded market. */
async function attachBorrowers(markets: CreditMarket[], signal?: AbortSignal): Promise<void> {
  const funded = markets.filter((market) => market.borrowUsdg > 0)
  if (funded.length === 0) return
  const fields = funded
    .map(
      (market, i) => `m${i}: marketPositions(first: 5, orderBy: BorrowShares, orderDirection: Desc, where: {
        marketUniqueKey_in: ["${market.marketId}"], chainId_in: [${CHAIN_ID}], borrowShares_gte: "1" }) {
        pageInfo { countTotal } items { user { address } state { borrowAssets } healthFactor } }`,
    )
    .join('\n')
  try {
    const data = await gql<PositionsResponse>(`query { ${fields} }`, {}, signal)
    funded.forEach((market, i) => {
      const block = data[`m${i}`]
      if (!block) return
      market.borrowers = block.pageInfo.countTotal
      market.topBorrowers = block.items.map((item) => ({
        address: item.user.address,
        borrowUsdg: usdg(item.state.borrowAssets),
        health: typeof item.healthFactor === 'number' ? item.healthFactor : null,
      }))
    })
  } catch (error) {
    if (signal?.aborted) throw error
    // Concentration is a nice-to-have. The market table still renders without it.
  }
}

export function exposuresOf(markets: CreditMarket[]): Exposure[] {
  const totalAllocated = markets.reduce((sum, market) => sum + market.allocatedUsdg, 0)
  if (totalAllocated <= 0) return []
  const byAddress = new Map<string, Exposure>()
  for (const market of markets) {
    if (market.supplyUsdg <= 0) continue
    const vaultShare = Math.min(1, market.allocatedUsdg / market.supplyUsdg)
    for (const borrower of market.topBorrowers) {
      const key = borrower.address.toLowerCase()
      const current = byAddress.get(key) ?? { address: borrower.address, vaultUsdg: 0, share: 0, markets: [] }
      current.vaultUsdg += borrower.borrowUsdg * vaultShare
      current.markets.push(market.collateral)
      byAddress.set(key, current)
    }
  }
  return [...byAddress.values()]
    .map((exposure) => ({ ...exposure, share: exposure.vaultUsdg / totalAllocated }))
    .sort((a, b) => b.vaultUsdg - a.vaultUsdg)
    .slice(0, 5)
}
