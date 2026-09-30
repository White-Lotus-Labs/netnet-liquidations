import { describe, expect, it } from 'vitest'
import { bondBuyers, bondCohort, bondDynamics, bondHeadline, bondSummary, epochSeries, type BondFeed } from './bonds.ts'

const S = 1_784_306_012 // epoch 0 opens 2026-07-17T16:33:32Z
const E = 28_800

// [t, wallet id, usdg (null = market 1), net]
const rows: Array<[number, number, number | null, number]> = [
  [S + 30, 0, 400, 4], // epoch 0, first minute
  [S + 50, 1, 200, 2], // first minute
  [S + 3600, 2, 420, 4], // fills 99.5% of the cap
  [S + 4000, 4, 2.1, 0.02],
  [S + E, 0, 110, 1], // exactly on the boundary: epoch 1
  [S + E + 100, 3, 110, 1],
  [S + E + 200, 3, null, 0.5], // market 1 (LP token)
  // epoch 2 is empty
  [S + 3 * E + 10, 5, 330, 3],
  ...[6, 7, 8, 9, 10, 11].map((w, k): [number, number, number, number] => [S + 3 * E + 100 + k, w, 55, 0.5]),
]

const feed: BondFeed = {
  fetchedAt: (S + 3 * E + 7200) * 1000,
  status: 'ready',
  progress: null,
  headBlock: 100,
  headTime: S + 3 * E + 7200,
  startTime: S,
  epochSeconds: E,
  capBps: 25,
  wallets: ['0xa', '0xb', '0xc', '0xd', '0xe', '0xf', '0x1', '0x2', '0x3', '0x4', '0x5', '0x6'],
  bonds: {
    t: rows.map((row) => row[0]),
    w: rows.map((row) => row[1]),
    usdg: rows.map((row) => row[2]),
    net: rows.map((row) => row[3]),
    price: rows.map(() => 100),
    block: rows.map((_, i) => i + 1),
  },
  epochCaps: { 0: 10, 1: 10, 3: 12 },
  index: 1.1,
  indexPoints: [
    [S, 1],
    [S + 2 * E, 1.1],
  ],
  labels: {
    '0xa': '🤓 Smart Trader [0xa]',
    '0xb': '👤 Mogfather',
    '0xc': 'HL Perps Swing Trader [0xc]',
    '0xd': '[0xd]',
    '0x1': 'Binance Deposit',
  },
  labelsReadThrough: '2026-07-18', // 00:00Z, inside epoch 0
  holdings: { '0xa': 5.5, '0xb': 1.1, '0xc': 0.2, '0xd': 0, '0xe': 0.022, '0xf': 3 },
  holdingsAt: (S + 3 * E + 3600) * 1000,
  live: { bondPrice: 100, twap: 110, epoch: 3, epochSold: 6.5, supply: 4800 },
  errors: [],
}

const cohortOf = (address: string) => bondCohort(address, feed)
const now = S + 3 * E + 7200

describe('bond cohorts', () => {
  it('maps Nansen labels and tells a missing read from an address-only label', () => {
    expect(['0xa', '0xB', '0xc', '0x1', '0xd'].map(cohortOf)).toEqual(['smart', 'public', 'hl', 'labelled', 'unlabelled'])
    expect(cohortOf('0xe')).toBe('unlabelled') // no label, first bond before the read-through day
    expect(cohortOf('0xf')).toBe('unread') // no label, first bond after it
    expect(bondCohort('0xa', { ...feed, labels: {}, labelsReadThrough: null })).toBe('unread')
    expect(bondCohort('0xE', feed, new Map([['0xe', '🤓 Fund X']]))).toBe('smart')
  })
})

describe('epoch series', () => {
  const series = epochSeries(feed, { fromEpoch: 0, toEpoch: 3, cohortOf })

  it('detects the sell-out and the first-minute share', () => {
    expect(series[0]).toMatchObject({ epoch: 0, cap: 10, soldOut: true, soldOutAfter: 3600, fill: 1, wallets: 4, newWallets: 4 })
    expect(series[0].sold).toBeCloseTo(10.02)
    expect(series[0].firstMinuteShare).toBeCloseTo(6 / 10.02)
    expect(series[0].byCohort).toMatchObject({ smart: 4, public: 2, hl: 4, unlabelled: 0.02 })
  })

  it('puts t = startTime + epoch length in the next epoch and skips market 1 in USDG', () => {
    expect(series[1]).toMatchObject({ opensAt: S + E, sold: 2.5, soldOut: false, soldOutAfter: null, wallets: 2, newWallets: 1, usdg: 220, avgPrice: 110 })
    expect(series[1].fill).toBeCloseTo(0.25)
    expect(series[1].firstMinuteShare).toBeCloseTo(0.4)
  })

  it('keeps empty epochs and carries the last cap', () => {
    expect(series[2]).toMatchObject({ epoch: 2, cap: 10, sold: 0, fill: 0, wallets: 0, avgPrice: null })
    expect(series[3]).toMatchObject({ cap: 12, sold: 6, newWallets: 7 })
    expect(series[3].byCohort).toMatchObject({ unread: 5.5, labelled: 0.5 })
  })
})

