import { cleanLabel, labelClass } from './flows.ts'
import { protocolLabel } from './protocol.ts'

/** Shape served by bonds.mjs at /api/bonds. Columnar: bonds.w[i] is an index into wallets. */
export type BondFeed = {
  fetchedAt: number // ms
  status: 'ready' | 'indexing'
  progress: { step: string; done: number; total: number } | null
  headBlock: number | null
  headTime: number | null // unix s
  startTime: number // unix s
  epochSeconds: number // 28800
  capBps: number // 25
  wallets: string[] // lowercase, index = wallet id
  bonds: { t: number[]; w: number[]; usdg: Array<number | null>; net: number[]; price: number[]; src: BondSource[] }
  epochCaps: Record<string, number> // epoch → cap NET (supply before the epoch's first bond × 0.0025); includes the current epoch from live supply
  index: number | null // sNET index now (NET per wsNET)
  indexPoints: Array<[number, number]> // [unix s, index] from LogRebase, ascending
  /** NET deposited into the desks. `minted` is 1 when the NET was minted in the deposit transaction. */
  inventory: Array<[t: number, src: BondSource, net: number, minted: 0 | 1]>
  /** The manager sleeve's NET flows. `usd` is the USDG it paid, for DEX buys only. */
  sleeve: Array<[t: number, net: number, kind: SleeveKind, usd: number]>
  /** NET/USDG 4 h candle closes, [unix s at candle open, USDG per NET], ascending. */
  price: Array<[t: number, close: number]>
  labels: Record<string, string> // lowercase address → raw Nansen label
  labelsReadThrough: string | null // ISO day
  holdings: Record<string, Holding> | null // lowercase address → position now, in NET terms
  holdingsAt: number | null // ms
  /** Bond buyers' Nansen DEX trades per window. Null without a Nansen key or before the first read. */
  dex: { at: number; windows: Record<BondWindow, { from: string; to: string; rows: Record<string, DexRow> }> } | null
  live: { bondPrice: number | null; twap: number | null; epoch: number | null; epochSold: number | null; supply: number | null }
  errors: string[]
}

export type BondWindow = '24h' | '7d' | '14d' | '30d' | 'all'
/** NET in the wallet, sNET, wsNET × index, wsNET in Morpho (Loopback + twin) × index, unvested + unclaimed bonds (depository and desks). */
export type Holding = [liquid: number, staked: number, wrapped: number, looped: number, vesting: number]
/** DEX trades in the window. DEX only; transfers are not in it. */
export type DexRow = [soldNet: number, soldUsd: number, boughtNet: number, boughtUsd: number]
/** 0 bond depository (mints NET at bond time), 1 RWA desk v2, 2 asset desk, 3 sleeve desk v3, 4 RWA desk v1. The desks sell NET deposited first. */
export type BondSource = 0 | 1 | 2 | 3 | 4
/** 'buy' = NET in while the sleeve paid USDG in the same transaction; 'desk' = NET out to a bond desk. */
export type SleeveKind = 'buy' | 'desk' | 'other-in' | 'other-out'

export const SOURCES: BondSource[] = [0, 1, 2, 3, 4]
export const SOURCE_LABEL: Record<BondSource, string> = { 0: 'Bond depository', 1: 'RWA desk v2', 2: 'Asset desk', 3: 'Sleeve desk v3', 4: 'RWA desk v1' }
/** The v3 desk (SleeveBondDesk) deploy block and its block time, 2026-09-30T18:31:30Z (read once from the chain). */
export const V3_LAUNCH = { block: 76_732_423, at: 1_790_793_090 } as const

const WINDOW_DAYS: Record<BondWindow, number | null> = { '24h': 1, '7d': 7, '14d': 14, '30d': 30, all: null }

/** Unix s where the window starts. "all" starts at launch. */
export function windowSince(window: BondWindow, now: number, startTime: number): number {
  const days = WINDOW_DAYS[window]
  return days === null ? startTime : now - days * 86_400
}

export type BondCohort = 'smart' | 'public' | 'hl' | 'labelled' | 'unlabelled' | 'unread'

const COHORTS: BondCohort[] = ['smart', 'public', 'hl', 'labelled', 'unlabelled', 'unread']

export const COHORT_LABEL: Record<BondCohort, string> = {
  smart: 'Smart money',
  public: 'Public figures',
  hl: 'Hyperliquid traders',
  labelled: 'Other labelled',
  unlabelled: 'Unlabelled',
  unread: 'Not read yet',
}

/** An epoch counts as sold out at 99.5% of its cap: bond mints raise supply, and the cap with it, inside the epoch. */
const SOLD_OUT = 0.995

type Derived = { ids: Map<string, number>; firstAt: number[] }
const derivedCache = new WeakMap<BondFeed, Derived>()

function derived(feed: BondFeed): Derived {
  let value = derivedCache.get(feed)
  if (!value) {
    const firstAt = feed.wallets.map(() => Infinity)
    feed.bonds.w.forEach((w, i) => {
      firstAt[w] = Math.min(firstAt[w], feed.bonds.t[i])
    })
    value = {
      ids: new Map(feed.wallets.map((address, i) => [address, i])),
      firstAt,
    }
    derivedCache.set(feed, value)
  }
  return value
}

const epochOf = (feed: BondFeed, t: number) => Math.floor((t - feed.startTime) / feed.epochSeconds)
// A feed from an older server has no source column: every bond came from the depository.
const srcAt = (feed: BondFeed, i: number): BondSource => feed.bonds.src?.[i] ?? 0

