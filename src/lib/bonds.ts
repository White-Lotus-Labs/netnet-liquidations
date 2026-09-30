import { cleanLabel, labelClass } from './flows.ts'

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
  bonds: { t: number[]; w: number[]; usdg: Array<number | null>; net: number[]; price: number[]; block: number[] }
  epochCaps: Record<string, number> // epoch → cap NET (supply before the epoch's first bond × 0.0025); includes the current epoch from live supply
  index: number | null // sNET index now (NET per wsNET)
  indexPoints: Array<[number, number]> // [unix s, index] from LogRebase, ascending
  labels: Record<string, string> // lowercase address → raw Nansen label
  labelsReadThrough: string | null // ISO day
  holdings: Record<string, number> | null // lowercase address → held NET (incl. staked, wrapped×index, unvested)
  holdingsAt: number | null // ms
  live: { bondPrice: number | null; twap: number | null; epoch: number | null; epochSold: number | null; supply: number | null }
  errors: string[]
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

type Derived = { ids: Map<string, number>; firstAt: number[]; readThrough: number; hasLabels: boolean }
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
      readThrough: feed.labelsReadThrough ? Date.parse(feed.labelsReadThrough) / 1000 : -Infinity,
      hasLabels: Object.keys(feed.labels).length > 0,
    }
    derivedCache.set(feed, value)
  }
  return value
}

const epochOf = (feed: BondFeed, t: number) => Math.floor((t - feed.startTime) / feed.epochSeconds)

/** A real label beats an address-only one. The feed's own label wins over the snapshot's. */
function labelOf(address: string, feed: BondFeed, extraLabels?: Map<string, string>): string | null {
  const own = feed.labels[address]
  if (cleanLabel(own)) return own
  return extraLabels?.get(address) ?? own ?? null
}

