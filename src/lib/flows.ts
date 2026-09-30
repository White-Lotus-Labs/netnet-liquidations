/** Shapes served by nansen.mjs at /api/nansen. */
export type Holder = {
  address: string | null
  label: string | null
  amount: number | null
  change7d: number | null
  change30d: number | null
  valueUsd: number | null
}
export type Mover = {
  address: string | null
  label: string | null
  boughtUsd: number
  soldUsd: number
  boughtNet: number
  soldNet: number
}
export type Trade = {
  address: string | null
  label: string | null
  action: 'buy' | 'sell' | null
  amount: number | null
  valueUsd: number | null
  at: string | null
  tx: string | null
}
type Segment = { netUsd: number | null; wallets: number | null }
export type FlowRow = Record<'smart' | 'publicFigure' | 'topPnl' | 'whale' | 'exchange' | 'fresh', Segment>

export type NansenSnapshot = {
  fetchedAt: number
  ttlMinutes: number
  stale: boolean
  errors: string[]
  info: {
    holders: number | null
    buyVolumeUsd: number | null
    sellVolumeUsd: number | null
    buys: number | null
    sells: number | null
    uniqueBuyers: number | null
    uniqueSellers: number | null
    liquidityUsd: number | null
    totalSupply: number | null
  } | null
  flow1d: FlowRow | null
  flow7d: FlowRow | null
  buyers: Mover[] | null
  sellers: Mover[] | null
  smartTrades: Trade[] | null
  smartHolders: Holder[] | null
  holders: Holder[] | null
  wsHolders: Holder[] | null
}

export type LabelClass =
  | 'smart'
  | 'former-smart'
  | 'staking'
  | 'bot'
  | 'hl-trader'
  | 'public-figure'
  | 'protocol'
  | 'other'

/** Nansen appends "[0xabcdef]" and sometimes zero-width spaces. An address alone is not a label. */
export function cleanLabel(label: string | null | undefined): string | null {
  const text = (label ?? '').replace(/[​-‍﻿]/g, '').replace(/\s*\[0x[0-9a-f]+\]\s*$/i, '').trim()
  return text.length > 0 ? text : null
}

export function labelClass(label: string | null | undefined): LabelClass | null {
  const text = cleanLabel(label)
  if (!text) return null
  if (/NET Staking Pool/i.test(text)) return 'staking'
  if (/Former Smart/i.test(text)) return 'former-smart'
  // 🤓 is Nansen's smart-money mark. "Funded @x On Friendtech" is not a fund.
  if (/🤓|Smart Trader|Smart HL|\bFund\b/.test(text)) return 'smart'
  if (/🤖|Trading Bot/.test(text)) return 'bot'
  if (/^HL Perps|HL Referral|HL Vault/.test(text)) return 'hl-trader'
  if (/👤/.test(text)) return 'public-figure'
  if (/Uniswap|Liquidity Pool|Token Contract|Pendle|Morpho/i.test(text)) return 'protocol'
  return 'other'
}

export const CLASS_LABEL: Record<LabelClass | 'unlabeled', string> = {
  smart: 'Smart money',
  'former-smart': 'Former smart',
  staking: 'NET staking pool',
  bot: 'Bots',
  'hl-trader': 'Hyperliquid traders',
  'public-figure': 'Public figures',
  protocol: 'Protocol',
  other: 'Other labeled',
  unlabeled: 'Unlabeled',
}

export type NetMover = { address: string; label: string | null; boughtUsd: number; soldUsd: number; netUsd: number }

/** Join the BUY and SELL top lists on address. Each list already carries both sides. */
export function netMovers(buyers: Mover[], sellers: Mover[]): NetMover[] {
  const byAddress = new Map<string, NetMover>()
  for (const row of [...buyers, ...sellers]) {
    if (!row.address) continue
    const key = row.address.toLowerCase()
    const current = byAddress.get(key) ?? { address: row.address, label: cleanLabel(row.label), boughtUsd: 0, soldUsd: 0, netUsd: 0 }
    current.boughtUsd = Math.max(current.boughtUsd, row.boughtUsd)
    current.soldUsd = Math.max(current.soldUsd, row.soldUsd)
    current.netUsd = current.boughtUsd - current.soldUsd
    current.label ??= cleanLabel(row.label)
    byAddress.set(key, current)
  }
  return [...byAddress.values()]
}

export type SegmentTotal = { key: LabelClass | 'unlabeled'; wallets: number; boughtUsd: number; soldUsd: number; netUsd: number }

export function segmentTotals(movers: NetMover[]): SegmentTotal[] {
  const totals = new Map<SegmentTotal['key'], SegmentTotal>()
  for (const mover of movers) {
    const key = labelClass(mover.label) ?? 'unlabeled'
    const current = totals.get(key) ?? { key, wallets: 0, boughtUsd: 0, soldUsd: 0, netUsd: 0 }
    current.wallets += 1
    current.boughtUsd += mover.boughtUsd
    current.soldUsd += mover.soldUsd
    current.netUsd = current.boughtUsd - current.soldUsd
    totals.set(key, current)
  }
  return [...totals.values()].sort((a, b) => b.boughtUsd + b.soldUsd - (a.boughtUsd + a.soldUsd))
}