/** Last value at or before t in ascending [t, value] points. Null before the first point. */
export function stepAt(points: ReadonlyArray<readonly [number, number]>, t: number): number | null {
  let low = 0
  let high = points.length - 1
  let found: number | null = null
  while (low <= high) {
    const mid = (low + high) >> 1
    if (points[mid][0] <= t) {
      found = points[mid][1]
      low = mid + 1
    } else high = mid - 1
  }
  return found
}

/** Unix s of each source's first bond, null when it has none. */
export function sourceStarts(feed: BondFeed): Array<number | null> {
  const starts: Array<number | null> = SOURCES.map(() => null)
  feed.bonds.t.forEach((t, i) => {
    const src = srcAt(feed, i)
    if (starts[src] === null || t < starts[src]) starts[src] = t
  })
  return starts
}

/** NetNet's registry name wins. Then a real Nansen label beats an address-only one, and the feed's own label wins over the snapshot's. */
function labelOf(address: string, feed: BondFeed, extraLabels?: Map<string, string>): string | null {
  const own = feed.labels[address]
  return protocolLabel(address) ?? (cleanLabel(own) ? own : (extraLabels?.get(address) ?? own ?? null))
}

export function bondCohort(address: string, feed: BondFeed, extraLabels?: Map<string, string>): BondCohort {
  const key = address.toLowerCase()
  const label = labelOf(key, feed, extraLabels)
  // No row from Nansen. Labels come from bond payouts and DEX sells, so a wallet that never claimed or sold
  // has none, whatever its bond date. Nansen says "unlabelled" with an address-only label.
  if (label === null) return 'unread'
  switch (labelClass(label)) {
    case null:
      return 'unlabelled'
    case 'smart':
      return 'smart'
    case 'public-figure':
      return 'public'
    case 'hl-trader':
      return 'hl'
    default:
      return 'labelled'
  }
}

const zeroCohorts = (): Record<BondCohort, number> => ({ smart: 0, public: 0, hl: 0, labelled: 0, unlabelled: 0, unread: 0 })

/** What a buyer did with bonded NET, from all-time behavior. The first rule that matches wins; see GROUP_INFO. */
export type BondGroup = 'protocol' | 'new' | 'arbitrageur' | 'weak' | 'mercenary' | 'mover' | 'left' | 'looper' | 'strong' | 'trimmer' | 'mixed' | 'unknown'

export const GROUPS: BondGroup[] = ['protocol', 'new', 'arbitrageur', 'weak', 'mercenary', 'mover', 'left', 'looper', 'strong', 'trimmer', 'mixed', 'unknown']

export const GROUP_INFO: Record<BondGroup, { name: string; info: string }> = {
  protocol: { name: 'Protocol wallets', info: "NetNet's own contracts and team wallets." },
  new: { name: 'New buyers', info: 'First bond in the last 48 h, half or more still vesting.' },
  arbitrageur: { name: 'Arbitrageurs', info: 'Bonded in 3+ epochs, sold 80%+ on the DEX.' },
  weak: { name: 'Weak hands', info: 'Sold half or more below their bond cost.' },
  mercenary: { name: 'Mercenaries', info: 'Sold half or more at a profit.' },
  mover: { name: 'Movers', info: 'Half or more left the wallet, not through the DEX.' },
  left: { name: 'Left the wallet', info: 'Half or more left the wallet. DEX sells are not read yet, so sold and moved are one group.' },
  looper: { name: 'Loopers', info: 'Still hold half or more. Half or more of that is Loopback collateral.' },
  strong: { name: 'Strong hands', info: 'Still hold 80%+, sold under 10%.' },
  trimmer: { name: 'Trimmers', info: 'Still hold half or more.' },
  mixed: { name: 'Mixed', info: 'No rule above fits.' },
  unknown: { name: 'Not read yet', info: 'No holdings read for this wallet yet.' },
}

const NEW_SECONDS = 48 * 3600

export type EpochRow = {
  epoch: number
  opensAt: number // unix s
  cap: number | null // NET; empty epochs carry the last known cap
  sold: number // NET from the depository, the only capped source
  net: number // NET bonded from every source
  fill: number // 0..1, depository sold / cap
  soldOut: boolean
  soldOutAfter: number | null // seconds from open to the bond that filled 99.5% of the cap
  firstMinuteShare: number // share of depository NET bought within 60 s of open
  wallets: number
  newWallets: number // wallets whose first bond ever is in this epoch
  usdg: number
  avgPrice: number | null // USDG per NET, bonds paid in USDG (or USD value) only
  price: number | null // NET/USDG close of the 4 h candle at or before the epoch's midpoint
  byCohort: Record<BondCohort, number> // NET, every source
  bySource: number[] // NET, index = BondSource
  byGroup: Record<BondGroup, number> // NET; all 'unknown' without groupOf
}

const zeroGroups = () => Object.fromEntries(GROUPS.map((group) => [group, 0])) as Record<BondGroup, number>

/**
 * One row per epoch from fromEpoch to toEpoch, empty epochs included. Desk bonds fall in the same
 * 8 h epochs but have no cap. `groupOf` is usually `walletGroups(feed, now)`.
 */
