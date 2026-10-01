import { describe, expect, it } from 'vitest'
import { decodeBond, etagMatches, inventoryRow, sleeveFlows } from '../../bonds.mjs'
import {
  bondBuyers,
  bondCohort,
  bondDynamics,
  bondGroup,
  bondHeadline,
  bondOutcomeLine,
  bondSummary,
  buyersCsv,
  epochSeries,
  outcomeSplit,
  sourceStarts,
  stepAt,
  walletGroups,
  windowSince,
  type BondFeed,
  type BondSource,
  type BondWindow,
  type DexRow,
  type Split,
} from './bonds.ts'

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
    src: rows.map(() => 0),
  },
  epochCaps: { 0: 10, 1: 10, 3: 12 },
  index: 1.1,
  indexPoints: [
    [S, 1],
    [S + 2 * E, 1.1],
  ],
  inventory: [],
  sleeve: [],
  price: [],
  labels: {
    '0xa': '🤓 Smart Trader [0xa]',
    '0xb': '👤 Mogfather',
    '0xc': 'HL Perps Swing Trader [0xc]',
    '0xd': '[0xd]',
    '0x1': 'Binance Deposit',
  },
  labelsReadThrough: '2026-07-18', // 00:00Z, inside epoch 0
  // [liquid, staked, wrapped, looped, vesting]
  holdings: {
    '0xa': [0, 3.5, 2, 0, 0],
    '0xb': [1.1, 0, 0, 0, 0],
    '0xc': [0.2, 0, 0, 0, 0],
    '0xd': [0, 0, 0, 0, 0],
    '0xe': [0, 0, 0, 0, 0.022],
    '0xf': [0, 0, 0, 4.5, 1.5], // twice what its bond explains
  },
  holdingsAt: (S + 3 * E + 3600) * 1000,
  dex: null,
  live: { bondPrice: 100, twap: 110, epoch: 3, epochSold: 6.5, supply: 4800 },
  errors: [],
}

const cohortOf = (address: string) => bondCohort(address, feed)
const now = S + 3 * E + 7200

// The same DEX rows in every window. 0xd sold nothing on the DEX.
const WINDOWS: BondWindow[] = ['24h', '7d', '14d', '30d', 'all']
// 0xc sold below its bond cost: 3 of 4.4 expected NET cost 420 × 3 / 4.4 = 286.36 USDG; it got 200.
const dexRows: Record<string, DexRow> = { '0xa': [1, 100, 0, 0], '0xb': [5, 500, 0, 0], '0xc': [3, 200, 1, 90] }
const dexFeed: BondFeed = {
  ...feed,
  dex: { at: 0, windows: Object.fromEntries(WINDOWS.map((window) => [window, { from: '', to: '', rows: dexRows }])) as NonNullable<BondFeed['dex']>['windows'] },
}
const byAddress = <T extends { address: string }>(rows: T[]) => Object.fromEntries(rows.map((row) => [row.address, row]))

describe('bond windows', () => {
  it('counts back from now, and "all" starts at launch', () => {
    expect(windowSince('24h', now, S)).toBe(now - 86_400)
    expect(windowSince('14d', now, S)).toBe(now - 14 * 86_400)
    expect(windowSince('all', now, S)).toBe(S)
  })
})

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
    const buyers = bondBuyers(feed, { window: 'all', now, cohortOf, borrowers: new Set(['0xc']), sellers: new Set(['0xb']) })
    const by = byAddress(buyers)
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
    const buyers = bondBuyers(feed, { window: '24h', now, cohortOf })
    const by = byAddress(buyers)
    expect(buyers).toHaveLength(9)
    expect(by['0xa']).toMatchObject({ isNew: false, bonded: 1, firstAt: S + 30 })
    expect(by['0xd']).toMatchObject({ isNew: true, bonded: 1.5, bonds: 2, usdg: 110 })
  })
})

