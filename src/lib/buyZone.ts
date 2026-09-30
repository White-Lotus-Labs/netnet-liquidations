import type { Desk } from '../types.ts'
import { formatDays, formatUsdg, formatWad, wadToNumber } from './format.ts'
import type { ScenarioModel } from './model.ts'
import { buildImpactView, routerMultiple, type ImpactView, type QuoteBook } from './quoteBook.ts'

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
  const caveats = notes(args)
  const count = model.slices.length

  if (count === 0) {
    return { headline: `No borrowers in “${label}”.`, detail: '', caveats, alert: null }
  }

  if (model.debtRaw < 100n * 1_000_000n) {
    return { headline: `“${label}” holds only ${formatUsdg(model.debtRaw, 0)} USDG of debt.`, detail: '', caveats, alert: null }
  }

  if (model.triggerKind === 'nav') {
    return {
      headline: `“${label}” is spot-immune. It liquidates only if NAV falls to ${priceSpanLabel(model.triggerLowWad, model.triggerHighWad)}.`,
      detail: '',
      caveats,
      alert: null,
    }
  }

  const span = priceSpanLabel(impact.bandLow, impact.bandHigh)
  const via = impact.source === 'aggregator' ? 'on router depth' : 'in the canonical pool'
  // The router band is today's book; the canonical band is repriced to the first trigger.
  let headline =
    impact.source === 'aggregator'
      ? `Forced selling prints ${span} USDG/NET ${via}, using today's quotes. The first trigger is TWAP ${price(model.triggerHighWad)}.`
      : `Forced selling prints ${span} USDG/NET ${via} once TWAP falls to ${price(model.triggerHighWad)}.`
  if (model.triggerKind === 'liquidatable') {
    headline =
      desk.liquidationsEnabled === false
        ? `These names are past the line, but the oracle is paused. Forced selling prints ${span} USDG/NET ${via} once it prices again.`
        : `Forced selling can print now at ${span} USDG/NET ${via}.`
  }
  return { headline, detail: saleDetail(model, impact), caveats, alert: impact.alert }
}

/** Router fill against the canonical pair, in one or two sentences. */
function saleDetail(model: ScenarioModel, impact: ImpactView): string {
  const canonical =
    model.usdgOutRaw === null
      ? ''
      : `Canonical Uniswap v2 alone pays ${formatUsdg(model.usdgOutRaw, 0)} USDG and moves spot ${price(model.spotBeforeWad)} → ${price(model.spotAfterWad)}.`
  if (impact.source === 'aggregator') {
    const multiple = routerMultiple(impact.routerUsdgOut, impact.canonicalUsdgOut)
    return `${impact.providerLabel} pays ${formatUsdg(impact.routerUsdgOut, 0)} USDG${multiple ? `, ${multiple} the pair` : ''}. ${canonical}`.trim()
  }
  const reconverged =
    model.referenceSpotWad !== null && model.repricedAfterWad !== null
      ? ` From TWAP ${price(model.referenceSpotWad)}, the same sale lands near ${price(model.repricedAfterWad)}.`
      : ''
  return `${canonical}${reconverged}`.trim()
}

function notes(args: { model: ScenarioModel; facilityMultiple: number | null; runwayDays: number | null }): string[] {
  const { model, facilityMultiple, runwayDays } = args
  const out = ['No forced sale while spot sits more than 15% under TWAP.', '0.30% pair fee included; 5% Treasury fee excluded.']
  const high = model.triggerHighWad
  if (high !== null && model.triggerLowWad !== null && high > 0n) {
    const spread = Number(((high - model.triggerLowWad) * 10_000n) / high) / 100
    if (spread > 8) out.push(`Triggers span ${spread.toFixed(0)}%: expect a staircase of prints, not one clip.`)
  }
  if (facilityMultiple !== null && facilityMultiple > 1) out.push('Book borrow exceeds the 10% pool guide: expect tranches, not one dump.')
  if (runwayDays !== null && runwayDays < 45) out.push(`At flat credit, interest alone liquidates the weakest names in ${formatDays(runwayDays)}.`)
  if (model.badDebtRaw > 0n) out.push(`${formatUsdg(model.badDebtRaw, 0)} USDG of this bucket is bad debt at the incentive.`)
  return out
}

export function priceSpanLabel(low: bigint | null, high: bigint | null): string {
  if (low === null || high === null) return '—'
  const a = wadToNumber(low)
  const b = wadToNumber(high)
  if (Math.abs(a - b) < 0.05) return formatWad(high, 2)
  return `${formatWad(low < high ? low : high, 2)}–${formatWad(low < high ? high : low, 2)}`
}