export function epochSeries(
  feed: BondFeed,
  { fromEpoch, toEpoch, cohortOf, groupOf }: { fromEpoch: number; toEpoch: number; cohortOf: (address: string) => BondCohort; groupOf?: (address: string) => BondGroup },
): EpochRow[] {
  const { firstAt } = derived(feed)
  const cohorts = feed.wallets.map(cohortOf)
  const groups = feed.wallets.map((address) => groupOf?.(address) ?? 'unknown')
  const capKeys = Object.keys(feed.epochCaps)
    .map(Number)
    .sort((a, b) => a - b)
  let cap: number | null = capKeys.length ? feed.epochCaps[capKeys[0]] : null
  for (const key of capKeys) if (key <= fromEpoch) cap = feed.epochCaps[key]

  const rows: EpochRow[] = []
  const extra: Array<{ wallets: Set<number>; fresh: Set<number>; firstMinute: number; quoteNet: number }> = []
  for (let epoch = fromEpoch; epoch <= toEpoch; epoch++) {
    cap = feed.epochCaps[epoch] ?? cap
    const opensAt = feed.startTime + epoch * feed.epochSeconds
    rows.push({
      epoch,
      opensAt,
      cap,
      sold: 0,
      net: 0,
      fill: 0,
      soldOut: false,
      soldOutAfter: null,
      firstMinuteShare: 0,
      wallets: 0,
      newWallets: 0,
      usdg: 0,
      avgPrice: null,
      price: stepAt(feed.price ?? [], opensAt + feed.epochSeconds / 2),
      byCohort: zeroCohorts(),
      bySource: SOURCES.map(() => 0),
      byGroup: zeroGroups(),
    })
    extra.push({ wallets: new Set(), fresh: new Set(), firstMinute: 0, quoteNet: 0 })
  }

  const { t, w, net, usdg } = feed.bonds
  for (let i = 0; i < t.length; i++) {
    const epoch = epochOf(feed, t[i])
    if (epoch < fromEpoch || epoch > toEpoch) continue
    const row = rows[epoch - fromEpoch]
    const more = extra[epoch - fromEpoch]
    row.net += net[i]
    row.bySource[srcAt(feed, i)] += net[i]
    row.byCohort[cohorts[w[i]]] += net[i]
    row.byGroup[groups[w[i]]] += net[i]
    more.wallets.add(w[i])
    if (epochOf(feed, firstAt[w[i]]) === epoch) more.fresh.add(w[i])
    const quote = usdg[i]
    if (quote !== null) {
      row.usdg += quote
      more.quoteNet += net[i]
    }
    if (srcAt(feed, i) !== 0) continue
    row.sold += net[i]
    if (row.soldOutAfter === null && row.cap !== null && row.sold >= SOLD_OUT * row.cap) row.soldOutAfter = t[i] - row.opensAt
    if (t[i] - row.opensAt <= 60) more.firstMinute += net[i]
  }

  rows.forEach((row, k) => {
    const more = extra[k]
    row.fill = row.cap ? Math.min(1, row.sold / row.cap) : 0
    row.soldOut = row.soldOutAfter !== null
    row.firstMinuteShare = row.sold > 0 ? more.firstMinute / row.sold : 0
    row.wallets = more.wallets.size
    row.newWallets = more.fresh.size
    row.avgPrice = more.quoteNet > 0 ? row.usdg / more.quoteNet : null
  })
  return rows
}

type WalletStat = {
  net: number
  usdg: number
  quoteNet: number
  bonds: number
  epochs: Set<number>
  lastAt: number
  bySource: number[]
  expected: number
  paid: number
  epochsEver: Set<number>
}

/**
 * Window totals per wallet id for bonds with since ≤ t ≤ until, plus all-time facts: `expected`, the NET
 * the wallet would hold now had it staked each payout at once (payout × index now / index at the bond),
 * `paid`, the USDG those bonds cost, and every epoch it bonded in. Bonds after the holdings read are left
 * out of `expected` and `paid`.
 */
function walletStats(feed: BondFeed, since: number, until: number): WalletStat[] {
  const stats = feed.wallets.map(() => ({
    net: 0,
    usdg: 0,
    quoteNet: 0,
    bonds: 0,
    epochs: new Set<number>(),
    lastAt: 0,
    bySource: SOURCES.map(() => 0),
    expected: 0,
    paid: 0,
    epochsEver: new Set<number>(),
  }))
  const points = feed.indexPoints
  const indexNow = feed.index ?? points.at(-1)?.[1] ?? null
  const cutoff = feed.holdingsAt === null ? Infinity : feed.holdingsAt / 1000
  const { t, w, net, usdg } = feed.bonds
  let p = 0
  for (let i = 0; i < t.length; i++) {
    const stat = stats[w[i]]
    const epoch = epochOf(feed, t[i])
    stat.epochsEver.add(epoch)
    if (t[i] <= cutoff) {
      while (p + 1 < points.length && points[p + 1][0] <= t[i]) p++
      const indexThen = points[p]?.[1]
      stat.expected += indexNow && indexThen ? (net[i] * indexNow) / indexThen : net[i]
      stat.paid += usdg[i] ?? 0
    }
    if (t[i] < since || t[i] > until) continue
    stat.net += net[i]
    stat.bonds += 1
    stat.epochs.add(epoch)
    stat.lastAt = Math.max(stat.lastAt, t[i])
    stat.bySource[srcAt(feed, i)] += net[i]
    const quote = usdg[i]
    if (quote !== null) {
      stat.usdg += quote
      stat.quoteNet += net[i]
    }
  }
  return stats
}

export type Position = { liquid: number; staked: number; wrapped: number; looped: number; vesting: number } // NET
/** Fractions of expected NET. `sold` and `moved` split `left`; both are null without DEX data. */
export type Split = Position & { left: number; sold: number | null; moved: number | null }

const PARTS = ['vesting', 'staked', 'wrapped', 'looped', 'liquid'] as const

function positionOf(feed: BondFeed, address: string): Position | null {
  const holding = feed.holdings?.[address]
  if (!Array.isArray(holding)) return null
  const [liquid, staked, wrapped, looped, vesting] = holding
  return { liquid, staked, wrapped, looped, vesting }
}