describe('what buyers did with the NET', () => {
  const plain = byAddress(bondBuyers(feed, { window: 'all', now, cohortOf }))
  const withDex = byAddress(bondBuyers(dexFeed, { window: 'all', now, cohortOf }))

  it('reads the holdings tuple and scales a wallet that holds more than it bonded', () => {
    expect(plain['0xf'].position).toEqual({ liquid: 0, staked: 0, wrapped: 0, looped: 4.5, vesting: 1.5 })
    expect(plain['0xf'].held).toBeCloseTo(6)
    expect(plain['0xf'].expected).toBeCloseTo(3)
    expect(plain['0xf'].split?.looped).toBeCloseTo(0.75)
    expect(plain['0xf'].split?.vesting).toBeCloseTo(0.25)
    expect(plain['0xf'].split?.left).toBeCloseTo(0)
    expect(plain['0x2']).toMatchObject({ position: null, split: null, group: 'unknown' })
  })

  it('splits what left into sold and moved only with DEX data', () => {
    expect(plain['0xc'].split).toMatchObject({ sold: null, moved: null })
    expect(plain['0xc'].split?.left).toBeCloseTo(1 - 0.2 / 4.4)
    expect(plain['0xc'].dexSold).toBeNull()
    expect(withDex['0xc'].split?.sold).toBeCloseTo(3 / 4.4)
    expect(withDex['0xc'].split?.moved).toBeCloseTo(1 - 0.2 / 4.4 - 3 / 4.4)
    expect(withDex['0xc']).toMatchObject({ dexSold: 3, dexSoldUsd: 200, dexBought: 1 })
    expect(withDex['0xb'].split?.sold).toBeCloseTo(0.5) // sold 5 on the DEX, but only half of its bond left the wallet
    expect(withDex['0xd'].split).toMatchObject({ sold: 0, moved: 1 })
    expect(withDex['0xd'].dexSold).toBe(0)
  })

  it('nets DEX buys out of the sold share for the CSV', () => {
    expect(plain['0xc'].netSold).toBeNull()
    expect(withDex['0xc'].netSold).toBeCloseTo((3 - 1) / 4.4)
    expect(withDex['0xb'].netSold).toBeCloseTo(0.5) // capped at what left the wallet, like the gross share
    expect(withDex['0xd'].netSold).toBe(0)
  })

  it('groups each wallet by the first rule that matches', () => {
    const groups = (by: typeof plain) => Object.fromEntries(Object.values(by).map((buyer) => [buyer.address, buyer.group]))
    // Without DEX data, sold and moved are one group.
    expect(groups(plain)).toMatchObject({ '0xa': 'strong', '0xb': 'left', '0xc': 'left', '0xd': 'left', '0xe': 'new', '0xf': 'looper', '0x2': 'unknown' })
    expect(groups(withDex)).toMatchObject({ '0xa': 'strong', '0xb': 'mercenary', '0xc': 'weak', '0xd': 'mover', '0xe': 'new', '0xf': 'looper' })
    expect(walletGroups(dexFeed, now).get('0xc')).toBe('weak')

    const split = (over: Partial<Split>): Split => ({ vesting: 0, staked: 0, wrapped: 0, looped: 0, liquid: 0, left: 0, sold: 0, moved: 0, ...over })
    const facts = { protocol: false, recent: false, epochs: 1, loss: false }
    const flip = split({ left: 0.9, sold: 0.85, moved: 0.05 })
    expect(bondGroup(flip, { ...facts, protocol: true })).toBe('protocol') // the registry beats behavior
    expect(bondGroup(null, facts)).toBe('unknown')
    expect(bondGroup(split({ vesting: 0.6, left: 0.4, sold: 0.4 }), { ...facts, recent: true })).toBe('new')
    expect(bondGroup(flip, { ...facts, epochs: 3 })).toBe('arbitrageur')
    expect(bondGroup(flip, { ...facts, epochs: 2, loss: true })).toBe('weak')
    expect(bondGroup(flip, { ...facts, epochs: 2 })).toBe('mercenary')
    expect(bondGroup(split({ left: 0.6, sold: 0.1, moved: 0.5 }), facts)).toBe('mover')
    expect(bondGroup(split({ left: 0.6, sold: null, moved: null }), facts)).toBe('left')
    expect(bondGroup(split({ looped: 0.3, staked: 0.25, left: 0.45, sold: 0.2, moved: 0.25 }), facts)).toBe('looper')
    expect(bondGroup(split({ staked: 0.85, left: 0.15, sold: 0.05, moved: 0.1 }), facts)).toBe('strong')
    expect(bondGroup(split({ staked: 0.85, left: 0.15, sold: 0.12, moved: 0.03 }), facts)).toBe('trimmer')
    // Without DEX data, strong hands need under 10% gone in any way.
    expect(bondGroup(split({ staked: 0.85, left: 0.15, sold: null, moved: null }), facts)).toBe('trimmer')
    expect(bondGroup(split({ staked: 0.4, left: 0.6, sold: 0.3, moved: 0.3 }), facts)).toBe('mixed')
    expect(bondGroup(outcomeSplit({ liquid: 2, staked: 0, wrapped: 0, looped: 4, vesting: 0 }, 10, null), facts)).toBe('looper')
  })

  it('prices the sold part at bond cost for the loss rule and the PnL', () => {
    expect(withDex['0xa'].pnl).toBeCloseTo(100 - (510 * 1) / 5.5)
    expect(withDex['0xb'].pnl).toBeCloseTo(500 - 200) // sold more than it bonded: the whole cost counts
    expect(withDex['0xc'].pnl).toBeCloseTo(200 - (420 * 3) / 4.4)
    expect(withDex['0xd'].pnl).toBe(0)
    expect(plain['0xc'].pnl).toBeNull()
    expect(withDex['0xa'].tags).toEqual(['Sold on DEX since launch'])
  })

  it('weights the split by window NET so the parts add up to it', () => {
    for (const [source, window] of [[feed, 'all'], [feed, '24h'], [dexFeed, 'all'], [dexFeed, '24h']] as const) {
      const { outcome, totals } = bondSummary(source, { window, now, cohortOf })
      const kept = outcome.vesting + outcome.staked + outcome.wrapped + outcome.looped + outcome.liquid
      expect(kept + outcome.left + outcome.unknown).toBeCloseTo(totals.net)
      if (source === dexFeed) expect(outcome.sold! + outcome.moved!).toBeCloseTo(outcome.left)
    }
    const { outcome, groups } = bondSummary(dexFeed, { window: 'all', now, cohortOf })
    expect(outcome.unknown).toBeCloseTo(3) // six wallets without a holdings row
    expect(outcome.sold).toBeCloseTo(1 + (4 * 3) / 4.4)
    expect(groups.weak).toMatchObject({ wallets: 1, net: 4, avgPrice: 105 })
    expect(groups.weak.sold).toBeCloseTo(3 / 4.4)
    expect(groups.weak.held).toBeCloseTo(0.2 / 4.4)
    expect(groups.weak.pnl).toBeCloseTo(200 - (420 * 3) / 4.4)
    expect(groups.mercenary).toMatchObject({ wallets: 1, net: 2, sold: 0.5, held: 0.5, pnl: 300 })
    expect(groups.strong).toMatchObject({ wallets: 1, net: 5, sold: 0, held: 1 })
    expect(groups.unknown).toMatchObject({ wallets: 6, net: 3, sold: null, held: null })
    expect(groups.mover.share).toBeCloseTo(1.5 / 18.52)
    const plain = bondSummary(feed, { window: 'all', now, cohortOf })
    expect(plain.groups.left).toMatchObject({ wallets: 3, net: 7.5, sold: null, pnl: null })
    expect(plain.outcome).toMatchObject({ sold: null, moved: null })
  })

  it('says what buyers did in one sentence', () => {
    expect(bondOutcomeLine(bondSummary(feed, { window: 'all', now, cohortOf }))).toBe('Buyers since launch moved 34% of their bonded NET out of their wallets and staked 27%.')
    expect(bondOutcomeLine(bondSummary(dexFeed, { window: 'all', now, cohortOf }))).toBe('Buyers since launch staked 27% of their bonded NET and sold 20% on the DEX.')
    expect(bondOutcomeLine(bondSummary({ ...feed, holdings: null }, { window: 'all', now, cohortOf }))).toBeNull()
  })

  it('writes the buyer list as CSV', () => {
    const buyers = bondBuyers(dexFeed, { window: '24h', now, cohortOf })
    const [header, ...lines] = buyersCsv(buyers, '24h').split('\n')
    expect(header).toBe(
      'address,label,cohort,bonded_net_24h,bonded_usdg_24h,bonds_24h,epochs_24h,first_bond,last_bond_24h,group,sources_24h,vesting_pct,staked_pct,wrapped_pct,looped_pct,liquid_pct,sold_pct,moved_pct,net_sold_pct,dex_sold_net_24h,dex_sold_usd_24h,dex_bought_net_24h,dex_net_sold_net_24h',
    )
    expect(lines).toHaveLength(9)
    expect(lines.find((line) => line.startsWith('0xa,'))).toBe(
      '0xa,🤓 Smart Trader,Smart money,1,110,1,1,2026-07-17T16:34:02.000Z,2026-07-18T00:33:32.000Z,Strong hands,Bond depository,0,63.64,36.36,0,0,0,0,0,1,100,0,1',
    )
    // Quotes and commas are escaped; a formula-like label is defused.
    expect(buyersCsv([{ ...buyers[0], label: '=HYPERLINK("x"), y' }], '24h')).toContain(`,"'=HYPERLINK(""x""), y",`)
  })
})

