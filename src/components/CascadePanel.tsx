import { useMemo } from 'react'
import type { Desk } from '../types.ts'
import { priceSpanLabel } from '../lib/buyZone.ts'
import { formatNet, formatPercentWad, formatUsdg, formatWad, formatWsNet, cx } from '../lib/format.ts'
import {
  SCENARIO_ORDER,
  buildScenario,
  scenarioLabel,
  type EnrichedPosition,
  type ScenarioId,
} from '../lib/model.ts'
import { buildImpactView, chartQuotes, fillLabel, quoteStatusLabel, routerMultiple, type QuoteBook } from '../lib/quoteBook.ts'
import { WAD } from '../lib/units.ts'
import { ImpactChart } from './ImpactChart.tsx'

export function CascadePanel({
  desk,
  rows,
  scenario,
  onScenario,
  customInput,
  onCustom,
  book,
}: {
  desk: Desk
  rows: EnrichedPosition[]
  scenario: ScenarioId
  onScenario: (id: ScenarioId) => void
  customInput: string
  onCustom: (value: string) => void
  book: QuoteBook | null
}) {
  const customDebt = parseDebt(customInput)
  const model = useMemo(
    () => buildScenario(desk, rows, scenario, customDebt),
    [desk, rows, scenario, customDebt],
  )
  const counts = useMemo(() => {
    const map = new Map<ScenarioId, number>()
    for (const id of SCENARIO_ORDER) {
      map.set(id, buildScenario(desk, rows, id, customDebt).slices.length)
    }
    return map
  }, [desk, rows, customDebt])
  const impact = useMemo(() => buildImpactView(model, book), [model, book])
  const move =
    model.moveBps === null ? null : formatPercentWad((model.moveBps * WAD) / 10_000n, 1)
  const curveMax = model.curve.length > 0 ? model.curve[model.curve.length - 1]?.netRaw ?? null : model.markerNetRaw
  const agg = chartQuotes(book?.points ?? [], curveMax).map((point) => ({
    netRaw: point.netRaw,
    priceWad: point.avgPriceWad,
  }))
  const multiple = routerMultiple(impact.routerUsdgOut, impact.canonicalUsdgOut)

  return (
    <section aria-label="Cascade and price impact" className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-3 py-2.5">
        <h2 className="text-[11px] uppercase tracking-[0.16em] text-faint">Cascade / price impact</h2>
        <p className="mt-1 text-sm text-muted" data-testid="quote-status">
          {quoteStatusLabel(book)}
        </p>
        <p className="mt-1 text-sm text-muted">
          Seized wsNET at the 62.5% line is about 70.4% of collateral (LLTV × 12.7% incentive). Already-liquidatable names can lose up to 100%. The mint curve is average router fill. The dashed curve is the canonical pair’s price after the same sale.
        </p>
        {impact.alert ? (
          <p className="mt-2 rounded border border-rose/50 bg-rose/10 px-2 py-1.5 text-xs text-rose" data-testid="impact-warning">
            {impact.alert}
          </p>
        ) : null}
        {impact.note ? <p className="mt-2 text-xs text-amber">{impact.note}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pt-3">
        {SCENARIO_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onScenario(id)}
            className={cx(
              'rounded border px-2 py-1 text-left text-xs',
              scenario === id ? 'border-amber bg-amber/10 text-amber' : 'border-line text-muted hover:border-amber-dim hover:text-ink',
            )}
          >
            {scenarioLabel(id)}
            <span className="num ml-1.5 text-ink">{counts.get(id) ?? 0}</span>
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 px-3 text-xs text-muted">
        Custom USDG notional
        <input
          value={customInput}
          onChange={(event) => onCustom(event.target.value)}
          inputMode="decimal"
          aria-label="Custom debt notional in USDG"
          className="num w-32 rounded border border-line bg-desk px-2 py-1 text-sm text-ink outline-none focus:border-amber"
        />
        {scenario === 'custom' && customDebt === 0n ? <span className="text-rose">Enter a USDG amount</span> : null}
      </label>
      <dl className="mt-3 grid grid-cols-2 gap-2 px-3 sm:grid-cols-3">
        <Stat label="Debt in bucket" value={formatUsdg(model.debtRaw, 0)} />
        <Stat label="Seized wsNET" value={formatWsNet(model.seizedWsRaw, 2)} />
        <Stat label="NET sold" value={formatNet(model.flowNetRaw, 2)} />
        <Stat
          label="Router USDG out"
          value={formatUsdg(impact.routerUsdgOut, 0)}
          hint={multiple ? `${multiple} the pair` : undefined}
        />
        <Stat
          label="Router avg fill"
          value={
            impact.routerTouch === null || impact.routerAvg === null
              ? '—'
              : `${formatWad(impact.routerTouch, 2)} → ${formatWad(impact.routerAvg, 2)}`
          }
          hint={impact.routerExact ? 'Live quote' : impact.routerAvg ? 'Interpolated' : undefined}
        />
        <Stat label="Canonical USDG out" value={formatUsdg(model.usdgOutRaw, 0)} />
        <Stat
          label="Canonical pool only"
          value={
            model.spotBeforeWad === null || model.spotAfterWad === null
              ? '—'
              : `${formatWad(model.spotBeforeWad, 2)} → ${formatWad(model.spotAfterWad, 2)}`
          }
          hint={move ?? undefined}
        />
        <Stat
          label={model.triggerKind === 'nav' ? 'NAV trigger' : 'TWAP trigger'}
          value={priceSpanLabel(model.triggerLowWad, model.triggerHighWad)}
          hint={model.triggerKind === 'liquidatable' ? 'Already through' : undefined}
        />
      </dl>
      {impact.fills.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5 px-3" data-testid="route-fills">
          {impact.fills.map((fill) => (
            <li key={`${fill.source}-${fill.pool ?? 'none'}`} className="rounded border border-line px-2 py-0.5 text-[11px] text-muted">
              {fillLabel(fill)} <span className="num text-ink">{(fill.shareBps / 100).toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="px-2 pb-3 pt-2">
        <ImpactChart
          curve={model.curve}
          agg={agg}
          aggLabel={impact.source === 'aggregator' ? impact.providerLabel : 'Router average fill'}
          markerNetRaw={model.markerNetRaw}
          spotWad={desk.spotWad}
          twapWad={desk.twapWad}
          navWad={desk.navWad}
          pauseWad={desk.pauseSpotWad}
          bandLow={impact.bandLow}
          bandHigh={impact.bandHigh}
        />
      </div>
      {impact.source === 'canonical' && model.repricedAfterWad !== null && model.referenceSpotWad !== null ? (
        <p className="px-3 pb-3 text-xs leading-relaxed text-muted">
          If the canonical pool first reconverges to the top trigger ({formatWad(model.referenceSpotWad, 2)}), the same NET sale lands near{' '}
          <span className="num text-amber">{formatWad(model.repricedAfterWad, 2)}</span>. That range is the shaded band while router quotes are down.
        </p>
      ) : null}
      {impact.source === 'aggregator' && impact.bandLow !== null ? (
        <p className="px-3 pb-3 text-xs leading-relaxed text-muted">
          Shaded band is the router walk from a small clip ({formatWad(impact.routerTouch, 2)}) to the tail of this size (
          {formatWad(impact.routerMarginal, 2)}). Mint line is average fill versus size. Dashed line is the canonical pair only.
        </p>
      ) : null}
    </section>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-line bg-desk px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className="num text-sm text-ink">{value}</dd>
      {hint ? <dd className="num text-[10px] text-muted">{hint}</dd> : null}
    </div>
  )
}

function parseDebt(input: string): bigint {
  const cleaned = input.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{0,6})?$/.test(cleaned)) return 0n
  const [whole, frac = ''] = cleaned.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6))
}