const sizeOf = (position: Position) => PARTS.reduce((sum, part) => sum + position[part], 0)

/**
 * Where a wallet's bonded NET is now, as fractions of `expected`. A wallet can hold NET it bought
 * elsewhere, so the position is capped at what bonding explains. `soldAll` is the wallet's DEX sells
 * since launch (null without DEX data): NET can leave after the window starts, from bonds of any age.
 */
export function outcomeSplit(position: Position, expected: number, soldAll: number | null): Split | null {
  if (expected <= 0) return null
  const size = sizeOf(position)
  const scale = size > expected ? expected / size : 1
  const part = (value: number) => (value * scale) / expected
  const left = Math.max(0, 1 - part(size))
  const sold = soldAll === null ? null : Math.min(left, soldAll / expected)
  return {
    vesting: part(position.vesting),
    staked: part(position.staked),
    wrapped: part(position.wrapped),
    looped: part(position.looped),
    liquid: part(position.liquid),
    left,
    sold,
    moved: sold === null ? null : left - sold,
  }
}

/** Facts beyond the split. `loss` is null without DEX data. */
export type GroupFacts = { protocol: boolean; recent: boolean; epochs: number; loss: boolean | null }

/** One group per wallet: the first rule that matches. Without DEX data, sold and moved are one group, `left`. */
export function bondGroup(split: Split | null, { protocol, recent, epochs, loss }: GroupFacts): BondGroup {
  if (protocol) return 'protocol'
  if (!split) return 'unknown'
  const kept = 1 - split.left
  if (recent && split.vesting >= 0.5) return 'new'
  if (split.sold === null) {
    if (split.left >= 0.5) return 'left'
  } else {
    if (split.sold >= 0.8 && epochs >= 3) return 'arbitrageur'
    if (split.sold >= 0.5) return loss ? 'weak' : 'mercenary'
    if ((split.moved ?? 0) >= 0.5) return 'mover'
  }
  if (kept >= 0.5 && split.looped >= 0.5 * kept) return 'looper'
  // Without DEX data, sold is at most `left`.
  if (kept >= 0.8 && (split.sold ?? split.left) < 0.1) return 'strong'
  if (kept >= 0.5) return 'trimmer'
  return 'mixed'
}

export type BondBuyer = {
  address: string
  label: string | null // NetNet registry name, else cleaned Nansen label; null when Nansen has only the address
  cohort: BondCohort
  group: BondGroup
  bonded: number // NET bonded in window
  usdg: number // in window, USDG bonds and desks
  bySource: number[] // NET bonded in window, index = BondSource
  bonds: number
  epochs: number
  firstAt: number // unix s, first bond ever
  lastAt: number // unix s, last bond in window
  isNew: boolean // first bond ever is inside the window
  share: number // of window NET
  held: number | null // NET now, all forms
  expected: number // all-time, index-adjusted
  paid: number // all-time USDG for the bonds in `expected`
  keptRatio: number | null // held / expected
  position: Position | null // null without a holdings read for this wallet
  split: Split | null
  /** All-time realized USD on the DEX: sell proceeds minus the bond cost of the NET sold. Null without DEX data. */
  pnl: number | null
  dexSold: number | null // NET sold on the DEX in the window; null without DEX data
  dexSoldUsd: number | null
  dexBought: number | null // NET bought on the DEX in the window; null when the wallet sold none (Nansen lists sellers only)
  /** All time, share of expected NET: DEX sells minus DEX buys, floored at 0, capped at `split.left`. Null without DEX data. */
  netSold: number | null
  tags: string[]
}

type BuyerOptions = {
  window: BondWindow
  now: number // unix s
  cohortOf: (address: string) => BondCohort
  borrowers?: Set<string>
  sellers?: Set<string>
  extraLabels?: Map<string, string>
}

const WINDOW_NAME: Record<BondWindow, string> = { '24h': '24h', '7d': '7d', '14d': '14d', '30d': '30d', all: 'since launch' }

/** Wallets that bonded inside the window, largest NET first. */
export function bondBuyers(feed: BondFeed, { window, now, cohortOf, borrowers, sellers, extraLabels }: BuyerOptions): BondBuyer[] {
  const since = windowSince(window, now, feed.startTime)
  return buyersIn(feed, walletStats(feed, since, Infinity), { window, now, cohortOf, borrowers, sellers, extraLabels })
}

/** Each bond buyer's group, keyed by address. Groups use all-time behavior, so one map serves every window. */
export function walletGroups(feed: BondFeed, now: number): Map<string, BondGroup> {
  const buyers = bondBuyers(feed, { window: 'all', now, cohortOf: () => 'unread' })
  return new Map(buyers.map((buyer) => [buyer.address, buyer.group]))
}