describe('bond summary', () => {
  const summary = bondSummary(feed, { window: 'all', now, cohortOf, borrowers: new Set(['0xc']) })

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
    expect(bondSummary({ ...feed, holdings: null }, { window: 'all', now, cohortOf }).retention).toBeNull()
  })

  it('reads the current epoch from live state', () => {
    expect(summary.current).toMatchObject({ epoch: 3, opensAt: S + 3 * E, closesAt: S + 4 * E, sold: 6.5, cap: 12, soldOut: false })
    expect(summary.discount).toBeCloseTo(1 - 100 / 110)
  })

  it('writes a plain headline, led by buyer groups once holdings are read', () => {
    expect(bondHeadline(summary)).toBe('Depository bonds sold out in 1 of 3 epochs since launch. Wallets whose NET left bought 40% of bonded NET since launch, strong hands 27%.')
    expect(bondHeadline(bondSummary(feed, { window: '24h', now, cohortOf }))).toBe(
      'Depository bonds sold out in 1 of the last 3 epochs. Loopers bought 35% of bonded NET in the last day, wallets whose NET left 18%.',
    )
    const unread = { ...feed, holdings: null }
    expect(bondHeadline(bondSummary(unread, { window: 'all', now, cohortOf }))).toBe('Depository bonds sold out in 1 of 3 epochs since launch. Smart money bought 27% of bonded NET since launch.')
    expect(bondHeadline(bondSummary(unread, { window: '24h', now, cohortOf }))).toBe(
      'Depository bonds sold out in 1 of the last 3 epochs. Unlabelled wallets bought 18% of bonded NET in the last day; smart money bought 12%.',
    )
  })

  it('lists only the dynamics that hold', () => {
    expect(bondDynamics(summary, summary, bondBuyers(feed, { window: 'all', now, cohortOf }))).toEqual([
      'The top 10 wallets bought 97% of bonded NET since launch.',
      'Buyers since launch moved 34% of their bonded NET out of their wallets and staked 27%.',
      'All-time buyers still hold 59% of their bonded NET, with staking growth counted. 2 wallets hold under 10%.',
      '1 wallet that bonded since launch also borrows against wsNET in Loopback.',
      'The median epoch since launch sold 50% of its NET in the first minute.',
    ])
    const sellers = new Set(['0x1'])
    const recent = bondSummary(feed, { window: '24h', now, cohortOf, sellers })
    expect(bondDynamics(recent, summary, bondBuyers(feed, { window: '24h', now, cohortOf, sellers }))).toEqual([
      '8 of 9 wallets bought their first bond in the last day. They bought 88% of bonded NET.',
      'Hyperliquid traders bought 0% of bonded NET in the last day, against 22% since launch.',
      'Buyers from the last day looped 26% of their bonded NET through Loopback and moved 18% out of their wallets.',
      'All-time buyers still hold 59% of their bonded NET, with staking growth counted. 2 wallets hold under 10%.',
      "1 wallet that bonded in the last day is in Nansen's top 100 DEX sellers of NET over the last 7 days.",
      'The median epoch in the last day sold 50% of its NET in the first minute.',
    ])
  })
})

