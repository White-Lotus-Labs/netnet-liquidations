import type { Desk } from '../types.ts'
import { formatNet, formatPercentWad, formatUsdg, formatWad, wadToNumber } from './format.ts'
import type { ScenarioModel } from './model.ts'
import {
  buildImpactView,
  fillsSummary,
  routerMultiple,
  type ImpactView,
  type QuoteBook,
} from './quoteBook.ts'
import { WAD } from './units.ts'

export type BuyCopy = {
  headline: string
  detail: string
  caveats: string[]
  alert: string | null
}

function price(wad: bigint | null): string {
  return formatWad(wad, 2)
}

export function describeBuyZone(args: {
  label: string
  model: ScenarioModel
  desk: Desk
  book: QuoteBook | null
  facilityMultiple: number | null
  runwayDays: number | null
}): BuyCopy {
  const { label, model, desk } = args
  const impact = buildImpactView(model, args.book)
  const caveats = baseCaveats(args, impact)
  const count = model.slices.length

  if (count === 0) {
    return {
      headline: `No borrowers sit in “${label}”. Nothing in this bucket is about to print forced NET supply.`,
      detail:
        'Pick a wider health band or a custom USDG notional. Names with no readable health are left out of every bucket.',
      caveats,
      alert: null,
    }
  }

  if (model.debtRaw < 100n * 1_000_000n) {
    return {
      headline: `Debt in “${label}” is only ${formatUsdg(model.debtRaw, 0)} USDG. That is too small to be a meaningful print.`,
      detail: `${count} position${count === 1 ? '' : 's'} match the filter. Canonical pool USDG is ${formatUsdg(desk.reserveUsdg, 0)}.`,
      caveats,
      alert: null,
    }
  }

  if (model.triggerKind === 'nav') {
    return {
      headline: `“${label}” is not a spot buy zone. These ${count} positions stay solvent down to the NAV floor.`,
      detail: `They margin-call only if NAV reaches about ${price(model.triggerLowWad)}–${price(model.triggerHighWad)} USDG per NET, or if the dividend index and borrow interest do the work. A spot crash does not mark them down while the floor is binding.`,
      caveats,
      alert: null,
    }
  }

  if (model.triggerKind === 'liquidatable') {
    const paused = desk.liquidationsEnabled === false
    const span = priceSpanLabel(impact.bandLow, impact.bandHigh)
    const where = impact.source === 'aggregator' ? 'on router depth' : 'in the canonical pool'
    return {
      headline: paused
        ? `These positions are already through the credited-value line, but the oracle is not accepting liquidations. The print ${span} USDG/NET is what ${where} would do after price() works again.`
        : `Forced supply can print now, around ${span} USDG/NET ${where}, if ${formatUsdg(model.debtRaw, 0)} USDG of debt is liquidated.`,
      detail: saleDetail(model, impact, 'current'),
      caveats,
      alert: impact.alert,
    }
  }

  const upper = model.triggerHighWad
  const spread =
    upper !== null && model.triggerLowWad !== null && upper > 0n
      ? Number((upper - model.triggerLowWad) * 10_000n / upper) / 100
      : 0

  const span = priceSpanLabel(impact.bandLow, impact.bandHigh)
  const via = impact.source === 'aggregator' ? 'on router depth' : 'in the canonical pool'
  const headline = `Nearest meaningful forced supply prints around ${span} USDG/NET ${via} if ${formatUsdg(model.debtRaw, 0)} USDG of debt liquidates.`

  const stair =
    spread > 8
      ? ` The triggers inside this bucket span about ${spread.toFixed(0)}%, so expect a staircase of prints rather than one clip.`
      : ''

  return {
    headline,
    detail: `${saleDetail(model, impact, 'trigger')}${stair}`,
    caveats,
    alert: impact.alert,
  }
}

function saleDetail(model: ScenarioModel, impact: ImpactView, path: 'current' | 'trigger'): string {
  const count = model.slices.length
  const net = formatNet(model.flowNetRaw ?? model.seizedNetRaw, 2)
  const debt = formatUsdg(model.debtRaw, 0)
  const names = `${count} position${count === 1 ? '' : 's'}, ${debt} USDG of debt, about ${net} NET at the current sNET index.`

  if (impact.source === 'aggregator') {
    const multiple = routerMultiple(impact.routerUsdgOut, impact.canonicalUsdgOut)
    const compare =
      impact.canonicalBefore !== null && impact.canonicalAfter !== null
        ? ` Canonical Uniswap v2 alone would pay ${formatUsdg(impact.canonicalUsdgOut, 0)} USDG and walk its own spot from ${price(impact.canonicalBefore)} to ${price(impact.canonicalAfter)}.`
        : ''
    const times = multiple ? ` Router USDG is ${multiple} the pair’s USDG.` : ''
    const route = impact.fills.length > 0 ? ` Best route: ${fillsSummary(impact.fills)}.` : ''
    const exact = impact.routerExact
      ? ''
      : ' This size sits between live rungs, so USDG out is interpolated.'
    const clock =
      path === 'trigger'
        ? ` Quotes are today’s router book. The trigger TWAP is ${price(model.triggerHighWad)} USDG/NET; the curve shifts if TWAP grinds there before the sale.`
        : ''
    return `${names} ${impact.providerLabel} pays ${formatUsdg(impact.routerUsdgOut, 0)} USDG, average ${price(impact.routerAvg)} USDG/NET. A 1 NET clip clears near ${price(impact.routerTouch)}; the tail of this size prints near ${price(impact.routerMarginal)}.${compare}${times}${route}${exact}${clock}`
  }

  const today =
    model.spotBeforeWad !== null && model.spotAfterWad !== null
      ? ` Sold into today’s canonical reserves, that NET moves spot from ${price(model.spotBeforeWad)} to ${price(model.spotAfterWad)} USDG/NET (${formatPercentWad(model.moveBps === null ? null : (model.moveBps * WAD) / 10_000n, 1)}).`
      : ''

  if (path === 'current') {
    return `${names} The sale is modeled on the canonical pair only.${today}`
  }

  const reconverged =
    model.referenceSpotWad !== null && model.repricedAfterWad !== null
      ? ` The band assumes the canonical pool has reconverged to the first trigger, TWAP ${price(model.referenceSpotWad)}, before the sale. The divergence guard blocks liquidations if spot is more than 15% under TWAP. Selling about ${net} NET from there lands near ${price(model.repricedAfterWad)}.`
      : ''

  return `${names}${reconverged}${today} The dashed curve is today’s canonical pool. The shaded band is that pool’s reconverged sale.`
}