function buyersIn(feed: BondFeed, stats: WalletStat[], { window, now, cohortOf, borrowers, sellers, extraLabels }: BuyerOptions): BondBuyer[] {
  const { firstAt } = derived(feed)
  const since = windowSince(window, now, feed.startTime)
  const total = stats.reduce((sum, stat) => sum + stat.net, 0)
  const dex = feed.dex?.windows[window]?.rows ?? null
  const soldAll = feed.dex?.windows.all?.rows ?? null
  const out: BondBuyer[] = []
  stats.forEach((stat, id) => {
    if (!stat.bonds) return
    const address = feed.wallets[id]
    const position = positionOf(feed, address)
    const held = position ? sizeOf(position) : null
    const allTime = soldAll ? (soldAll[address] ?? [0, 0, 0, 0]) : null
    const split = position ? outcomeSplit(position, stat.expected, allTime ? allTime[0] : null) : null
    const netSold = split && allTime ? Math.min(split.left, Math.max(0, allTime[0] - allTime[2]) / stat.expected) : null
    const pnl = allTime && stat.expected > 0 ? allTime[1] - stat.paid * Math.min(1, allTime[0] / stat.expected) : null
    const trades = dex ? (dex[address] ?? [0, 0, 0, 0]) : null
    const tags: string[] = []
    if (borrowers?.has(address)) tags.push('Loopback borrower')
    // The window's DEX sells when read; else Nansen's 7d top sellers.
    if (trades ? trades[0] > 0 : sellers?.has(address)) tags.push(`Sold on DEX ${trades ? WINDOW_NAME[window] : '7d'}`)
    out.push({
      address,
      label: cleanLabel(labelOf(address, feed, extraLabels)),
      cohort: cohortOf(address),
      group: bondGroup(split, {
        protocol: protocolLabel(address) !== null,
        recent: now - firstAt[id] < NEW_SECONDS,
        epochs: stat.epochsEver.size,
        loss: pnl === null ? null : pnl < 0,
      }),
      bonded: stat.net,
      usdg: stat.usdg,
      bySource: stat.bySource,
      bonds: stat.bonds,
      epochs: stat.epochs.size,
      firstAt: firstAt[id],
      lastAt: stat.lastAt,
      isNew: firstAt[id] >= since,
      share: total > 0 ? stat.net / total : 0,
      held,
      expected: stat.expected,
      paid: stat.paid,
      keptRatio: held !== null && stat.expected > 0 ? held / stat.expected : null,
      position,
      split,
      pnl,
      dexSold: trades?.[0] ?? null,
      dexSoldUsd: trades?.[1] ?? null,
      // The DEX read lists sellers only, so a wallet that only bought has no row: unknown, not 0.
      dexBought: dex?.[address]?.[2] ?? null,
      netSold,
      tags,
    })
  })
  return out.sort((a, b) => b.bonded - a.bonded)
}

const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

type Bucket = { wallets: number; share: number } // share of expected NET

/**
 * What the window's buyers did with the NET, in NET. Each wallet's split is weighted by its window
 * NET, so all parts but `sold` and `moved` add up to totals.net. `sold` + `moved` = `left`; both are
 * null without DEX data. `unknown` = wallets without a holdings read.
 */
export type BondOutcome = Position & { left: number; sold: number | null; moved: number | null; unknown: number }

/**
 * One buyer group in the window. `sold` and `held` are shares of the group's bonded NET that has a
 * holdings read (`sold` null without DEX data). `pnl` is the all-time realized USD of the group's wallets.
 */
export type GroupRow = { wallets: number; net: number; share: number; avgPrice: number | null; sold: number | null; held: number | null; pnl: number | null }

export type BondSummary = {
  window: BondWindow
  since: number
  now: number
  allTime: boolean
  days: number
  totals: { bonds: number; usdg: number; net: number; wallets: number; newWallets: number }
  cohorts: Record<BondCohort, { wallets: number; net: number; share: number; usdg: number; avgPrice: number | null }>
  groups: Record<BondGroup, GroupRow>
  /** Bonds in the window per source, index = BondSource. */
  sources: Array<{ bonds: number; net: number; usdg: number }>
  minted: number // NET from the depository, minted at bond time
  fromInventory: number // NET the desks sold from deposited stock
  /**
   * NET the manager sleeve bought on the DEX (and the USDG it paid), NET deposited into the desks (and
   * the part minted in the deposit transaction), and NET the v3 desk sold, all in the window.
   */
  buyback: { buys: number; net: number; usd: number; deposited: number; depositedMinted: number; v3Sold: number }
  outcome: BondOutcome
  top10Share: number
  epochsInWindow: number // completed epochs from the one that holds `since`
  soldOutCount: number
  medianSoldOutAfter: number | null // seconds, sold-out epochs only
  medianFirstMinuteShare: number | null // epochs with sales only
  /** All-time buyers with a holdings read, weighted by expected NET. Null before the first read. */
  retention: { heldShare: number; kept: Bucket; part: Bucket; gone: Bucket } | null
  loopbackOverlap: { wallets: number; net: number }
  sellerOverlap: { wallets: number; net: number }
  current: { epoch: number; opensAt: number; closesAt: number; sold: number; cap: number | null; fill: number; soldOut: boolean; soldOutAfter: number | null }
  discount: number | null // 1 - bond price / TWAP
}