// The same bonds plus two desk bonds, desk stock, sleeve flows, and candles.
const deskRows: Array<[number, number, number | null, number, BondSource]> = [
  ...rows.map(([t, w, usdg, net]): [number, number, number | null, number, BondSource] => [t, w, usdg, net, 0]),
  [S + E + 300, 1, 60, 0.5, 1], // 0xb at the RWA desk v2
  [S + 3 * E + 200, 0, 420, 1, 3], // 0xa at the v3 desk
  [S + E + 400, 2, 30, 0.25, 4], // 0xc at the RWA desk v1, after its depository bond
]
deskRows.sort((a, b) => a[0] - b[0])
const deskFeed: BondFeed = {
  ...feed,
  bonds: {
    t: deskRows.map((row) => row[0]),
    w: deskRows.map((row) => row[1]),
    usdg: deskRows.map((row) => row[2]),
    net: deskRows.map((row) => row[3]),
    price: deskRows.map(() => 100),
    src: deskRows.map((row) => row[4]),
  },
  inventory: [
    [S + E + 10, 1, 0.5, 1],
    [S + E + 20, 4, 0.25, 1],
    [S + 3 * E + 150, 3, 1, 0],
  ],
  sleeve: [
    [S + 3 * E + 50, 0.01, 'other-in', 0],
    [S + 3 * E + 100, 2, 'buy', 900],
    [S + 3 * E + 140, 1, 'desk', 0],
  ],
  price: [
    [S, 400],
    [S + E, 420],
    [S + 2 * E + 14_400, 440],
  ],
}

