import { describe, expect, it } from 'vitest'
import { cleanLabel, holderStats, labelClass, labelMap, netMovers, overlap, segmentTotals, smartTape, type Holder, type Mover, type NansenSnapshot } from './flows.ts'

const mover = (address: string, label: string | null, boughtUsd: number, soldUsd: number): Mover => ({
  address,
  label,
  boughtUsd,
  soldUsd,
  boughtNet: 0,
  soldNet: 0,
})

describe('labels', () => {
  it('strips the address suffix and zero-width marks', () => {
    expect(cleanLabel('halflifexx.eth [0xfd19aa]')).toBe('halflifexx.eth')
    expect(cleanLabel('[0x498752]')).toBeNull()
    expect(cleanLabel('​​🤖 NET Staking Pool [0xb078cc]')).toBe('🤖 NET Staking Pool')
  })

  it('classifies Nansen labels the way the desk reads them', () => {
    expect(labelClass('🤓 180D Smart Trader [0x9be332]')).toBe('smart')
    expect(labelClass('🤓 🤖 180D Smart Trader')).toBe('smart')
    expect(labelClass('Funded @mowl_korea On Friendtech')).toBe('other')
    expect(labelClass('🔧 Former Smart Trader')).toBe('former-smart')
    expect(labelClass('​​🤖 NET Staking Pool')).toBe('staking')
    expect(labelClass('HL Perps Swing Trader')).toBe('hl-trader')
    expect(labelClass('👤 Mogfather')).toBe('public-figure')
    expect(labelClass('[0x1234ab]')).toBeNull()
  })
})

describe('protocol labels', () => {
  const sleeve = '0x498752D5fa0600CBd613074C151Abe15B3FeC7CB'

  it('lets the NetNet registry name win over Nansen everywhere', () => {
    const [row] = netMovers([mover(sleeve, '🤓 Smart Trader [0x498752]', 915_000, 0)], [])
    expect(row.label).toBe('NetNet manager sleeve')
    expect(segmentTotals([row]).map((total) => total.key)).toEqual(['protocol'])
    const snapshot = { buyers: [mover(sleeve, '🤓 Smart Trader', 1, 0)], sellers: [mover('0xAA', 'Binance Deposit', 0, 1)] } as unknown as NansenSnapshot
    const labels = labelMap(snapshot)
    expect(labels.get(sleeve.toLowerCase())).toBe('NetNet manager sleeve')
    expect(labels.get('0xaa')).toBe('Binance Deposit')
    expect(labelMap(null).get('0xb078cc304a0b264c5f3680dc0488954accd02e87')).toBe('NET staking pool')
    expect(labelClass('NET staking pool')).toBe('staking')
    expect(labelClass('NetNet treasury')).toBe('protocol')
  })
})

describe('movers', () => {
  const buyers = [mover('0xAA', '[0xaa]', 800, 0), mover('0xBB', '🤓 30D Smart Trader', 100, 40)]
  const sellers = [mover('0xbb', '🤓 30D Smart Trader', 100, 40), mover('0xCC', '👤 Mogfather', 10, 300)]
  const movers = netMovers(buyers, sellers)

  it('joins both lists on address without double counting', () => {
    expect(movers).toHaveLength(3)
    expect(movers.find((row) => row.address === '0xBB')?.netUsd).toBe(60)
    expect(movers.find((row) => row.address === '0xCC')?.netUsd).toBe(-290)
  })

  it('totals by label class', () => {
    const totals = Object.fromEntries(segmentTotals(movers).map((row) => [row.key, row.netUsd]))
    expect(totals).toEqual({ unlabeled: 800, smart: 60, 'public-figure': -290 })
  })

  it('counts a watch list on each side', () => {
    expect(overlap(['0xaa', '0xcc', '0xdd'], movers)).toEqual({ buyers: 1, buyUsd: 800, sellers: 1, sellUsd: 290 })
  })
})

describe('smart tape', () => {
  it('nets per trader and keeps the window', () => {
    const tape = smartTape([
      { address: '0x1', label: '🤓 Smart Trader', action: 'buy', amount: 1, valueUsd: 400, at: '2026-09-28T10:00:00Z', tx: null },
      { address: '0x1', label: '🤓 Smart Trader', action: 'sell', amount: 0.5, valueUsd: 150, at: '2026-09-29T10:00:00Z', tx: null },
      { address: '0x2', label: null, action: 'sell', amount: 1, valueUsd: 390, at: '2026-09-27T10:00:00Z', tx: null },
      { address: '0x3', label: null, action: null, amount: 1, valueUsd: 1, at: null, tx: null },
    ])
    expect(tape.boughtUsd).toBe(400)
    expect(tape.soldUsd).toBe(540)
    expect(tape.traders.map((row) => [row.address, row.netUsd])).toEqual([
      ['0x1', 250],
      ['0x2', -390],
    ])
    expect(tape.from).toBe('2026-09-27T10:00:00Z')
    expect(tape.to).toBe('2026-09-29T10:00:00Z')
  })
})

describe('holder stats', () => {
  const holder = (address: string, label: string | null, amount: number, change7d: number): Holder => ({
    address,
    label,
    amount,
    change7d,
    change30d: null,
    valueUsd: null,
  })

  it('splits supply around the staking pool and leaves protocol pools out of concentration', () => {
    const stats = holderStats(
      [
        holder('0xpool', '🤖 NET Staking Pool', 900, 50),
        holder('0xpair', 'Uniswap V2', 30, 1),
        holder('0xa', null, 40, 5),
        holder('0xb', null, 20, -2),
      ],
      1000,
    )
    expect(stats.stakingShare).toBe(0.9)
    expect(stats.freeFloat).toBe(100)
    expect(stats.top10FreeShare).toBeCloseTo(0.6, 12)
    expect(stats.grew7d).toBe(1)
    expect(stats.shrank7d).toBe(1)
  })

  it('falls back to a majority holder when the pool label is missing', () => {
    const stats = holderStats([holder('0xpool', null, 600, 0), holder('0xa', null, 10, 0)], 1000)
    expect(stats.stakingAddress).toBe('0xpool')
    expect(stats.stakingShare).toBe(0.6)
  })
})