/** `now` is unix seconds. */
export function bondSummary(
  feed: BondFeed,
  { window, now, cohortOf, borrowers, sellers }: { window: BondWindow; now: number; cohortOf: (address: string) => BondCohort; borrowers?: Set<string>; sellers?: Set<string> },
): BondSummary {
  const { ids } = derived(feed)
  const since = windowSince(window, now, feed.startTime)
  const stats = walletStats(feed, since, now)
  const buyers = buyersIn(feed, stats, { window, now, cohortOf, borrowers, sellers })

  const totals = { bonds: 0, usdg: 0, net: 0, wallets: buyers.length, newWallets: 0 }
  const cohorts = Object.fromEntries(COHORTS.map((cohort) => [cohort, { wallets: 0, net: 0, share: 0, usdg: 0, avgPrice: null as number | null }])) as BondSummary['cohorts']
  const quoteNet = zeroCohorts()
  const loopbackOverlap = { wallets: 0, net: 0 }
  const sellerOverlap = { wallets: 0, net: 0 }
  const hasDex = Boolean(feed.dex?.windows.all)
  const outcome: BondOutcome = { vesting: 0, staked: 0, wrapped: 0, looped: 0, liquid: 0, left: 0, sold: hasDex ? 0 : null, moved: hasDex ? 0 : null, unknown: 0 }
  // Per group: [wallets, NET, USDG, quoted NET, NET with a split, held NET, sold NET, PnL]
  const acc = Object.fromEntries(GROUPS.map((group) => [group, [0, 0, 0, 0, 0, 0, 0, 0]])) as Record<BondGroup, number[]>
  for (const buyer of buyers) {
    const stat = stats[ids.get(buyer.address)!]
    totals.bonds += buyer.bonds
    totals.usdg += buyer.usdg
    totals.net += buyer.bonded
    if (buyer.isNew) totals.newWallets += 1
    const cohort = cohorts[buyer.cohort]
    cohort.wallets += 1
    cohort.net += buyer.bonded
    cohort.usdg += buyer.usdg
    quoteNet[buyer.cohort] += stat.quoteNet
    for (const [set, overlap] of [[borrowers, loopbackOverlap], [sellers, sellerOverlap]] as const) {
      if (!set?.has(buyer.address)) continue
      overlap.wallets += 1
      overlap.net += buyer.bonded
    }
    const { split, bonded } = buyer
    const group = acc[buyer.group]
    group[0] += 1
    group[1] += bonded
    group[2] += buyer.usdg
    group[3] += stat.quoteNet
    group[7] += buyer.pnl ?? 0
    if (!split) {
      outcome.unknown += bonded
      continue
    }
    group[4] += bonded
    group[5] += (1 - split.left) * bonded
    group[6] += (split.sold ?? 0) * bonded
    for (const part of [...PARTS, 'left'] as const) outcome[part] += split[part] * bonded
    if (outcome.sold !== null) outcome.sold += (split.sold ?? 0) * bonded
    if (outcome.moved !== null) outcome.moved += (split.moved ?? 0) * bonded
  }
  for (const key of COHORTS) {
    cohorts[key].share = totals.net > 0 ? cohorts[key].net / totals.net : 0
    cohorts[key].avgPrice = quoteNet[key] > 0 ? cohorts[key].usdg / quoteNet[key] : null
  }
  const groups = Object.fromEntries(
    GROUPS.map((key) => {
      const [wallets, net, usdg, quoted, known, held, sold, pnl] = acc[key]
      return [
        key,
        {
          wallets,
          net,
          share: totals.net > 0 ? net / totals.net : 0,
          avgPrice: quoted > 0 ? usdg / quoted : null,
          sold: hasDex && known > 0 ? sold / known : null,
          held: known > 0 ? held / known : null,
          pnl: hasDex && wallets > 0 ? pnl : null,
        },
      ]
    }),
  ) as Record<BondGroup, GroupRow>
  const top10Share = totals.net > 0 ? buyers.slice(0, 10).reduce((sum, buyer) => sum + buyer.bonded, 0) / totals.net : 0

  const sources = SOURCES.map(() => ({ bonds: 0, net: 0, usdg: 0 }))
  feed.bonds.t.forEach((t, i) => {
    if (t < since || t > now) return
    const source = sources[srcAt(feed, i)]
    source.bonds += 1
    source.net += feed.bonds.net[i]
    source.usdg += feed.bonds.usdg[i] ?? 0
  })
  const inWindow = (t: number) => t >= since && t <= now
  const buyback = { buys: 0, net: 0, usd: 0, deposited: 0, depositedMinted: 0, v3Sold: sources[3].net }
  for (const [t, net, kind, usd] of feed.sleeve ?? []) {
    if (kind !== 'buy' || !inWindow(t)) continue
    buyback.buys += 1
    buyback.net += net
    buyback.usd += usd
  }
  for (const [t, , net, minted] of feed.inventory ?? []) {
    if (!inWindow(t)) continue
    buyback.deposited += net
    if (minted) buyback.depositedMinted += net
  }

  const currentEpoch = epochOf(feed, now)
  const allTime = window === 'all'
  const done = epochSeries(feed, { fromEpoch: allTime ? 0 : epochOf(feed, since), toEpoch: currentEpoch - 1, cohortOf })
  const soldOut = done.filter((row) => row.soldOut)

  let retention: BondSummary['retention'] = null
  if (feed.holdings) {
    const buckets = { kept: { wallets: 0, share: 0 }, part: { wallets: 0, share: 0 }, gone: { wallets: 0, share: 0 } }
    let expected = 0
    let kept = 0
    stats.forEach((stat, id) => {
      const position = positionOf(feed, feed.wallets[id])
      if (!position || stat.expected <= 0) return
      const held = sizeOf(position)
      const ratio = held / stat.expected
      const bucket = buckets[ratio >= 0.9 ? 'kept' : ratio >= 0.1 ? 'part' : 'gone']
      bucket.wallets += 1
      bucket.share += stat.expected
      expected += stat.expected
      kept += Math.min(held, stat.expected)
    })
    for (const bucket of Object.values(buckets)) bucket.share = expected > 0 ? bucket.share / expected : 0
    retention = { heldShare: expected > 0 ? kept / expected : 0, ...buckets }
  }

  const [row] = epochSeries(feed, { fromEpoch: currentEpoch, toEpoch: currentEpoch, cohortOf })
  const sold = feed.live.epoch === currentEpoch && feed.live.epochSold !== null ? feed.live.epochSold : row.sold
  const { bondPrice, twap } = feed.live

  return {
    window,
    since,
    now,
    allTime,
    days: Math.round((now - since) / 86_400),
    totals,
    cohorts,
    groups,
    sources,
    minted: sources[0].net,
    fromInventory: sources.slice(1).reduce((sum, source) => sum + source.net, 0),
    buyback,
    outcome,
    top10Share,
    epochsInWindow: done.length,
    soldOutCount: soldOut.length,
    medianSoldOutAfter: median(soldOut.map((epoch) => epoch.soldOutAfter!)),
    medianFirstMinuteShare: median(done.filter((epoch) => epoch.sold > 0).map((epoch) => epoch.firstMinuteShare)),
    retention,
    loopbackOverlap,
    sellerOverlap,
    current: {
      epoch: currentEpoch,
      opensAt: row.opensAt,
      closesAt: row.opensAt + feed.epochSeconds,
      sold,
      cap: row.cap,
      fill: row.cap ? Math.min(1, sold / row.cap) : 0,
      soldOut: row.cap !== null && sold >= SOLD_OUT * row.cap,
      soldOutAfter: row.soldOutAfter,
    },
    discount: bondPrice && twap ? 1 - bondPrice / twap : null,
  }
}

