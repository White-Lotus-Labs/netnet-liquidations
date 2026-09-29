import type { ReactNode } from 'react'
import { ADDRESSES, LINKS } from '../config.ts'
import type { CreditBook, CreditMarket } from '../adapters/credit.ts'
import { cx, formatApy, formatDays, formatRatio, formatUsd, shortAddress } from '../lib/format.ts'
import { daysUntilBorrowApr, projectedBorrowApy, TARGET_UTILIZATION } from '../lib/rates.ts'
import { Sparkline } from './Sparkline.tsx'

type Risk = { tone: 'rose' | 'amber' | 'muted'; text: string }

export function CreditPanel({ credit, error }: { credit: CreditBook | null; error: string | null }) {
  if (!credit) {
    return (
      <section aria-label="Credit" className="mt-4 rounded-md border border-line bg-panel px-3 py-3 text-sm text-muted">
        {error ? `Credit data unavailable. ${error}` : 'Reading the NetNet Credit vault and its markets…'}
      </section>
    )
  }
  const { vault } = credit
  const loop = credit.markets.find((market) => market.marketId === ADDRESSES.marketId) ?? null
  const withdrawShare = vault.totalAssetsUsdg > 0 ? vault.liquidityUsdg / vault.totalAssetsUsdg : null
  const topTwo = vault.topDepositors.slice(0, 2).reduce((sum, row) => sum + row.usdg, 0)
  const topExposure = credit.exposures[0] ?? null
  const history = credit.loopback.history
  const risks = creditRisks(credit, loop)

  return (
    <section aria-label="Credit" className="mt-4 rounded-md border border-line bg-panel" data-testid="credit-panel">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-faint">Credit · who funds the book</h2>
          <p className="mt-1 text-sm text-ink">
            NetNet Credit (nnUSDG) lends USDG into this market and six stock markets. Rates follow Morpho’s adaptive curve.
          </p>
        </div>
        <p className="flex gap-3 text-xs">
          <a className="text-cyan hover:underline" href={LINKS.creditVault} target="_blank" rel="noreferrer">
            Vault
          </a>
          <a className="text-cyan hover:underline" href={LINKS.creditDocs} target="_blank" rel="noreferrer">
            Credit docs
          </a>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-6">
        <Cell label="Vault assets" value={formatUsd(vault.totalAssetsUsdg)} hint={`${vault.depositors.toLocaleString('en-US')} depositors · share ${vault.sharePrice.toFixed(4)}`} />
        <Cell
          label="Withdrawable now"
          value={formatUsd(vault.liquidityUsdg)}
          hint={withdrawShare === null ? '—' : `${formatRatio(withdrawShare)} of assets`}
          tone={withdrawShare !== null && withdrawShare < 0.05 ? 'rose' : 'ink'}
        />
        <Cell label="Depositor APY" value={formatApy(vault.netApy)} hint={`${formatApy(vault.apy)} gross · ${formatRatio(vault.performanceFee)} fee`} />
        <Cell
          label="Top 2 depositors"
          value={vault.totalAssetsUsdg > 0 ? formatRatio(topTwo / vault.totalAssetsUsdg) : '—'}
          hint={vault.topDepositors.slice(0, 2).map((row) => shortAddress(row.address)).join(' · ')}
        />
        <Cell
          label="Largest borrower"
          value={topExposure ? formatRatio(topExposure.share) : '—'}
          hint={topExposure ? `${shortAddress(topExposure.address)} · ${topExposure.markets.join(', ')}` : 'Borrower list unavailable'}
          tone={topExposure && topExposure.share > 0.25 ? 'amber' : 'ink'}
        />
        <Cell
          label="Loopback borrow"
          value={loop ? formatApy(loop.borrowApy) : '—'}
          hint={loop ? `util ${formatRatio(loop.utilization)} · at target ${formatApy(loop.apyAtTarget)}` : '—'}
          tone={loop && loop.utilization > 0.98 ? 'rose' : 'ink'}
        />
      </dl>

      <div className="overflow-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead className="bg-panel-2 text-[11px] uppercase tracking-[0.12em] text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 text-right font-medium">Vault in / cap</th>
              <th className="px-3 py-2 text-right font-medium">Supply</th>
              <th className="px-3 py-2 text-right font-medium">Free</th>
              <th className="px-3 py-2 text-right font-medium">Util</th>
              <th className="px-3 py-2 text-right font-medium">Borrow APY</th>
              <th className="px-3 py-2 text-right font-medium">In 7d at this util</th>
              <th className="px-3 py-2 text-right font-medium">Top borrower</th>
            </tr>
          </thead>
          <tbody>
            {credit.markets.map((market) => (
              <MarketRow key={market.marketId} market={market} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 border-t border-line px-3 py-3 *:min-w-0 lg:grid-cols-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-faint">Loopback borrow APY and utilization · 14d hourly</p>
          <Sparkline
            floor={0}
            series={[{ label: 'Borrow APY', className: 'stroke-rose', values: history.map((point) => point.borrowApy) }]}
          />
          <Sparkline
            series={[{ label: 'Utilization', className: 'stroke-amber', values: history.map((point) => point.utilization) }]}
          />
          <p className="text-[11px] text-muted">
            <span className="text-rose">Borrow APY</span> {rangeText(history.map((point) => point.borrowApy), formatApy)} ·{' '}
            <span className="text-amber">utilization</span> {rangeText(history.map((point) => point.utilization), formatRatio)}
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-faint">Loopback USDG supplied · daily</p>
          <Sparkline floor={0} series={[{ label: 'Supply', className: 'stroke-cyan', values: credit.loopback.supplyDaily.map((point) => point.supplyUsdg) }]} />
          <p className="text-[11px] text-muted">{supplyTrend(credit)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-faint">Risks</p>
          <ul className="mt-1.5 space-y-1.5 text-xs leading-relaxed">
            {risks.map((risk) => (
              <li
                key={risk.text}
                className={cx(
                  'border-l pl-2',
                  risk.tone === 'rose' ? 'border-rose text-rose' : risk.tone === 'amber' ? 'border-amber text-amber' : 'border-line text-muted',
                )}
              >
                {risk.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function MarketRow({ market }: { market: CreditMarket }) {
  const projected = projectedBorrowApy(market.rateAtTargetApr, market.utilization, 7)
  const top = market.topBorrowers[0]
  const topShare = top && market.borrowUsdg > 0 ? top.borrowUsdg / market.borrowUsdg : null
  const isLoop = market.marketId === ADDRESSES.marketId
  const dust = market.supplyUsdg < 1_000
  return (
    <tr className={cx('border-t border-line/80', isLoop && 'bg-amber/5', dust && 'opacity-50')} title={dust ? 'Under $1k supplied. Rates here are noise.' : undefined}>
      <td className="px-3 py-1.5">
        <span className={cx('text-ink', isLoop && 'text-amber')}>{market.collateral}</span>
        <span className="ml-1.5 text-[11px] text-faint">{formatRatio(market.lltv)} LLTV</span>
      </td>
      <td className="num px-3 py-1.5 text-right">
        {formatUsd(market.allocatedUsdg, true)} <span className="text-faint">/ {formatUsd(market.capUsdg, true)}</span>
      </td>
      <td className="num px-3 py-1.5 text-right">{formatUsd(market.supplyUsdg, true)}</td>
      <td className={cx('num px-3 py-1.5 text-right', market.liquidityUsdg < 1_000 && market.supplyUsdg > 1_000 && 'text-rose')}>
        {formatUsd(market.liquidityUsdg, true)}
      </td>
      <td className={cx('num px-3 py-1.5 text-right', market.utilization > 0.98 ? 'text-rose' : market.utilization > TARGET_UTILIZATION ? 'text-amber' : 'text-muted')}>
        {formatRatio(market.utilization)}
      </td>
      <td className="num px-3 py-1.5 text-right">{formatApy(market.borrowApy)}</td>
      <td className={cx('num px-3 py-1.5 text-right', !dust && projected > market.borrowApy * 1.5 ? 'text-rose' : 'text-muted')}>
        {dust ? '—' : formatApy(projected)}
      </td>
      <td className="px-3 py-1.5 text-right text-[11px] text-muted">
        {top ? (
          <>
            <span className="num text-ink">{topShare === null ? '—' : formatRatio(topShare)}</span> {shortAddress(top.address)}
            {market.borrowers !== null ? <span className="text-faint"> · {market.borrowers} borrowers</span> : null}
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  )
}

function Cell({ label, value, hint, tone = 'ink' }: { label: string; value: string; hint: ReactNode; tone?: 'ink' | 'rose' | 'amber' }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className={cx('num mt-1 text-base', tone === 'rose' ? 'text-rose' : tone === 'amber' ? 'text-amber' : 'text-ink')}>{value}</dd>
      <dd className="text-[11px] leading-snug text-muted">{hint}</dd>
    </div>
  )
}

function rangeText(values: number[], format: (value: number) => string): string {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return '—'
  return `${format(Math.min(...finite))} → ${format(finite[finite.length - 1]!)} (max ${format(Math.max(...finite))})`
}

function supplyTrend(credit: CreditBook): string {
  const daily = credit.loopback.supplyDaily
  const last = daily[daily.length - 1]
  const weekAgo = daily.find((point) => point.t >= (last?.t ?? 0) - 7 * 86_400_000)
  const peak = daily.reduce((best, point) => (point.supplyUsdg > best ? point.supplyUsdg : best), 0)
  if (!last || !weekAgo || weekAgo.supplyUsdg <= 0) return 'Supply history unavailable.'
  const change = last.supplyUsdg / weekAgo.supplyUsdg - 1
  return `${formatUsd(last.supplyUsdg, true)} now · ${change >= 0 ? '+' : ''}${formatRatio(change)} vs 7d ago · peak ${formatUsd(peak, true)}`
}

function creditRisks(credit: CreditBook, loop: CreditMarket | null): Risk[] {
  const { vault } = credit
  const risks: Risk[] = []
  const withdrawShare = vault.totalAssetsUsdg > 0 ? vault.liquidityUsdg / vault.totalAssetsUsdg : 1
  if (withdrawShare < 0.05) {
    risks.push({
      tone: 'rose',
      text: `Exit liquidity: only ${formatUsd(vault.liquidityUsdg)} of ${formatUsd(vault.totalAssetsUsdg)} can leave the vault now. Withdrawals wait until borrowers repay or new USDG arrives.`,
    })
  }
  const pinned = credit.markets.filter((market) => market.supplyUsdg > 1_000 && market.utilization > 0.98)
  if (pinned.length > 0) {
    risks.push({
      tone: 'rose',
      text: `${pinned.length} of ${credit.markets.filter((market) => market.supplyUsdg > 1_000).length} funded markets sit above 98% utilization (${pinned.map((market) => market.collateral).join(', ')}). The vault has nothing idle to move into Loopback.`,
    })
  }
  if (loop && loop.utilization > TARGET_UTILIZATION) {
    const in7 = projectedBorrowApy(loop.rateAtTargetApr, loop.utilization, 7)
    const to500 = daysUntilBorrowApr(loop.rateAtTargetApr, loop.utilization, Math.log1p(5))
    const tail = to500 === null ? '' : to500 === 0 ? ' It is already above 500%.' : ` It passes 500% in ${formatDays(to500)}.`
    risks.push({
      tone: loop.utilization > 0.98 ? 'rose' : 'amber',
      text: `Rate spiral: above 90% utilization the curve keeps raising its target rate. If Loopback stays at ${formatRatio(loop.utilization)}, borrow APY goes from ${formatApy(loop.borrowApy)} to ${formatApy(in7)} in 7 days.${tail} Before that, borrowers repay or new suppliers arrive. Either way the book moves.`,
    })
  }
  const exposure = credit.exposures[0]
  if (exposure && exposure.share > 0.25) {
    risks.push({
      tone: 'amber',
      text: `Borrower concentration: ${shortAddress(exposure.address)} owes about ${formatUsd(exposure.vaultUsdg, true)} of vault money (${formatRatio(exposure.share)}) across ${exposure.markets.join(', ')}. The docs say the main borrower is the manager’s own RWA Sleeve at ~40% LTV.`,
    })
  }
  const topTwo = vault.topDepositors.slice(0, 2).reduce((sum, row) => sum + row.usdg, 0)
  if (vault.totalAssetsUsdg > 0 && topTwo / vault.totalAssetsUsdg > 0.4) {
    risks.push({
      tone: 'amber',
      text: `Depositor concentration: two addresses hold ${formatRatio(topTwo / vault.totalAssetsUsdg)} of nnUSDG. One exit request is bigger than all free liquidity.`,
    })
  }
  if (vault.maxApy > 0.2 + 1e-6) {
    risks.push({
      tone: 'muted',
      text: `Docs quote a 20% rate ceiling. On-chain maxRate lets the share price grow up to ${formatApy(vault.maxApy)} a year; the vault now accrues ${formatApy(vault.apy)} gross.`,
    })
  }
  const badDebt = credit.markets.reduce((sum, market) => sum + market.badDebtUsdg, 0)
  risks.push({
    tone: badDebt > 0 ? 'rose' : 'muted',
    text: badDebt > 0 ? `Bad debt on record: ${formatUsd(badDebt)}.` : 'No bad debt recorded in any vault market. Curator changes wait out a 3-day timelock (docs).',
  })
  return risks
}
