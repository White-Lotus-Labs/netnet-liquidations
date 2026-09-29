import type { ReactNode } from 'react'
import { ADDRESSES, LINKS } from '../config.ts'
import type { CreditBook } from '../adapters/credit.ts'
import { ptDiscount, type PendleBook } from '../adapters/pendle.ts'
import { cx, formatApy, formatDaily, formatDays, formatRatio, formatUsd, formatWarsaw } from '../lib/format.ts'
import { apyToApr, dailyFromApr, dailyFromApy, daysUntilBorrowApr, growthApr } from '../lib/rates.ts'
import { INDEX_SCALE } from '../lib/units.ts'
import { STRESS_INDEX, STRESS_NAV, STRESS_SNAPSHOT_AT } from '../seed/stressDesk.ts'
import type { Desk } from '../types.ts'
import { Sparkline } from './Sparkline.tsx'

/**
 * Pendle prices the sNET dividend index forward. That index multiplies every
 * wsNET's credited value, so it is the other side of the Loopback borrow rate.
 */
export function PendlePanel({
  pendle,
  error,
  desk,
  credit,
}: {
  pendle: PendleBook | null
  error: string | null
  desk: Desk
  credit: CreditBook | null
}) {
  if (!pendle) {
    return (
      <section aria-label="Pendle" className="rounded-md border border-line bg-panel px-3 py-3 text-sm text-muted">
        {error ? `Pendle data unavailable. ${error}` : 'Reading Pendle sNET markets…'}
      </section>
    )
  }
  const now = pendle.fetchedAt
  const active = pendle.active
  const loop = credit?.markets.find((market) => market.marketId === ADDRESSES.marketId) ?? null

  const implied = active ? dailyFromApy(active.impliedApy) : null
  const trailing = active ? dailyFromApy(active.underlyingApy) : null
  const borrow = loop ? dailyFromApy(loop.borrowApy) : null
  const carry = implied !== null && borrow !== null ? (1 + implied) / (1 + borrow) - 1 : null
  const crossDays =
    active && loop ? daysUntilBorrowApr(loop.rateAtTargetApr, loop.utilization, apyToApr(active.impliedApy)) : null

  const drift = chainDrift(desk)
  const discount = active ? ptDiscount(active.impliedApy, active.expiry, now) : null
  const history = pendle.history
  const lastT = history[history.length - 1]?.t ?? 0
  const tvlWeekAgo = history.find((point) => point.t >= lastT - 7 * 86_400_000 && Number.isFinite(point.tvlUsd))?.tvlUsd ?? null
  const matured = pendle.markets.filter((market) => market.expiry <= now)
  const later = pendle.markets.filter((market) => market.expiry > now && market !== active)

  return (
    <section aria-label="Pendle" className="rounded-md border border-line bg-panel" data-testid="pendle-panel">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-faint">Pendle · sNET index, priced forward</h2>
          <p className="mt-1 text-sm text-ink">
            {active
              ? `PT/YT-sNET ${new Date(active.expiry).toISOString().slice(0, 10)} · expires in ${formatDays((active.expiry - now) / 86_400_000)}`
              : 'No sNET maturity is trading now.'}
          </p>
        </div>
        <a className="text-xs text-cyan hover:underline" href={LINKS.pendle} target="_blank" rel="noreferrer">
          Pendle markets
        </a>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
        <Cell label="Implied index growth" value={formatDaily(implied)} hint={active ? `${formatApy(active.impliedApy)} APY to expiry` : '—'} tone="amber" />
        <Cell label="Trailing (Pendle)" value={formatDaily(trailing)} hint={active ? `${formatApy(active.underlyingApy)} APY, recent average` : '—'} />
        <Cell label="On-chain since snapshot" value={formatDaily(drift.index)} hint={drift.hint} />
        <Cell label="Loopback borrow" value={formatDaily(borrow, 3)} hint={loop ? `${formatApy(loop.borrowApy)} APY` : 'Credit data loading'} tone="rose" />
        <Cell
          label="Looper carry"
          value={formatDaily(carry)}
          hint="Implied index minus borrow, in NET terms"
          tone={carry === null ? 'ink' : carry > 0 ? 'mint' : 'rose'}
        />
        <Cell
          label="Borrow passes implied"
          value={crossDays === null ? 'Not at this util' : crossDays === 0 ? 'Now' : `in ${formatDays(crossDays)}`}
          hint="If utilization holds and the curve keeps adjusting"
          tone={crossDays !== null && crossDays < 14 ? 'rose' : 'ink'}
        />
      </dl>

      <div className="grid gap-3 px-3 py-3 *:min-w-0 sm:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-faint">Implied vs trailing, per day</p>
          <Sparkline
            floor={0}
            series={[
              { label: 'Implied', className: 'stroke-amber', values: history.map((point) => dailyFromApy(point.impliedApy)) },
              { label: 'Trailing', className: 'stroke-cyan', values: history.map((point) => dailyFromApy(point.underlyingApy)), dashed: true },
            ]}
          />
          <p className="text-[11px] text-muted">
            <span className="text-amber">Implied</span> · <span className="text-cyan">trailing</span>, daily since the market opened.
          </p>
        </div>
        <dl className="grid grid-cols-2 content-start gap-x-3 gap-y-1.5 text-xs">
          <Pair label="PT discount to par" value={discount === null ? '—' : formatRatio(discount)} />
          <Pair label="Pool liquidity" value={formatUsd(active?.liquidityUsd ?? null, true)} />
          <Pair
            label="Market TVL"
            value={
              active
                ? `${formatUsd(active.tvlUsd, true)}${tvlWeekAgo && tvlWeekAgo > 0 ? ` (${active.tvlUsd >= tvlWeekAgo ? '+' : ''}${formatRatio(active.tvlUsd / tvlWeekAgo - 1)} 7d)` : ''}`
                : '—'
            }
          />
          <Pair label="Volume" value={formatUsd(active?.volumeUsd ?? null, true)} />
          <Pair label="NAV per NET, since snapshot" value={formatDaily(drift.nav)} />
          <Pair label="NAV × index, since snapshot" value={formatDaily(drift.backing)} />
        </dl>
      </div>

      <ul className="space-y-1.5 border-t border-line px-3 py-3 text-xs leading-relaxed text-muted">
        <li className="border-l border-line pl-2">
          Every yield here is in NET, not USD. The index adds NET per wsNET, and new NET dilutes NAV per NET, so a looper’s USD carry also rides the NET price.
        </li>
        <li className="border-l border-line pl-2">
          Carry is why Loopback stays near 100% utilization. The curve raises the borrow rate until it meets the index. If index growth holds at Pendle’s implied rate, the loop turns negative{' '}
          {crossDays === null ? 'only if utilization rises further' : crossDays === 0 ? 'now' : `in about ${formatDays(crossDays)}`}. After that, expect repayments and wsNET unwinds, not new borrows.
          {active ? ` Pendle only prices the next ${formatDays((active.expiry - now) / 86_400_000)}; the desk uses that rate as the best read beyond it.` : ''}
        </li>
        <li className="border-l border-line pl-2">
          {later.length > 0
            ? `Next maturity: ${later.map((market) => new Date(market.expiry).toISOString().slice(0, 10)).join(', ')}.`
            : 'No later maturity is listed. After this expiry the desk has no forward read on the index until Pendle lists one.'}
          {matured.length > 0
            ? ` Matured: ${matured.map((market) => `${new Date(market.expiry).toISOString().slice(0, 10)} (${formatUsd(market.tvlUsd, true)} still parked)`).join(', ')}.`
            : ''}
        </li>
      </ul>
    </section>
  )
}