const HEADLINE_NAME: Record<BondCohort, string> = {
  smart: 'Smart money',
  public: 'Public figures',
  hl: 'Hyperliquid traders',
  labelled: 'Other labelled wallets',
  unlabelled: 'Unlabelled wallets',
  unread: 'Wallets not read yet',
}

// Group names inside a sentence.
const GROUP_WORDS: Record<BondGroup, string> = {
  protocol: 'protocol wallets',
  new: 'new buyers',
  arbitrageur: 'arbitrageurs',
  weak: 'weak hands',
  mercenary: 'mercenaries',
  mover: 'movers',
  left: 'wallets whose NET left',
  looper: 'loopers',
  strong: 'strong hands',
  trimmer: 'trimmers',
  mixed: 'mixed wallets',
  unknown: 'wallets not read yet',
}

const percent = (share: number) => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`)
const amount = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: value < 100 ? 1 : 0 })
const windowOf = (summary: BondSummary) => (summary.allTime ? 'since launch' : summary.days === 1 ? 'in the last day' : `in the last ${summary.days} days`)
const walletCount = (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'wallet' : 'wallets'}`
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** One or two plain sentences. Data, not verdicts. Buyer groups lead once holdings are read; Nansen cohorts before that. */
export function bondHeadline(summary: BondSummary): string {
  const window = windowOf(summary)
  const parts: string[] = []
  if (summary.epochsInWindow > 0) {
    parts.push(
      summary.allTime
        ? `Depository bonds sold out in ${summary.soldOutCount} of ${summary.epochsInWindow} epochs since launch.`
        : `Depository bonds sold out in ${summary.soldOutCount} of the last ${summary.epochsInWindow} epochs.`,
    )
  }
  if (summary.totals.net <= 0) {
    parts.push(`Nobody bought bonds ${window}.`)
    return parts.join(' ')
  }
  // "Not read yet" is a gap in the data, not a buyer group. It never leads.
  const [first, second] = GROUPS.filter((group) => group !== 'unknown' && summary.groups[group].share > 0).sort((a, b) => summary.groups[b].share - summary.groups[a].share)
  if (first) {
    const next = second ? `, ${GROUP_WORDS[second]} ${percent(summary.groups[second].share)}` : ''
    parts.push(`${capital(GROUP_WORDS[first])} bought ${percent(summary.groups[first].share)} of bonded NET ${window}${next}.`)
    return parts.join(' ')
  }
  const lead = COHORTS.filter((cohort) => cohort !== 'unread').reduce((best, cohort) =>
    summary.cohorts[cohort].share > summary.cohorts[best].share ? cohort : best,
  )
  const share = summary.cohorts[lead].share
  if (share <= 0) {
    parts.push(`${capital(walletCount(summary.totals.wallets))} bought ${amount(summary.totals.net)} NET in bonds ${window}.`)
  } else if (lead === 'smart') {
    parts.push(`Smart money bought ${percent(share)} of bonded NET ${window}.`)
  } else {
    parts.push(`${HEADLINE_NAME[lead]} bought ${percent(share)} of bonded NET ${window}; smart money bought ${percent(summary.cohorts.smart.share)}.`)
  }
  return parts.join(' ')
}

/**
 * How the window's buyers behave, one sentence each. Only lines that hold for this data.
 * `launch` is the all-time summary; `buyers` is bondBuyers for the same window.
 */
