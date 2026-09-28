import type { Desk } from '../types.ts'
import { formatNet, formatPercentWad, formatUsdg, formatWad, wadToNumber } from './format.ts'
import type { ScenarioModel } from './model.ts'
import { WAD } from './units.ts'

export type BuyCopy = {
  headline: string
  detail: string
  caveats: string[]
}

function price(wad: bigint | null): string {
  return formatWad(wad, 2)
}

export function describeBuyZone(args: {
  label: string
  model: ScenarioModel
  desk: Desk
  facilityMultiple: number | null
  runwayDays: number | null
}): BuyCopy {
  const { label, model, desk } = args
  const caveats = baseCaveats(args)
  const count = model.slices.length

  if (count === 0) {
    return {
      headline: `No borrowers sit in “${label}”. Nothing in this bucket is about to print forced NET supply.`,
      detail:
        'Pick a wider health band or a custom USDG notional. Names with no readable health are left out of every bucket.',
      caveats,
    }
  }

  if (model.debtRaw < 100n * 1_000_000n) {
    return {
      headline: `Debt in “${label}” is only ${formatUsdg(model.debtRaw, 0)} USDG. That is too small to be a meaningful print in the NET/USDG pool.`,
      detail: `${count} position${count === 1 ? '' : 's'} match the filter. The pool’s USDG side is ${formatUsdg(desk.reserveUsdg, 0)}.`,
      caveats,
    }
  }

  if (model.triggerKind === 'nav') {
    return {
      headline: `“${label}” is not a spot buy zone. These ${count} positions stay solvent down to the NAV floor.`,
      detail: `They margin-call only if NAV reaches about ${price(model.triggerLowWad)}–${price(model.triggerHighWad)} USDG per NET, or if the dividend index and borrow interest do the work. A spot crash does not mark them down while the floor is binding.`,
      caveats,
    }
  }

  if (model.triggerKind === 'liquidatable') {
    const paused = desk.liquidationsEnabled === false
    const span = `${price(model.spotAfterWad)}–${price(model.spotBeforeWad)}`
    return {
      headline: paused
        ? `These positions are already through the credited-value line, but the oracle is not accepting liquidations. The print ${span} USDG/NET is what the pool would do after price() works again.`
        : `Forced supply can print now, around ${span} USDG/NET, if ${formatUsdg(model.debtRaw, 0)} USDG of debt is liquidated.`,
      detail: saleDetail(model, 'current'),
      caveats,
    }
  }

  const upper = model.triggerHighWad
  const lower = model.repricedAfterWad ?? model.spotAfterWad
  const spread =
    upper !== null && model.triggerLowWad !== null && upper > 0n
      ? Number((upper - model.triggerLowWad) * 10_000n / upper) / 100
      : 0

  const headline = `Nearest meaningful forced supply prints around ${price(lower)}–${price(upper)} USDG/NET if ${formatUsdg(model.debtRaw, 0)} USDG of debt liquidates.`

  const stair =
    spread > 8
      ? ` The triggers inside this bucket span about ${spread.toFixed(0)}%, so expect a staircase of prints rather than one clip.`
      : ''

  return {
    headline,
    detail: `${saleDetail(model, 'trigger')}${stair}`,
    caveats,
  }
}

function saleDetail(model: ScenarioModel, path: 'current' | 'trigger'): string {
  const count = model.slices.length
  const net = formatNet(model.flowNetRaw ?? model.seizedNetRaw, 2)
  const debt = formatUsdg(model.debtRaw, 0)
  const today =
    model.spotBeforeWad !== null && model.spotAfterWad !== null
      ? ` Sold into today’s reserves, that NET moves spot from ${price(model.spotBeforeWad)} to ${price(model.spotAfterWad)} USDG/NET (${formatPercentWad(model.moveBps === null ? null : (model.moveBps * WAD) / 10_000n, 1)}).`
      : ''

  if (path === 'current') {
    return `${count} position${count === 1 ? '' : 's'}, ${debt} USDG of debt. Estimated seized collateral converts to about ${net} NET at the current sNET index, then sells into the canonical pair.${today}`
  }

  const reconverged =
    model.referenceSpotWad !== null && model.repricedAfterWad !== null
      ? ` The band assumes the pool has reconverged to the first trigger, TWAP ${price(model.referenceSpotWad)}, before the sale — the divergence guard blocks liquidations if spot is more than 15% under TWAP. Selling about ${net} NET from there lands near ${price(model.repricedAfterWad)}.`
      : ` Estimated sale is about ${net} NET.`

  return `${count} position${count === 1 ? '' : 's'} in this bucket.${reconverged}${today} The blue curve is today’s pool. The shaded band is the reconverged sale.`
}

function baseCaveats(args: {
  model: ScenarioModel
  desk: Desk
  facilityMultiple: number | null
  runwayDays: number | null
}): string[] {
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
  caveats.push(
    'Pair fee in the curve is 0.30%. NetNet docs also describe a 5% Treasury fee on official margin-call sales. That fee is not deducted here — if the seller must pay it, USDG received is worse than this curve.',
  )

  if (facilityMultiple !== null && facilityMultiple > 1) {
    caveats.push(
      `Book borrow is ${facilityMultiple.toFixed(1)}× the docs’ guidance of 10% of pool USDG depth. Expect smaller tranches and a slower unwind than a single dump of the whole bucket.`,
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

  return caveats
}

export function buyBand(model: {
  triggerKind: string
  triggerHighWad: bigint | null
  repricedAfterWad: bigint | null
  spotBeforeWad: bigint | null
  spotAfterWad: bigint | null
}): { low: bigint | null; high: bigint | null } {
  if (model.triggerKind === 'liquidatable' && model.spotAfterWad !== null && model.spotBeforeWad !== null) {
    return { low: model.spotAfterWad, high: model.spotBeforeWad }
  }
  if (
    (model.triggerKind === 'twap' || model.triggerKind === 'mixed') &&
    model.repricedAfterWad !== null &&
    model.triggerHighWad !== null
  ) {
    return { low: model.repricedAfterWad, high: model.triggerHighWad }
  }
  return { low: null, high: null }
}

export function priceSpanLabel(low: bigint | null, high: bigint | null): string {
  if (low === null || high === null) return '—'
  const a = wadToNumber(low)
  const b = wadToNumber(high)
  if (Math.abs(a - b) < 0.05) return formatWad(high, 2)
  return `${formatWad(low < high ? low : high, 2)}–${formatWad(low < high ? high : low, 2)}`
}