function baseCaveats(
  args: {
    model: ScenarioModel
    desk: Desk
    facilityMultiple: number | null
    runwayDays: number | null
  },
  impact: ImpactView,
): string[] {
  const { model, desk, facilityMultiple, runwayDays } = args
  const caveats: string[] = []

  if (desk.regime === 'cap') {
    caveats.push(
      'Credit is pinned at 5× NAV. A pure spot crash does not liquidate anyone until TWAP × 0.90 falls back through that cap. NAV, the dividend index, and interest are what move health.',
    )
  } else if (desk.regime === 'nav-floor') {
    caveats.push(
      'Credit is pinned at NAV. Further spot weakness does not reduce credited value, and the market pauses if spot is more than 15% under TWAP.',
    )
  } else if (desk.regime === 'haircut') {
    caveats.push(
      'Credit is tracking 90% of TWAP, inside the NAV floor and the 5× cap. Spot can pull TWAP down and eventually liquidate, but only while spot stays within 15% of TWAP.',
    )
  }

  if (desk.liquidationsEnabled === false && desk.pauseReason === 'divergence') {
    caveats.push(
      `Liquidations are paused: pool spot is under TWAP × 0.85 (pause level ${formatWad(desk.pauseSpotWad, 2)} USDG/NET). No forced flow until they reconverge.`,
    )
  } else if (desk.liquidationsEnabled === false) {
    caveats.push('oracle.price() is reverting, so Morpho will not liquidate until the oracle prices again.')
  } else if (desk.spotWad !== null && desk.pauseSpotWad !== null && desk.spotWad > 0n) {
    const cushion = ((desk.spotWad - desk.pauseSpotWad) * 10_000n) / desk.spotWad
    caveats.push(
      `Spot is ${formatPercentWad((cushion * WAD) / 10_000n, 1)} above the divergence pause at ${formatWad(desk.pauseSpotWad, 2)}. A fast wick through that level freezes liquidations even if borrowers are already unhealthy.`,
    )
  }

  caveats.push(
    'Unwrap assumption: 1 wsNET becomes index/1e9 NET, because that is the multiplier LoopbackOracle applies to TWAP and NAV. A liquidator who does not unwrap, or who sells in pieces, will not hit this print.',
  )
  if (impact.source === 'aggregator') {
    caveats.push(
      `${impact.providerLabel} quotes are indicative token-out, before gas. They split across venues (Uniswap v2, v3, v4, and other pools KyberSwap indexes on Robinhood Chain). A liquidator can still choose a worse route.`,
    )
    caveats.push(
      'The dashed curve is the canonical pair only, with its 0.30% fee. Router quotes already include the fees on the route they picked. A 5% Treasury fee on official margin-call sales is not deducted on either number.',
    )
  } else {
    caveats.push(
      'Pair fee in the canonical curve is 0.30%. NetNet docs also describe a 5% Treasury fee on official margin-call sales. That fee is not deducted here.',
    )
  }

  if (facilityMultiple !== null && facilityMultiple > 1) {
    caveats.push(
      `Book borrow is ${facilityMultiple.toFixed(1)}× the docs’ guidance of 10% of canonical-pool USDG depth. That guide is the pair, not router depth. Expect smaller tranches than one dump of the whole bucket.`,
    )
  }

  if (runwayDays !== null && runwayDays < 45 && desk.borrowApy !== null) {
    caveats.push(
      `If credited value stays flat, borrow interest at ${(desk.borrowApy * 100).toFixed(0)}% APY walks the nearest names in this health range to a margin call in about ${runwayDays.toFixed(0)} days. That clock is not a price target.`,
    )
  }

  if (model.badDebtRaw > 0n) {
    caveats.push(
      `${formatUsdg(model.badDebtRaw, 0)} USDG of this bucket is not covered by collateral at the incentive — a liquidator seizing 100% of that collateral still leaves bad debt.`,
    )
  }

  if (desk.mode === 'mock') {
    caveats.push('This page is the frozen sample book, not the live market.')
  }
  if (desk.mode === 'seed') {
    caveats.push(
      'The ladder and the canonical pool are the 18:02 Europe/Warsaw snapshot. This desk seizes about 70.4% of collateral at the health = 1 line. That stress note assumed 100% of collateral and a 5% treasury fee on one pool, which prints a larger move.',
    )
  }

  return caveats
}

export function priceSpanLabel(low: bigint | null, high: bigint | null): string {
  if (low === null || high === null) return '—'
  const a = wadToNumber(low)
  const b = wadToNumber(high)
  if (Math.abs(a - b) < 0.05) return formatWad(high, 2)
  return `${formatWad(low < high ? low : high, 2)}–${formatWad(low < high ? high : low, 2)}`
}