describe('bond sources', () => {
  it('splits bonded NET by source, minted against desk stock', () => {
    const all = bondSummary(deskFeed, { window: 'all', now, cohortOf })
    expect(all.sources.map((source) => source.bonds)).toEqual([14, 1, 0, 1, 1])
    expect(all.sources[1]).toEqual({ bonds: 1, net: 0.5, usdg: 60 })
    expect(all.minted).toBeCloseTo(18.52)
    expect(all.fromInventory).toBeCloseTo(1.75)
    expect(all.totals.net).toBeCloseTo(20.27)
    expect(all.minted + all.fromInventory).toBeCloseTo(all.totals.net)
    expect(all.buyback).toEqual({ buys: 1, net: 2, usd: 900, deposited: 1.75, depositedMinted: 0.75, v3Sold: 1 })
    const recent = bondSummary(deskFeed, { window: '24h', now, cohortOf })
    expect(recent.sources.map((source) => source.net)).toEqual([8.5, 0.5, 0, 1, 0.25])
    const lines = bondDynamics(all, all, bondBuyers(deskFeed, { window: 'all', now, cohortOf }))
    expect(lines).toContain("Bond desks sold 1.8 of 20.3 bonded NET since launch. The v3 desk sold 1 NET from the manager sleeve's stock.")
    expect(lines).toContain('The manager sleeve bought 2 NET on the DEX since launch for 900 USDG.')
    // A wallet that bonded at the depository and at desk v1 counts both in expected NET, with staking growth.
    const before = byAddress(bondBuyers(feed, { window: 'all', now, cohortOf }))['0xc']
    const after = byAddress(bondBuyers(deskFeed, { window: 'all', now, cohortOf }))['0xc']
    expect(after.expected - before.expected).toBeCloseTo(0.25 * 1.1)
    expect(after.bySource).toEqual([before.bonded, 0, 0, 0, 0.25])
    expect(after.split!.left).toBeGreaterThan(before.split!.left)
    expect(sourceStarts(deskFeed)).toEqual([S + 30, S + E + 300, null, S + 3 * E + 200, S + E + 400])
  })

  it('keeps the cap on depository bonds and adds desk bonds, groups, and price to each epoch', () => {
    const groups = walletGroups(deskFeed, now)
    const series = epochSeries(deskFeed, { fromEpoch: 0, toEpoch: 3, cohortOf, groupOf: (address) => groups.get(address) ?? 'unknown' })
    expect(series[1]).toMatchObject({ sold: 2.5, net: 3.25, bySource: [2.5, 0.5, 0, 0, 0.25], soldOut: false })
    expect(series[1].fill).toBeCloseTo(0.25)
    expect(series[3]).toMatchObject({ sold: 6, net: 7, bySource: [6, 0, 0, 1, 0], soldOutAfter: null })
    // 0xa's v3 bond is not in its holdings: 1 of 6.5 expected NET left, so it trims instead of holding strong.
    expect(series[0].byGroup).toMatchObject({ trimmer: 4, left: 6, new: 0.02 })
    expect(series.map((row) => row.price)).toEqual([400, 420, 440, 440])
    expect(epochSeries(deskFeed, { fromEpoch: 0, toEpoch: 0, cohortOf })[0].byGroup.unknown).toBeCloseTo(10.02)
  })

  it('looks up the last point at or before a time', () => {
    const points: Array<[number, number]> = [
      [10, 1],
      [20, 2],
      [30, 3],
    ]
    expect([5, 10, 19, 20, 35].map((t) => stepAt(points, t))).toEqual([null, 1, 1, 2, 3])
    expect(stepAt([], 10)).toBeNull()
  })

  it('lets the NetNet registry name win over Nansen', () => {
    const sleeve = '0x498752d5fa0600cbd613074c151abe15b3fec7cb'
    const labelled: BondFeed = { ...feed, wallets: feed.wallets.map((address, i) => (i === 3 ? sleeve : address)), labels: { ...feed.labels, [sleeve]: '🤓 Smart Trader' } }
    const buyer = bondBuyers(labelled, { window: 'all', now, cohortOf: (address) => bondCohort(address, labelled) }).find((row) => row.address === sleeve)
    expect(buyer).toMatchObject({ label: 'NetNet manager sleeve', cohort: 'labelled', group: 'protocol' })
  })
})

