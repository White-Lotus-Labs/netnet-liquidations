import { describe, expect, it } from 'vitest'
import { parseKyber, parseLifi, parseZeroX, shareFills } from '../adapters/quotes.ts'
import { sampleDesk } from '../mock/sampleDesk.ts'
import { describeBuyZone } from './buyZone.ts'
import { buildScenario, enrichPositions, scenarioLabel } from './model.ts'
import { avgPriceWad, buildImpactView, executionAt, quoteStatusLabel, type QuoteBook, type SizedQuote } from './quoteBook.ts'
import { SPOT_SCALE } from './units.ts'

const NET = 1_000_000_000n
const USDG = 1_000_000n

function point(netWhole: bigint, usdgWhole: bigint, fills: SizedQuote['fills'] = []): SizedQuote {
  const netRaw = netWhole * NET
  const usdgOutRaw = usdgWhole * USDG
  const avg = avgPriceWad(netRaw, usdgOutRaw)
  if (avg === null) throw new Error('avg')
  return { netRaw, usdgOutRaw, avgPriceWad: avg, fills, provider: 'kyberswap' }
}

describe('router quote math', () => {
  it('prices USDG out per NET on the spot scale', () => {
    expect(avgPriceWad(10n * NET, 3_396n * USDG)).toBe((3396n * USDG * SPOT_SCALE) / (10n * NET))
  })

  it('interpolates USDG out and keeps the tail as the marginal print', () => {
    const points = [point(10n, 3_400n), point(100n, 30_000n)]
    const exec = executionAt(points, 55n * NET)
    expect(exec).not.toBeNull()
    expect(exec?.exact).toBe(false)
    const expectedOut = 3_400n * USDG + ((30_000n - 3_400n) * USDG * (45n * NET)) / (90n * NET)
    expect(exec?.usdgOutRaw).toBe(expectedOut)
    expect(exec && exec.marginalPriceWad < exec.avgPriceWad).toBe(true)
    expect(exec?.touchPriceWad).toBe(340n * 10n ** 18n)
  })

  it('refuses a size past the quoted ladder', () => {
    expect(executionAt([point(10n, 3_400n)], 40n * NET)).toBeNull()
  })

  it('splits route legs to 100%', () => {
    const fills = shareFills(
      [
        { source: 'uniswap-v4', pool: '0xabc', raw: 60n },
        { source: 'uniswap', pool: '0x59F95461E68e0c77605299791E1449f175165B54', raw: 40n },
      ],
      100n,
    )
    expect(fills.reduce((sum, fill) => sum + fill.shareBps, 0)).toBe(10_000)
    expect(fills[0]?.source).toBe('uniswap-v4')
    expect(fills[1]?.shareBps).toBe(4_000)
  })
})

describe('quote parsers', () => {
  it('reads a KyberSwap route and keeps the canonical pair leg', () => {
    const parsed = parseKyber(
      {
        code: 0,
        data: {
          routeSummary: {
            amountIn: '10000000000',
            amountOut: '3396237764',
            route: [
              [{ exchange: 'uniswap-v4', pool: '0xpool', swapAmount: '6000000000' }],
              [
                {
                  exchange: 'uniswap',
                  pool: '0x59F95461E68e0c77605299791E1449f175165B54',
                  swapAmount: '4000000000',
                },
              ],
            ],
          },
        },
      },
      10n * NET,
    )
    expect(parsed?.provider).toBe('kyberswap')
    expect(parsed?.usdgOutRaw).toBe(3_396_237_764n)
    expect(parsed?.fills.map((fill) => fill.source)).toEqual(['uniswap-v4', 'uniswap'])
  })

  it('reads an 0x price when liquidity is available', () => {
    const parsed = parseZeroX(
      {
        liquidityAvailable: true,
        sellAmount: '10000000000',
        buyAmount: '3400000000',
        route: { fills: [{ source: 'Uniswap_V4', proportionBps: '10000' }] },
      },
      10n * NET,
    )
    expect(parsed?.provider).toBe('0x')
    expect(parsed?.fills[0]?.source).toBe('Uniswap_V4')
    expect(parsed?.fills[0]?.shareBps).toBe(10_000)
  })

  it('ignores an 0x response with no liquidity', () => {
    expect(parseZeroX({ liquidityAvailable: false, zid: 'x' }, 10n * NET)).toBeNull()
  })

  it('reads a LI.FI estimate as a single-source fallback', () => {
    const parsed = parseLifi({ tool: 'nordstern', estimate: { fromAmount: '10000000000', toAmount: '3387903635' } }, 10n * NET)
    expect(parsed?.provider).toBe('lifi')
    expect(parsed?.fills[0]?.shareBps).toBe(10_000)
  })
})

describe('quote status', () => {
  it('names the router when quotes exist, even before a scenario is chosen', () => {
    expect(quoteStatusLabel(null)).toBe('Quoting router depth…')
    expect(
      quoteStatusLabel({
        status: 'live',
        fetchedAt: 1,
        warning: null,
        points: [],
        providers: ['kyberswap'],
      }),
    ).toContain('KyberSwap')
    expect(quoteStatusLabel({ status: 'unavailable', fetchedAt: null, warning: null, points: [], providers: [] })).toBe(
      'Canonical Uniswap v2 only',
    )
  })
})

describe('buy zone uses the router curve', () => {
  const desk = sampleDesk('test')
  const rows = enrichPositions(desk)
  const model = buildScenario(desk, rows, 'hf105', 0n)

  it('drives the headline from router touch-to-tail when quotes exist', () => {
    const flow = model.flowNetRaw
    expect(flow).not.toBeNull()
    if (flow === null) return
    const fullOut = (300n * flow * USDG) / NET
    const fullAvg = avgPriceWad(flow, fullOut)
    expect(fullAvg).not.toBeNull()
    if (fullAvg === null) return
    const book: QuoteBook = {
      status: 'live',
      fetchedAt: 1,
      warning: null,
      providers: ['kyberswap'],
      points: [
        point(1n, 340n),
        { netRaw: flow, usdgOutRaw: fullOut, avgPriceWad: fullAvg, fills: [], provider: 'kyberswap' },
      ],
    }
    const impact = buildImpactView(model, book)
    expect(impact.source).toBe('aggregator')
    const copy = describeBuyZone({
      label: scenarioLabel('hf105'),
      model,
      desk,
      book,
      facilityMultiple: 2,
      runwayDays: null,
    })
    expect(copy.alert).toBeNull()
    expect(copy.headline).toContain('router depth')
    expect(copy.headline).toContain('USDG/NET')
    expect(copy.detail).toContain('KyberSwap')
    expect(copy.detail).toContain('Canonical Uniswap v2')
  })

  it('keeps the loud canonical warning off while quotes are still loading', () => {
    const impact = buildImpactView(model, {
      status: 'loading',
      fetchedAt: null,
      warning: null,
      points: [],
      providers: [],
    })
    expect(impact.alert).toBeNull()
    expect(impact.note).toMatch(/still loading/)
  })
})