export function bondDynamics(summary: BondSummary, launch: BondSummary, buyers: BondBuyer[]): string[] {
  const { totals, cohorts, retention, loopbackOverlap, sellerOverlap, buyback } = summary
  if (totals.net <= 0) return []
  const window = windowOf(summary)
  const lines: string[] = []
  if (totals.wallets > 10) lines.push(`The top 10 wallets bought ${percent(summary.top10Share)} of bonded NET ${window}.`)
  if (!summary.allTime && totals.newWallets > 0) {
    const fresh = buyers.reduce((sum, buyer) => sum + (buyer.isNew ? buyer.bonded : 0), 0)
    lines.push(`${totals.newWallets.toLocaleString('en-US')} of ${walletCount(totals.wallets)} bought their first bond ${window}. They bought ${percent(fresh / totals.net)} of bonded NET.`)
  }
  // The cohort whose share moved most against all time, when it moved 3 points or more. "Not read yet" is a data gap, not a group.
  const moved = (cohort: BondCohort) => Math.abs(cohorts[cohort].share - launch.cohorts[cohort].share)
  const shift = COHORTS.filter((cohort) => cohort !== 'unread' && moved(cohort) >= 0.03).sort((a, b) => moved(b) - moved(a))[0]
  if (!summary.allTime && shift) {
    lines.push(`${HEADLINE_NAME[shift]} bought ${percent(cohorts[shift].share)} of bonded NET ${window}, against ${percent(launch.cohorts[shift].share)} since launch.`)
  }
  const outcome = bondOutcomeLine(summary)
  if (outcome) lines.push(outcome)
  if (summary.fromInventory > 0) {
    const v3 = buyback.v3Sold > 0 ? ` The v3 desk sold ${amount(buyback.v3Sold)} NET from the manager sleeve's stock.` : ''
    lines.push(`Bond desks sold ${amount(summary.fromInventory)} of ${amount(totals.net)} bonded NET ${window}.${v3}`)
  }
  if (buyback.net > 0) lines.push(`The manager sleeve bought ${amount(buyback.net)} NET on the DEX ${window} for ${amount(buyback.usd)} USDG.`)
  if (retention) {
    lines.push(`All-time buyers still hold ${percent(retention.heldShare)} of their bonded NET, with staking growth counted. ${walletCount(retention.gone.wallets)} hold under 10%.`)
  }
  if (loopbackOverlap.wallets > 0) {
    lines.push(`${walletCount(loopbackOverlap.wallets)} that bonded ${window} also ${loopbackOverlap.wallets === 1 ? 'borrows' : 'borrow'} against wsNET in Loopback.`)
  }
  if (sellerOverlap.wallets > 0) {
    lines.push(`${walletCount(sellerOverlap.wallets)} that bonded ${window} ${sellerOverlap.wallets === 1 ? 'is' : 'are'} in Nansen's top 100 DEX sellers of NET over the last 7 days.`)
  }
  const race = summary.medianFirstMinuteShare
  if (race !== null && race >= 0.25) lines.push(`The median epoch ${window} sold ${percent(race)} of its NET in the first minute.`)
  return lines
}

// [verb, words after the share]. Without DEX data, "moved" covers all NET that left the wallet.
const OUTCOME_WORDS = {
  sold: ['sold', ' on the DEX'],
  moved: ['moved', ' out of their wallets'],
  staked: ['staked', ''],
  looped: ['looped', ' through Loopback'],
  vesting: ['have', ' still vesting'],
  liquid: ['hold', ' as liquid NET'],
} as const

/** The two largest things the window's buyers did with their NET, as one sentence. Null before a holdings read. */
export function bondOutcomeLine(summary: BondSummary): string | null {
  const { outcome, totals } = summary
  if (totals.net <= 0) return null
  const parts: Array<[keyof typeof OUTCOME_WORDS, number]> = [
    ['sold', outcome.sold ?? 0],
    ['moved', outcome.moved ?? outcome.left],
    ['staked', outcome.staked + outcome.wrapped],
    ['looped', outcome.looped],
    ['vesting', outcome.vesting],
    ['liquid', outcome.liquid],
  ]
  const [first, second] = parts.filter(([, net]) => net > 0).sort((a, b) => b[1] - a[1])
  if (!first) return null
  const say = ([key, net]: [keyof typeof OUTCOME_WORDS, number], of: string) => `${OUTCOME_WORDS[key][0]} ${percent(net / totals.net)}${of}${OUTCOME_WORDS[key][1]}`
  const who = summary.allTime ? 'Buyers since launch' : `Buyers from the last ${summary.days === 1 ? 'day' : `${summary.days} days`}`
  return `${who} ${say(first, ' of their bonded NET')}${second ? ` and ${say(second, '')}` : ''}.`
}

// A leading = + - @ makes a spreadsheet run the cell as a formula. Labels come from a third party.
const csvCell = (value: string | number | null): string => {
  if (value === null) return ''
  const text = typeof value === 'number' ? String(value) : /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const fixed = (value: number | null | undefined, dp: number) => (value === null || value === undefined ? null : Number(value.toFixed(dp)))
const isoTime = (t: number) => new Date(t * 1000).toISOString()
const CSV_PARTS = [...PARTS, 'sold', 'moved'] as const

/**
 * The buyer list as CSV. Outcome columns are % of expected NET, all time; `sold_pct` counts gross DEX
 * sells and `net_sold_pct` sells minus buys. DEX columns with a window suffix cover the window.
 */
export function buyersCsv(rows: BondBuyer[], window: BondWindow): string {
  const header = [
    'address',
    'label',
    'cohort',
    `bonded_net_${window}`,
    `bonded_usdg_${window}`,
    `bonds_${window}`,
    `epochs_${window}`,
    'first_bond',
    `last_bond_${window}`,
    'group',
    `sources_${window}`,
    ...CSV_PARTS.map((part) => `${part}_pct`),
    'net_sold_pct',
    `dex_sold_net_${window}`,
    `dex_sold_usd_${window}`,
    `dex_bought_net_${window}`,
    `dex_net_sold_net_${window}`,
  ]
  const lines = rows.map((row) =>
    [
      row.address,
      row.label,
      COHORT_LABEL[row.cohort],
      fixed(row.bonded, 6),
      fixed(row.usdg, 2),
      row.bonds,
      row.epochs,
      isoTime(row.firstAt),
      isoTime(row.lastAt),
      GROUP_INFO[row.group].name,
      SOURCES.filter((src) => row.bySource[src] > 0)
        .map((src) => SOURCE_LABEL[src])
        .join('; '),
      ...CSV_PARTS.map((part) => {
        const share = row.split?.[part] ?? null
        return fixed(share === null ? null : share * 100, 2)
      }),
      fixed(row.netSold === null ? null : row.netSold * 100, 2),
      fixed(row.dexSold, 6),
      fixed(row.dexSoldUsd, 2),
      fixed(row.dexBought, 6),
      fixed(row.dexSold === null || row.dexBought === null ? null : Math.max(0, row.dexSold - row.dexBought), 6),
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}