// Hand-built logs, with the words of real Robinhood Chain logs.
const word = (value: bigint) => value.toString(16).padStart(64, '0')
const topic = (value: bigint | string) => `0x${typeof value === 'string' ? value.slice(2).padStart(64, '0') : word(value)}`
const log = (address: string, topics: string[], words: bigint[], at: { block?: string; tx?: string } = {}) => ({
  address,
  topics,
  data: `0x${words.map(word).join('')}`,
  blockNumber: at.block ?? '0x10',
  transactionHash: at.tx ?? '0xaa',
})
const DESK_BOND = '0x2cfcb3ca367d7f7d6165a0805c4c4e8f66a29641cae4d57667d135fac29129e9'
const ASSET_BOND = '0xdec46cdd0be10d522b17d462ec4f74dd8f90bd2a62eab8d79d863e0c7845af26'
const BOND_CREATED = '0xd52c75b244055af9364c0a5dc0da7868f6ae104012f245ad2702031af04d9b8e'
const INVENTORY = '0x8c659e8002149653e7d4cc7bf86afdabac70f806574c8e709329fb76a5a71681'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const SLEEVE = '0x498752d5fa0600cbd613074c151abe15b3fec7cb'
const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'

describe('bond log decoding', () => {
  it('reads depository, desk, and asset bonds', () => {
    // v3 desk, block 76,765,561: 516.69 USDG for 1.227 NET at 421.04.
    const v3 = log('0x732b3D1d3E8912CaE75164FA14a6E1c4C64615B3', [DESK_BOND, topic('0xd21887bfc59fd0d5a2f6d90c80d94bc43145bdfc'), topic(NVDA)], [
      516_690_000n,
      1_227_162_697n,
      421_044_414_959_777_243_526n,
      0n,
      2_237_344_669_080_766_452n,
    ])
    expect(decodeBond(v3)).toEqual({ src: 3, depositor: '0xd21887bfc59fd0d5a2f6d90c80d94bc43145bdfc', usdg: 516.69, net: 1.227163, price: 421.04 })
    // v2 desk, block 67,286,088: usdgIn includes the Treasury fee.
    const v2 = log('0xa84efc3136bf1bb89ade9e5be6ab32cb1a04f08d', [DESK_BOND, topic('0x11acd401e769c4ea69bd7bfe2599c41f5d689ce2'), topic(NVDA)], [
      838_870_000n,
      1_182_937_585n,
      709_141_387_087_085_150_618n,
      195_610_684n,
      2_875_468_550_313_335_538n,
    ])
    expect(decodeBond(v2)).toMatchObject({ src: 1, usdg: 838.87, net: 1.182938, price: 709.14 })
    // Asset desk, block 70,015,617: paid in HOHM; valueWad is the USD value.
    const asset = log(
      '0x2f2f215b810fa692304cb0095804ab3c8e4cef78',
      [ASSET_BOND, topic('0x397c1f28f9ec7401c9d721af23b663503d7c58cd'), topic('0x76cf788606f3d968b93b8a243d0e185c974ee407')],
      [
        51_562_596_888_725_159_592_260n,
        485_793_668_410_534_354_816n,
        648_020_784n,
        749_657_542_405_733_770_781n,
        110_906_060n,
        11_648_750_867_917_430_471_813n,
        39_913_846_020_807_729_120_447n,
      ],
    )
    expect(decodeBond(asset)).toEqual({ src: 2, depositor: '0x397c1f28f9ec7401c9d721af23b663503d7c58cd', usdg: 485.79, net: 0.648021, price: 749.66 })
    // Depository market 1 takes the LP token: no USDG.
    const lp = log('0xff32a969a0c567129eecd926d04657728e1980c1', [BOND_CREATED, topic(SLEEVE), topic(1n)], [10n ** 18n, 2_000_000_000n, 450n * 10n ** 18n])
    expect(decodeBond(lp)).toMatchObject({ src: 0, depositor: SLEEVE, usdg: null, net: 2, price: 450 })
  })

  it('marks desk stock minted in the deposit block', () => {
    const deposit = log('0xa84efc3136bf1bb89ade9e5be6ab32cb1a04f08d', [INVENTORY], [50_000_000_000n, 50_001_291_107n], { block: '0x402' })
    expect(inventoryRow(deposit, [[1026, 50]])).toEqual({ block: 1026, src: 1, net: 50, minted: 1 })
    expect(
      inventoryRow(deposit, [
        [1026, 49],
        [1025, 50],
      ]).minted,
    ).toBe(0)
  })

  it('tells sleeve DEX buys from other flows', () => {
    const router = '0xb477751b76cf82d00a686a1232f5fcd772414af3'
    const pool = '0x59f95461e68e0c77605299791e1449f175165b54'
    const net = (from: string, to: string, amount: bigint, tx: string, block: string) =>
      log('0xca9c78dd337a67f6e0077f65f5e9218719d30edf', [TRANSFER, topic(from), topic(to)], [amount], { tx, block })
    const paid = (amount: bigint, tx: string) => log('0x5fc5360d0400a0fd4f2af552add042d716f1d168', [TRANSFER, topic(SLEEVE), topic(router)], [amount], { tx })
    const rows = sleeveFlows(
      [net(router, SLEEVE, 60_000_000_000n, '0x01', '0x11'), net(router, SLEEVE, 34_220_335_720n, '0x01', '0x11'), net(pool, SLEEVE, 1_317_165n, '0x02', '0x12')],
      [net(SLEEVE, '0x732b3d1d3e8912cae75164fa14a6e1c4c64615b3', 100_000_000_000n, '0x03', '0x13'), net(SLEEVE, '0xb078cc304a0b264c5f3680dc0488954accd02e87', 5_000_000_000n, '0x04', '0x14')],
      [paid(42_000_000_000n, '0x01'), paid(808_000_000n, '0x01')],
    )
    expect(rows).toEqual([
      { block: 0x11, net: expect.closeTo(94.22033572, 9), kind: 'buy', usd: 42_808 }, // one buy: two NET legs, two USDG legs
      { block: 0x12, net: 0.001317165, kind: 'other-in', usd: 0 }, // a pool fee share: the sleeve paid nothing
      { block: 0x13, net: 100, kind: 'desk', usd: 0 },
      { block: 0x14, net: 5, kind: 'other-out', usd: 0 },
    ])
  })
})

describe('etagMatches', () => {
  it('compares weakly and reads lists', () => {
    expect(etagMatches('W/"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('W/"x", W/"abc"', 'W/"abc"')).toBe(true)
    expect(etagMatches('*', 'W/"abc"')).toBe(true)
    expect(etagMatches('W/"abd"', 'W/"abc"')).toBe(false)
    expect(etagMatches(undefined, 'W/"abc"')).toBe(false)
    expect(etagMatches('', 'W/"abc"')).toBe(false)
  })
})
