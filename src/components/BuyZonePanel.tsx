import { useMemo } from 'react'
import type { Desk } from '../types.ts'
import { priceSpanLabel, type BuyCopy } from '../lib/buyZone.ts'
import type { GlossaryId } from '../lib/glossary.ts'
import { formatNet, formatPercentWad, formatUsd, formatUsdg, formatWad } from '../lib/format.ts'
import { SCENARIO_ORDER, scenarioLabel, type ScenarioId, type ScenarioModel } from '../lib/model.ts'
import { buildImpactView, chartQuotes, fillLabel, quoteStatusLabel, type QuoteBook } from '../lib/quoteBook.ts'
import { WAD } from '../lib/units.ts'
import { ImpactChart } from './ImpactChart.tsx'
import { Chip, Details, Hint, Kpi, KpiRow, Section, Segmented } from './ui.tsx'

// The selected bucket's rule follows the general one. "Already liquidatable" is health under 1.
const BUCKET_TERM: Record<ScenarioId, GlossaryId> = {
  liquidatable: 'health',
  hf105: 'bucketHealth',
  hf110: 'bucketHealth',
  hf120: 'bucketHealth',
  top10: 'bucketTop10',
  custom: 'bucketCustom',
}

export function BuyZonePanel({
  desk,
  buckets,
  model,
  copy,
  scenario,
  onScenario,
  customInput,
  onCustom,
  book,
}: {
  desk: Desk
  buckets: Map<ScenarioId, ScenarioModel>
  model: ScenarioModel
  copy: BuyCopy
  scenario: ScenarioId
  onScenario: (id: ScenarioId) => void
  customInput: string
  onCustom: (value: string) => void
  book: QuoteBook
}) {
  const impact = useMemo(() => buildImpactView(model, book), [model, book])
  const curveMax = model.curve.length > 0 ? model.curve[model.curve.length - 1]?.netRaw ?? null : model.markerNetRaw
  const agg = chartQuotes(book.points, curveMax).map((point) => ({ netRaw: point.netRaw, priceWad: point.avgPriceWad }))
  const loading = book.status === 'loading'
  const options = SCENARIO_ORDER.map((id) => {
    const bucket = buckets.get(id)
    if (!bucket) return { value: id, label: scenarioLabel(id) }
    const debt = bucket.debtRaw > 0n ? ` · ${formatUsd(Number(bucket.debtRaw) / 1e6, true)}` : ''
    return { value: id, label: `${scenarioLabel(id)} · ${bucket.slices.length}${debt}` }
  })
  const fill =
    impact.source === 'aggregator'
      ? {
          label: 'Router touch → avg',
          term: 'routerTouchAvg' as const,
          value: `${formatWad(impact.routerTouch, 2)} → ${formatWad(impact.routerAvg, 2)}`,
          hint: impact.routerExact ? 'Live quote' : 'Interpolated',
        }
      : {
          label: 'Pool before → after',
          term: 'poolBeforeAfter' as const,
          value:
            model.spotBeforeWad === null || model.spotAfterWad === null
              ? '—'
              : `${formatWad(model.spotBeforeWad, 2)} → ${formatWad(model.spotAfterWad, 2)}`,
          hint: model.moveBps === null ? 'Canonical pool' : formatPercentWad((model.moveBps * WAD) / 10_000n, 1),
        }

  return (
    <Section
      id="buy-zone"
      testId="buy-zone"
      seal="买"
      eyebrow={
        <>
          <Hint id="forcedSelling">Forced NET supply</Hint> · Router quotes
        </>
      }
      title="Buy"
      accent="zone"
      meta={
        <Chip>
          <Hint id="priceSource">{loading ? quoteStatusLabel(book) : impact.providerLabel}</Hint>
        </Chip>
      }
      answer={copy.headline}
    >
      {copy.alert ? (
        <p className="mb-3 rounded border border-dashed border-seal/40 bg-seal/5 px-3 py-2 text-sm text-seal" data-testid="buy-alert">
          {copy.alert}
        </p>
      ) : null}
      <Segmented label="Health bucket" options={options} value={scenario} onChange={onScenario} hint={['bucket', BUCKET_TERM[scenario]]} />
      {scenario === 'custom' ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted">
          Custom USDG notional
          <input
            value={customInput}
            onChange={(event) => onCustom(event.target.value)}
            inputMode="decimal"
            className="num w-32 rounded border border-[rgb(74_47_29/0.3)] bg-field px-2 py-1 text-sm text-ink outline-none"
          />
          {model.slices.length === 0 ? <span className="text-seal">Enter a USDG amount</span> : null}
        </label>
      ) : null}
      <div className="mt-4 grid gap-4 *:min-w-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div>
          <KpiRow cols={2}>
            <Kpi label="Debt in bucket" term="debtInBucket" value={formatUsdg(model.debtRaw, 0)} hint="USDG" />
            <Kpi label="NET sold" term="netSold" value={formatNet(model.flowNetRaw, 2)} hint="NET to market" />
            <Kpi
              label={model.triggerKind === 'nav' ? 'NAV trigger' : 'TWAP trigger'}
              term={model.triggerKind === 'nav' ? 'navTrigger' : 'twapTrigger'}
              value={priceSpanLabel(model.triggerLowWad, model.triggerHighWad)}
              hint={model.triggerKind === 'liquidatable' ? 'Already through' : 'USDG/NET'}
            />
            <Kpi label={fill.label} term={fill.term} value={fill.value} hint={fill.hint} />
          </KpiRow>
          <p className="mt-3 text-xs text-muted">
            <Hint id="poolDepth">Canonical pool depth</Hint> <span className="num text-ink">{formatUsdg(desk.reserveUsdg, 0)} USDG</span>
          </p>
          {impact.note && !loading ? <p className="mt-2 text-xs text-warn">{impact.note}</p> : null}
        </div>
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
      <Details summary="Detail">
        {copy.detail ? (
          <p className="text-sm leading-relaxed text-ink">
            {copy.detail}
            <Hint id="canonicalPool" />
          </p>
        ) : null}
        {impact.fills.length > 0 ? (
          <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Route">
            <li className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              <Hint id="routeSplit">Route</Hint>
            </li>
            {impact.fills.map((fill) => (
              <li key={`${fill.source}-${fill.pool ?? 'none'}`}>
                <Chip>
                  {fillLabel(fill)} <span className="num ml-1">{(fill.shareBps / 100).toFixed(1)}%</span>
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
          {copy.caveats.map((caveat) => (
            <li key={caveat.text}>
              {caveat.text}
              <Hint id={caveat.term} />
            </li>
          ))}
        </ul>
      </Details>
    </Section>
  )
}