export type SmartTape = {
  trades: number
  boughtUsd: number
  soldUsd: number
  from: string | null
  to: string | null
  traders: Array<{ address: string; label: string | null; boughtUsd: number; soldUsd: number; netUsd: number; trades: number; lastAt: string | null }>
}

export function smartTape(trades: Trade[]): SmartTape {
  const traders = new Map<string, SmartTape['traders'][number]>()
  let boughtUsd = 0
  let soldUsd = 0
  let from: string | null = null
  let to: string | null = null
  for (const trade of trades) {
    if (!trade.address || !trade.action || trade.valueUsd === null) continue
    const key = trade.address.toLowerCase()
    const current = traders.get(key) ?? { address: trade.address, label: cleanLabel(trade.label), boughtUsd: 0, soldUsd: 0, netUsd: 0, trades: 0, lastAt: null }
    if (trade.action === 'buy') {
      current.boughtUsd += trade.valueUsd
      boughtUsd += trade.valueUsd
    } else {
      current.soldUsd += trade.valueUsd
      soldUsd += trade.valueUsd
    }
    current.netUsd = current.boughtUsd - current.soldUsd
    current.trades += 1
    if (trade.at && (!current.lastAt || trade.at > current.lastAt)) current.lastAt = trade.at
    if (trade.at && (!from || trade.at < from)) from = trade.at
    if (trade.at && (!to || trade.at > to)) to = trade.at
    traders.set(key, current)
  }
  return {
    trades: trades.length,
    boughtUsd,
    soldUsd,
    from,
    to,
    traders: [...traders.values()].sort((a, b) => b.netUsd - a.netUsd),
  }
}

export type HolderStats = {
  stakingAddress: string | null
  stakingShare: number | null
  stakingChange7d: number | null
  freeFloat: number | null
  top10FreeShare: number | null
  grew7d: number
  shrank7d: number
}

/**
 * Supply split around the staking pool. Nansen labels it "NET Staking Pool";
 * if the label is missing, the largest holder above 50% is taken as the pool.
 */
export function holderStats(holders: Holder[], totalSupply: number | null): HolderStats {
  const sorted = [...holders].filter((row) => row.address && row.amount !== null).sort((a, b) => b.amount! - a.amount!)
  const labeled = sorted.find((row) => labelClass(row.label) === 'staking')
  const pool = labeled ?? (totalSupply && sorted[0] && sorted[0].amount! / totalSupply > 0.5 ? sorted[0] : null)
  const rest = sorted.filter((row) => row !== pool && labelClass(row.label) !== 'protocol')
  const freeFloat = totalSupply !== null && pool ? totalSupply - pool.amount! : null
  const top10 = rest.slice(0, 10).reduce((sum, row) => sum + row.amount!, 0)
  return {
    stakingAddress: pool?.address ?? null,
    stakingShare: pool && totalSupply ? pool.amount! / totalSupply : null,
    stakingChange7d: pool?.change7d ?? null,
    freeFloat,
    top10FreeShare: freeFloat && freeFloat > 0 ? top10 / freeFloat : null,
    grew7d: rest.filter((row) => (row.change7d ?? 0) > 0.01).length,
    shrank7d: rest.filter((row) => (row.change7d ?? 0) < -0.01).length,
  }
}

/** Every non-empty label Nansen returned, keyed by lowercase address. */
export function labelMap(snapshot: NansenSnapshot | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!snapshot) return map
  const add = (address: string | null, label: string | null) => {
    const text = cleanLabel(label)
    if (address && text) map.set(address.toLowerCase(), text)
  }
  for (const list of [snapshot.holders, snapshot.wsHolders, snapshot.smartHolders, snapshot.buyers, snapshot.sellers]) {
    for (const row of list ?? []) add(row.address, row.label)
  }
  for (const row of snapshot.smartTrades ?? []) add(row.address, row.label)
  return map
}

export type Overlap = { buyers: number; buyUsd: number; sellers: number; sellUsd: number }

/** How many of `addresses` are net buyers or net sellers in the week's top lists. */
export function overlap(addresses: Iterable<string>, movers: NetMover[]): Overlap {
  const set = new Set([...addresses].map((address) => address.toLowerCase()))
  const result: Overlap = { buyers: 0, buyUsd: 0, sellers: 0, sellUsd: 0 }
  for (const mover of movers) {
    if (!set.has(mover.address.toLowerCase())) continue
    if (mover.netUsd >= 0) {
      result.buyers += 1
      result.buyUsd += mover.netUsd
    } else {
      result.sellers += 1
      result.sellUsd -= mover.netUsd
    }
  }
  return result
}