export function bondCohort(address: string, feed: BondFeed, extraLabels?: Map<string, string>): BondCohort {
  const key = address.toLowerCase()
  const label = labelOf(key, feed, extraLabels)
  if (label === null) {
    // No row from Nansen. It is only "unlabelled" if Nansen had the chance to see this wallet redeem.
    const { ids, firstAt, readThrough, hasLabels } = derived(feed)
    const id = ids.get(key)
    const first = id === undefined ? Infinity : firstAt[id]
    return !hasLabels || first > readThrough ? 'unread' : 'unlabelled'
  }
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

export type EpochRow = {
  epoch: number
  opensAt: number // unix s
  cap: number | null // NET; empty epochs carry the last known cap
  sold: number // NET, from bond logs
  fill: number // 0..1
  soldOut: boolean
  soldOutAfter: number | null // seconds from open to the bond that filled 99.5% of the cap
  firstMinuteShare: number // share of sold NET bought within 60 s of open
  wallets: number
  newWallets: number // wallets whose first bond ever is in this epoch
  usdg: number
  avgPrice: number | null // USDG per NET, market 0 only
  byCohort: Record<BondCohort, number> // NET
}

/** One row per epoch from fromEpoch to toEpoch, empty epochs included. */
export function epochSeries(
  feed: BondFeed,
  { fromEpoch, toEpoch, cohortOf }: { fromEpoch: number; toEpoch: number; cohortOf: (address: string) => BondCohort },
): EpochRow[] {
  const { firstAt } = derived(feed)
  const cohorts = feed.wallets.map(cohortOf)
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
    rows.push({ epoch, opensAt, cap, sold: 0, fill: 0, soldOut: false, soldOutAfter: null, firstMinuteShare: 0, wallets: 0, newWallets: 0, usdg: 0, avgPrice: null, byCohort: zeroCohorts() })
    extra.push({ wallets: new Set(), fresh: new Set(), firstMinute: 0, quoteNet: 0 })
  }

  const { t, w, net, usdg } = feed.bonds
  for (let i = 0; i < t.length; i++) {
    const epoch = epochOf(feed, t[i])
    if (epoch < fromEpoch || epoch > toEpoch) continue
    const row = rows[epoch - fromEpoch]
    const more = extra[epoch - fromEpoch]
    row.sold += net[i]
    if (row.soldOutAfter === null && row.cap !== null && row.sold >= SOLD_OUT * row.cap) row.soldOutAfter = t[i] - row.opensAt
    if (t[i] - row.opensAt <= 60) more.firstMinute += net[i]
    more.wallets.add(w[i])
    if (epochOf(feed, firstAt[w[i]]) === epoch) more.fresh.add(w[i])
    const quote = usdg[i]
    if (quote !== null) {
      row.usdg += quote
      more.quoteNet += net[i]
    }
    row.byCohort[cohorts[w[i]]] += net[i]
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

type WalletStat = { net: number; usdg: number; quoteNet: number; bonds: number; epochs: Set<number>; lastAt: number; expected: number }

/**
 * Window totals per wallet id for bonds with since ≤ t ≤ until, plus the all-time
 * `expected`: NET the wallet would hold now had it staked each payout at once
 * (payout × index now / index at the bond). Bonds after the holdings read are left out of it.
 */
function walletStats(feed: BondFeed, since: number, until: number): WalletStat[] {
  const stats = feed.wallets.map(() => ({ net: 0, usdg: 0, quoteNet: 0, bonds: 0, epochs: new Set<number>(), lastAt: 0, expected: 0 }))
  const points = feed.indexPoints
  const indexNow = feed.index ?? points.at(-1)?.[1] ?? null
  const cutoff = feed.holdingsAt === null ? Infinity : feed.holdingsAt / 1000
  const { t, w, net, usdg } = feed.bonds
  let p = 0
  for (let i = 0; i < t.length; i++) {
    const stat = stats[w[i]]
    if (t[i] <= cutoff) {
      while (p + 1 < points.length && points[p + 1][0] <= t[i]) p++
      const indexThen = points[p]?.[1]
      stat.expected += indexNow && indexThen ? (net[i] * indexNow) / indexThen : net[i]
    }
    if (t[i] < since || t[i] > until) continue
    stat.net += net[i]
    stat.bonds += 1
    stat.epochs.add(epochOf(feed, t[i]))
    stat.lastAt = Math.max(stat.lastAt, t[i])
    const quote = usdg[i]
    if (quote !== null) {
      stat.usdg += quote
      stat.quoteNet += net[i]
    }
  }
  return stats
}

export type BondBuyer = {
  address: string
  label: string | null // cleaned; null when Nansen has only the address
  cohort: BondCohort
  net: number // in window
  usdg: number // in window, market 0
  bonds: number
  epochs: number
  firstAt: number // unix s, first bond ever
  lastAt: number // unix s, last bond in window
  isNew: boolean // first bond ever is inside the window
  share: number // of window NET
  held: number | null // NET now, all forms
  expected: number // all-time, index-adjusted
  keptRatio: number | null // held / expected
  tags: string[]
}

type BuyerOptions = {
  since: number // unix s
  cohortOf: (address: string) => BondCohort
  borrowers?: Set<string>
  sellers?: Set<string>
  extraLabels?: Map<string, string>
}

/** Wallets that bonded at or after `since`, largest NET first. */
export function bondBuyers(feed: BondFeed, { since, cohortOf, borrowers, sellers, extraLabels }: BuyerOptions): BondBuyer[] {
  return buyersIn(feed, walletStats(feed, since, Infinity), since, { cohortOf, borrowers, sellers, extraLabels })
}

function buyersIn(feed: BondFeed, stats: WalletStat[], since: number, { cohortOf, borrowers, sellers, extraLabels }: Omit<BuyerOptions, 'since'>): BondBuyer[] {
  const { firstAt } = derived(feed)
  const total = stats.reduce((sum, stat) => sum + stat.net, 0)
  const out: BondBuyer[] = []
  stats.forEach((stat, id) => {
    if (!stat.bonds) return
    const address = feed.wallets[id]
    const held = feed.holdings ? (feed.holdings[address] ?? null) : null
    const tags: string[] = []
    if (borrowers?.has(address)) tags.push('Loopback borrower')
    if (sellers?.has(address)) tags.push('Sold on DEX 7d')
    out.push({
      address,
      label: cleanLabel(labelOf(address, feed, extraLabels)),
      cohort: cohortOf(address),
      net: stat.net,
      usdg: stat.usdg,
      bonds: stat.bonds,
      epochs: stat.epochs.size,
      firstAt: firstAt[id],
      lastAt: stat.lastAt,
      isNew: firstAt[id] >= since,
      share: total > 0 ? stat.net / total : 0,
      held,
      expected: stat.expected,
      keptRatio: held !== null && stat.expected > 0 ? held / stat.expected : null,
      tags,
    })
  })
  return out.sort((a, b) => b.net - a.net)
}

const median = (values: number[]): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

type Bucket = { wallets: number; share: number } // share of expected NET

export type BondSummary = {
  since: number
  now: number
  allTime: boolean
  days: number
  totals: { bonds: number; usdg: number; net: number; wallets: number; newWallets: number }
  cohorts: Record<BondCohort, { wallets: number; net: number; share: number; usdg: number; avgPrice: number | null }>
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

/** `since` and `now` are unix seconds. Pass since = 0 for all time. */
export function bondSummary(
  feed: BondFeed,
  { since, now, cohortOf, borrowers, sellers }: { since: number; now: number; cohortOf: (address: string) => BondCohort; borrowers?: Set<string>; sellers?: Set<string> },
): BondSummary {
  const { ids } = derived(feed)
  const stats = walletStats(feed, since, now)
  const buyers = buyersIn(feed, stats, since, { cohortOf, borrowers, sellers })

  const totals = { bonds: 0, usdg: 0, net: 0, wallets: buyers.length, newWallets: 0 }
  const cohorts = Object.fromEntries(COHORTS.map((cohort) => [cohort, { wallets: 0, net: 0, share: 0, usdg: 0, avgPrice: null as number | null }])) as BondSummary['cohorts']
  const quoteNet = zeroCohorts()
  const loopbackOverlap = { wallets: 0, net: 0 }
  const sellerOverlap = { wallets: 0, net: 0 }
  for (const buyer of buyers) {
    const stat = stats[ids.get(buyer.address)!]
    totals.bonds += buyer.bonds
    totals.usdg += buyer.usdg
    totals.net += buyer.net
    if (buyer.isNew) totals.newWallets += 1
    const cohort = cohorts[buyer.cohort]
    cohort.wallets += 1
    cohort.net += buyer.net
    cohort.usdg += buyer.usdg
    quoteNet[buyer.cohort] += stat.quoteNet
    for (const [set, overlap] of [[borrowers, loopbackOverlap], [sellers, sellerOverlap]] as const) {
      if (!set?.has(buyer.address)) continue
      overlap.wallets += 1
      overlap.net += buyer.net
    }
  }
  for (const key of COHORTS) {
    cohorts[key].share = totals.net > 0 ? cohorts[key].net / totals.net : 0
    cohorts[key].avgPrice = quoteNet[key] > 0 ? cohorts[key].usdg / quoteNet[key] : null
  }
  const top10Share = totals.net > 0 ? buyers.slice(0, 10).reduce((sum, buyer) => sum + buyer.net, 0) / totals.net : 0

  const currentEpoch = epochOf(feed, now)
  const allTime = since <= feed.startTime
  const done = epochSeries(feed, { fromEpoch: allTime ? 0 : epochOf(feed, since), toEpoch: currentEpoch - 1, cohortOf })
  const soldOut = done.filter((row) => row.soldOut)

  let retention: BondSummary['retention'] = null
  if (feed.holdings) {
    const buckets = { kept: { wallets: 0, share: 0 }, part: { wallets: 0, share: 0 }, gone: { wallets: 0, share: 0 } }
    let expected = 0
    let kept = 0
    stats.forEach((stat, id) => {
      const held = feed.holdings![feed.wallets[id]]
      if (held === undefined || stat.expected <= 0) return
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
    since,
    now,
    allTime,
    days: Math.round((now - since) / 86_400),
    totals,
    cohorts,
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

const percent = (share: number) => (share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`)
const amount = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: value < 100 ? 1 : 0 })
const windowOf = (summary: BondSummary) => (summary.allTime ? 'since launch' : summary.days === 1 ? 'in the last day' : `in the last ${summary.days} days`)
const walletCount = (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'wallet' : 'wallets'}`

/** One or two plain sentences. Data, not verdicts. */
export function bondHeadline(summary: BondSummary): string {
  const window = windowOf(summary)
  const parts: string[] = []
  if (summary.epochsInWindow > 0) {
    parts.push(
      summary.allTime
        ? `Bonds sold out in ${summary.soldOutCount} of ${summary.epochsInWindow} epochs since launch.`
        : `Bonds sold out in ${summary.soldOutCount} of the last ${summary.epochsInWindow} epochs.`,
    )
  }
  if (summary.totals.net <= 0) {
    parts.push(`Nobody bought bonds ${window}.`)
    return parts.join(' ')
  }
  // "Not read yet" is a gap in the data, not a buyer group. It never leads.
  const lead = COHORTS.filter((cohort) => cohort !== 'unread').reduce((best, cohort) =>
    summary.cohorts[cohort].share > summary.cohorts[best].share ? cohort : best,
  )
  const share = summary.cohorts[lead].share
  if (share <= 0) {
    parts.push(`${summary.totals.wallets} wallets bought ${amount(summary.totals.net)} NET in bonds ${window}.`)
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
  const { totals, cohorts, retention, loopbackOverlap, sellerOverlap } = summary
  if (totals.net <= 0) return []
  const window = windowOf(summary)
  const lines: string[] = []
  if (totals.wallets > 10) lines.push(`The top 10 wallets bought ${percent(summary.top10Share)} of bonded NET ${window}.`)
  if (!summary.allTime && totals.newWallets > 0) {
    const fresh = buyers.reduce((sum, buyer) => sum + (buyer.isNew ? buyer.net : 0), 0)
    lines.push(`${totals.newWallets.toLocaleString('en-US')} of ${walletCount(totals.wallets)} bought their first bond ${window}. They bought ${percent(fresh / totals.net)} of bonded NET.`)
  }
  // The cohort whose share moved most against all time, when it moved 3 points or more. "Not read yet" is a data gap, not a group.
  const moved = (cohort: BondCohort) => Math.abs(cohorts[cohort].share - launch.cohorts[cohort].share)
  const shift = COHORTS.filter((cohort) => cohort !== 'unread' && moved(cohort) >= 0.03).sort((a, b) => moved(b) - moved(a))[0]
  if (!summary.allTime && shift) {
    lines.push(`${HEADLINE_NAME[shift]} bought ${percent(cohorts[shift].share)} of bonded NET ${window}, against ${percent(launch.cohorts[shift].share)} since launch.`)
  }
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
