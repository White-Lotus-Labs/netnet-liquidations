import { ADDRESSES } from '../config.ts'
import type { CreditBook } from '../adapters/credit.ts'
import type { PendleBook } from '../adapters/pendle.ts'
import { cx, formatApy, formatClock, formatDaily, formatDays, formatMultiple, formatRatio, formatUsd, formatUsdg } from '../lib/format.ts'
import type { GlossaryId } from '../lib/glossary.ts'
import { facilityStats } from '../lib/model.ts'
import { TARGET_UTILIZATION, apyToApr, dailyFromApy, daysUntilBorrowApr, projectedBorrowApy } from '../lib/rates.ts'
import type { Desk } from '../types.ts'
import { Sparkline } from './Sparkline.tsx'
import { Details, Fresh, Hint, Kpi, KpiRow, Section } from './ui.tsx'

/** Loop stress: is the wsNET → USDG loop getting squeezed? */
export function LoopPanel({
  desk,
  credit,
  creditError,
  pendle,
  pendleError,
}: {
  desk: Desk
  credit: CreditBook | null
  creditError: string | null
  pendle: PendleBook | null
  pendleError: string | null
}) {
  const loop = credit?.markets.find((market) => market.marketId === ADDRESSES.marketId) ?? null
  // One borrow-rate source: the credit vault's Loopback market, else the desk read.
  const borrowApy = loop?.borrowApy ?? desk.borrowApy
  const borrow = borrowApy === null ? null : dailyFromApy(borrowApy)
  const active = pendle?.active ?? null
  const implied = active ? dailyFromApy(active.impliedApy) : null
  const carry = implied !== null && borrow !== null ? (1 + implied) / (1 + borrow) - 1 : null
  const crossDays = active && loop ? daysUntilBorrowApr(loop.rateAtTargetApr, loop.utilization, apyToApr(active.impliedApy)) : null
  const in7d = loop && loop.utilization > TARGET_UTILIZATION ? dailyFromApy(projectedBorrowApy(loop.rateAtTargetApr, loop.utilization, 7)) : null
  const utilization =
    loop?.utilization ??
    desk.utilization ??
    (desk.supplyRaw !== null && desk.borrowRaw !== null && desk.supplyRaw > 0n ? Number((desk.borrowRaw * 10_000n) / desk.supplyRaw) / 10_000 : null)
  const supply = supplyChange(credit)
  const { multiple } = facilityStats(desk)
  const flags = credit ? creditFlags(credit) : []

  const history = credit?.loopback.history ?? []
  const impliedAt = stepLookup(pendle?.history ?? [])
  const borrowSeries = history.map((point) => dailyFromApy(point.borrowApy))
  const impliedSeries = history.map((point) => {
    const apy = impliedAt(point.t)
    return apy === null ? Number.NaN : dailyFromApy(apy)
  })

  return (
    <Section
      id="loop"
      testId="loop-stress"
      seal="贷"
      eyebrow="wsNET → USDG loop · Morpho + Pendle"
      title="Loop"
      accent="stress"
      fresh={
        <Fresh state={credit ? 'live' : creditError ? 'offline' : 'loading'} stale={credit !== null && creditError !== null}>
          {credit
            ? `Morpho and Pendle readings · updated ${formatClock(credit.fetchedAt)}`
            : creditError
              ? 'Morpho credit data is offline.'
              : 'Loading Morpho credit data…'}
        </Fresh>
      }
    >
      <KpiRow>
        <Kpi
          lead
          label="Looper carry"
          term="looperCarry"
          value={formatDaily(carry)}
          tone={carry === null ? undefined : carry >= 0 ? 'up' : 'down'}
          hint={
            carry !== null && carry < 0
              ? 'Negative carry: expect repayments and wsNET unwinds.'
              : pendleError && !pendle
                ? 'Pendle data is offline.'
                : (
                    <>
                      <Hint id="sNetIndex">Index</Hint> minus borrow, per day, in NET terms
                    </>
                  )
          }
        />
        <Kpi
          label="Borrow"
          term="borrowRate"
          value={formatDaily(borrow, 3)}
          hint={`${formatApy(borrowApy)} APY${in7d === null ? '' : ` · ${formatDaily(in7d, 3)} in 7d if utilization holds`}`}
        />
        {crossDays !== null && crossDays <= 30 ? (
          <Kpi
            label="Borrow passes index"
            term="borrowPassesIndex"
            value={crossDays === 0 ? 'Now' : `in ${formatDays(crossDays)}`}
            hint="Pendle implied index, if utilization holds"
            tone={crossDays < 14 ? 'warn' : undefined}
          />
        ) : null}
        <Kpi
          label="Utilization"
          term="utilization"
          value={formatRatio(utilization)}
          hint={<Hint id="adaptiveCurve">Curve target 90%</Hint>}
          tone={utilization !== null && utilization > 0.98 ? 'warn' : undefined}
        />
        <Kpi
          label="Loopback supply · 7d"
          value={supply ? `${supply.change >= 0 ? '+' : ''}${formatRatio(supply.change)}` : '—'}
          tone={supply ? (supply.change >= 0 ? 'up' : 'down') : undefined}
          hint={supply ? `${formatUsd(supply.now, true)} supplied now` : undefined}
        />
        <Kpi
          label="Borrowed vs pool guide"
          term="borrowedVsGuide"
          value={formatMultiple(multiple)}
          tone={multiple !== null && multiple > 1 ? 'warn' : undefined}
          hint={`${formatUsdg(desk.borrowRaw, 0)} USDG borrowed; guide is 10% of pool USDG`}
        />
      </KpiRow>

      {flags.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {flags.map((flag) => (
            <li key={flag.text} className="border-l-2 border-seal pl-2 text-sm text-seal">
              {flag.text}
              <Hint id={flag.term} />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Borrow vs implied index · per day · 14d</p>
        <Sparkline
          height={96}
          floor={0}
          series={[
            { label: 'Loopback borrow', className: 'stroke-ink', values: borrowSeries },
            { label: 'Pendle implied index', className: 'stroke-lotus', values: impliedSeries, dashed: true },
          ]}
        />
        <p className="num mt-1 flex flex-wrap items-center gap-x-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-3 bg-ink" />Loopback borrow</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 border-t-2 border-dashed border-lotus" /><Hint id="impliedIndex">Pendle implied index</Hint> <span className="text-lotus">{formatDaily(implied, 3)}</span></span>
        </p>
      </div>

      <Details summary="Detail">
        {credit ? <VaultDetail credit={credit} /> : null}
        {pendle ? <PendleDetail pendle={pendle} /> : null}
      </Details>
    </Section>
  )
}

function VaultDetail({ credit }: { credit: CreditBook }) {
  const { vault } = credit
  const others = credit.markets.filter((market) => market.marketId !== ADDRESSES.marketId)
  const topTwo = vault.topDepositors.slice(0, 2).reduce((sum, row) => sum + row.usdg, 0)
  const topExposure = credit.exposures[0] ?? null
  return (
    <>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">NetNet Credit vault · other markets</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[560px] border-collapse text-left text-[13px]">
          <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            <tr className="border-b border-line">
              <th className="py-1.5 font-semibold">Market</th>
              <th className="py-1.5 text-right font-semibold">
                <Hint id="vaultInCap">Vault in / cap</Hint>
              </th>
              <th className="py-1.5 text-right font-semibold">Supply</th>
              <th className="py-1.5 text-right font-semibold">Free</th>
              <th className="py-1.5 text-right font-semibold">Util</th>
              <th className="py-1.5 text-right font-semibold">Borrow APY</th>
            </tr>
          </thead>
          <tbody className="num">
            {others.map((market) => (
              <tr
                key={market.marketId}
                className={cx('border-b border-line last:border-b-0', market.supplyUsdg < 1_000 && 'opacity-60')}
                title={market.supplyUsdg < 1_000 ? 'Under $1k supplied. Rates here are noise.' : undefined}
              >
                <td className="py-1.5 font-sans text-ink">
                  {market.collateral}{' '}
                  <span className="text-[11px] text-muted">
                    {formatRatio(market.lltv)} <Hint id="lltv">LLTV</Hint>
                  </span>
                </td>
                <td className="py-1.5 text-right">
                  {formatUsd(market.allocatedUsdg, true)} <span className="text-muted">/ {formatUsd(market.capUsdg, true)}</span>
                </td>
                <td className="py-1.5 text-right">{formatUsd(market.supplyUsdg, true)}</td>
                <td className="py-1.5 text-right">{formatUsd(market.liquidityUsdg, true)}</td>
                <td className={cx('py-1.5 text-right', market.utilization > 0.98 && 'text-seal')}>{formatRatio(market.utilization)}</td>
                <td className="py-1.5 text-right">{formatApy(market.borrowApy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <KpiRow>
          <Kpi label="Vault assets" value={formatUsd(vault.totalAssetsUsdg, true)} hint={`${vault.depositors.toLocaleString('en-US')} depositors`} />
          <Kpi
            label="Withdrawable now"
            term="exitLiquidity"
            value={formatUsd(vault.liquidityUsdg, true)}
            hint={vault.totalAssetsUsdg > 0 ? `${formatRatio(vault.liquidityUsdg / vault.totalAssetsUsdg)} of assets` : undefined}
          />
          <Kpi label="Top 2 depositors" value={vault.totalAssetsUsdg > 0 ? formatRatio(topTwo / vault.totalAssetsUsdg) : '—'} hint="Share of vault assets" />
          <Kpi label="Largest borrower" term="largestBorrower" value={topExposure ? formatRatio(topExposure.share) : '—'} hint={topExposure ? topExposure.markets.join(', ') : undefined} />
        </KpiRow>
      </div>
    </>
  )
}

function PendleDetail({ pendle }: { pendle: PendleBook }) {
  const now = pendle.fetchedAt
  const active = pendle.active
  const history = pendle.history
  const lastT = history[history.length - 1]?.t ?? 0
  const weekAgo = history.find((point) => point.t >= lastT - 7 * 86_400_000 && Number.isFinite(point.tvlUsd))?.tvlUsd ?? null
  const later = pendle.markets.filter((market) => market.expiry > now && market !== active)
  const matured = pendle.markets.filter((market) => market.expiry <= now)
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return (
    <div className="mt-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Pendle sNET · yields in NET, not USD</p>
      <div className="mt-1">
        <KpiRow>
          <Kpi label="Active maturity" term="activeMaturity" value={active ? day(active.expiry) : '—'} hint={active ? `${formatDays((active.expiry - now) / 86_400_000)} left` : 'No sNET maturity trades now.'} />
          <Kpi label="Trailing index" term="trailingIndex" value={formatDaily(active ? dailyFromApy(active.underlyingApy) : null, 3)} hint="Pendle recent average" />
          <Kpi
            label="Market TVL"
            value={formatUsd(active?.tvlUsd ?? null, true)}
            hint={active && weekAgo && weekAgo > 0 ? `${active.tvlUsd >= weekAgo ? '+' : ''}${formatRatio(active.tvlUsd / weekAgo - 1)} in 7d` : undefined}
          />
        </KpiRow>
      </div>
      <p className="mt-2 text-xs text-muted">
        {later.length > 0 ? `Next maturity: ${later.map((market) => day(market.expiry)).join(', ')}.` : 'No later Pendle maturity listed.'}
        {matured.length > 0 ? ` Matured: ${matured.map((market) => `${day(market.expiry)} (${formatUsd(market.tvlUsd, true)} still parked)`).join(', ')}.` : ''}
      </p>
    </div>
  )
}

/** Value of the last point at or before `t`, for a daily series under an hourly axis. */
function stepLookup(points: Array<{ t: number; impliedApy: number }>): (t: number) => number | null {
  const sorted = points.filter((point) => Number.isFinite(point.impliedApy)).sort((a, b) => a.t - b.t)
  return (t) => {
    let value: number | null = null
    for (const point of sorted) {
      if (point.t > t) break
      value = point.impliedApy
    }
    return value
  }
}

function supplyChange(credit: CreditBook | null): { now: number; change: number } | null {
  const daily = credit?.loopback.supplyDaily ?? []
  const last = daily[daily.length - 1]
  const weekAgo = daily.find((point) => point.t >= (last?.t ?? 0) - 7 * 86_400_000)
  if (!last || !weekAgo || weekAgo.supplyUsdg <= 0) return null
  return { now: last.supplyUsdg, change: last.supplyUsdg / weekAgo.supplyUsdg - 1 }
}

/** Only the flags that fire now, each with the glossary entry that explains it. */
function creditFlags(credit: CreditBook): Array<{ text: string; term: GlossaryId }> {
  const { vault } = credit
  const flags: Array<{ text: string; term: GlossaryId }> = []
  if (vault.totalAssetsUsdg > 0 && vault.liquidityUsdg / vault.totalAssetsUsdg < 0.05) {
    flags.push({ text: `Only ${formatUsd(vault.liquidityUsdg, true)} of ${formatUsd(vault.totalAssetsUsdg, true)} can leave the credit vault now.`, term: 'exitLiquidity' })
  }
  const funded = credit.markets.filter((market) => market.supplyUsdg > 1_000)
  const pinned = funded.filter((market) => market.utilization > 0.98)
  if (pinned.length > 0) {
    const all = pinned.length === funded.length ? ' No idle vault USDG can cool Loopback rates.' : ''
    flags.push({ text: `${pinned.length} of ${funded.length} funded vault markets sit above 98% utilization.${all}`, term: 'pinnedMarkets' })
  }
  const badDebt = credit.markets.reduce((sum, market) => sum + market.badDebtUsdg, 0)
  if (badDebt > 0) flags.push({ text: `Bad debt on record: ${formatUsd(badDebt)}.`, term: 'badDebt' })
  return flags
}