/** Index and NAV drift from the seed read to the live desk, as daily rates. */
function chainDrift(desk: Desk): { index: number | null; nav: number | null; backing: number | null; hint: string } {
  if (desk.mode !== 'live' || desk.index === null || desk.navWad === null || desk.blockTimestamp === null) {
    return { index: null, nav: null, backing: null, hint: 'Needs a live read' }
  }
  const seconds = desk.blockTimestamp - STRESS_SNAPSHOT_AT / 1000
  const index = Number(desk.index) / Number(INDEX_SCALE)
  const nav = Number(desk.navWad) / 1e18
  const indexApr = growthApr(Number(STRESS_INDEX), index, seconds)
  const navApr = growthApr(Number(STRESS_NAV), nav, seconds)
  return {
    index: indexApr === null ? null : dailyFromApr(indexApr),
    nav: navApr === null ? null : dailyFromApr(navApr),
    backing: indexApr === null || navApr === null ? null : dailyFromApr(indexApr + navApr),
    hint: `sNET.index() vs ${formatWarsaw(STRESS_SNAPSHOT_AT).replace(' Europe/Warsaw', '')}`,
  }
}

function Cell({ label, value, hint, tone = 'ink' }: { label: string; value: string; hint: ReactNode; tone?: 'ink' | 'rose' | 'amber' | 'mint' }) {
  const color = { ink: 'text-ink', rose: 'text-rose', amber: 'text-amber', mint: 'text-mint' }[tone]
  return (
    <div className="bg-panel px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className={cx('num mt-1 text-base', color)}>{value}</dd>
      <dd className="text-[11px] leading-snug text-muted">{hint}</dd>
    </div>
  )
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="num text-right text-ink">{value}</dd>
    </>
  )
}