describe('bond buyers', () => {
  it('adjusts expected NET for the index step and tags overlaps', () => {
    const buyers = bondBuyers(feed, { since: 0, cohortOf, borrowers: new Set(['0xc']), sellers: new Set(['0xb']) })
    const by = Object.fromEntries(buyers.map((buyer) => [buyer.address, buyer]))
    expect(buyers[0].address).toBe('0xa')
    expect(by['0xa'].expected).toBeCloseTo(5.5) // both bonds before the 1.0 → 1.1 step
    expect(by['0xa'].keptRatio).toBeCloseTo(1)
    expect(by['0xf'].expected).toBeCloseTo(3) // bond after the step
    expect(by['0xb'].keptRatio).toBeCloseTo(0.5)
    expect(by['0x2'].keptRatio).toBeNull() // no holdings row
    expect(by['0xc'].tags).toEqual(['Loopback borrower'])
    expect(by['0xb'].tags).toEqual(['Sold on DEX 7d'])
    expect(by['0xa'].label).toBe('🤓 Smart Trader')
    expect(by['0xd'].label).toBeNull()
  })

  it('splits new and returning wallets inside a window', () => {
    const buyers = bondBuyers(feed, { since: S + E, cohortOf })
    const by = Object.fromEntries(buyers.map((buyer) => [buyer.address, buyer]))
    expect(buyers).toHaveLength(9)
    expect(by['0xa']).toMatchObject({ isNew: false, net: 1, firstAt: S + 30 })
    expect(by['0xd']).toMatchObject({ isNew: true, net: 1.5, bonds: 2, usdg: 110 })
  })
})

describe('bond summary', () => {
  const summary = bondSummary(feed, { since: 0, now, cohortOf, borrowers: new Set(['0xc']) })

  it('totals the window and the concentration', () => {
    expect(summary.totals).toMatchObject({ bonds: 14, wallets: 12, newWallets: 12 })
    expect(summary.totals.net).toBeCloseTo(18.52)
    expect(summary.totals.usdg).toBeCloseTo(1902.1)
    expect(summary.top10Share).toBeCloseTo(18 / 18.52)
    expect(summary.cohorts.smart).toMatchObject({ wallets: 1, net: 5, avgPrice: 102 })
    expect(summary.cohorts.unread.net).toBeCloseTo(5.5)
    expect(summary.loopbackOverlap).toEqual({ wallets: 1, net: 4 })
  })

  it('counts completed epochs only', () => {
    expect(summary).toMatchObject({ epochsInWindow: 3, soldOutCount: 1, medianSoldOutAfter: 3600 })
    expect(summary.medianFirstMinuteShare).toBeCloseTo((6 / 10.02 + 0.4) / 2)
  })

  it('buckets retention by expected NET', () => {
    const total = 5.5 + 2.2 + 4.4 + 1.65 + 0.022 + 3
    expect(summary.retention?.kept.wallets).toBe(3)
    expect(summary.retention?.part.wallets).toBe(1)
    expect(summary.retention?.gone.wallets).toBe(2)
    expect(summary.retention?.gone.share).toBeCloseTo((4.4 + 1.65) / total)
    expect(summary.retention?.heldShare).toBeCloseTo((5.5 + 1.1 + 0.2 + 0.022 + 3) / total)
    expect(bondSummary({ ...feed, holdings: null }, { since: 0, now, cohortOf }).retention).toBeNull()
  })

  it('reads the current epoch from live state', () => {
    expect(summary.current).toMatchObject({ epoch: 3, opensAt: S + 3 * E, closesAt: S + 4 * E, sold: 6.5, cap: 12, soldOut: false })
    expect(summary.discount).toBeCloseTo(1 - 100 / 110)
  })

  it('writes a plain headline', () => {
    expect(bondHeadline(summary)).toBe('Bonds sold out in 1 of 3 epochs since launch. Smart money bought 27% of bonded NET since launch.')
    const recent = bondSummary(feed, { since: S + E, now, cohortOf })
    expect(bondHeadline(recent)).toBe(
      'Bonds sold out in 0 of the last 2 epochs. Unlabelled wallets bought 18% of bonded NET in the last day; smart money bought 12%.',
    )
  })

  it('lists only the dynamics that hold', () => {
    expect(bondDynamics(summary, summary, bondBuyers(feed, { since: 0, cohortOf }))).toEqual([
      'The top 10 wallets bought 97% of bonded NET since launch.',
      'All-time buyers still hold 59% of their bonded NET, with staking growth counted. 2 wallets hold under 10%.',
      '1 wallet that bonded since launch also borrows against wsNET in Loopback.',
      'The median epoch since launch sold 50% of its NET in the first minute.',
    ])
    const sellers = new Set(['0x1'])
    const recent = bondSummary(feed, { since: S + E, now, cohortOf, sellers })
    expect(bondDynamics(recent, summary, bondBuyers(feed, { since: S + E, cohortOf, sellers }))).toEqual([
      '8 of 9 wallets bought their first bond in the last day. They bought 88% of bonded NET.',
      'Hyperliquid traders bought 0% of bonded NET in the last day, against 22% since launch.',
      'All-time buyers still hold 59% of their bonded NET, with staking growth counted. 2 wallets hold under 10%.',
      "1 wallet that bonded in the last day is in Nansen's top 100 DEX sellers of NET over the last 7 days.",
      'The median epoch in the last day sold 40% of its NET in the first minute.',
    ])
  })
})
