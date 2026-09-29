import { useMemo, type ReactNode } from 'react'
import type { Exposure } from '../adapters/credit.ts'
import {
  CLASS_LABEL,
  LABEL_TONE,
  holderStats,
  labelClass,
  netMovers,
  overlap,
  segmentTotals,
  smartTape,
  type NansenSnapshot,
  type NetMover,
} from '../lib/flows.ts'
import { cx, formatCount, formatRatio, formatSignedUsd, formatUsd, formatWarsaw, shortAddress } from '../lib/format.ts'

export function FlowsPanel({
  snapshot,
  error,
  borrowers,
  exposures,
}: {
  snapshot: NansenSnapshot | null
  error: string | null
  borrowers: string[]
  exposures: Exposure[]
}) {
  const view = useMemo(() => {
    if (!snapshot) return null
    const movers = netMovers(snapshot.buyers ?? [], snapshot.sellers ?? [])
    return {
      movers,
      segments: segmentTotals(movers),
      tape: smartTape(snapshot.smartTrades ?? []),
      holders: holderStats(snapshot.holders ?? [], snapshot.info?.totalSupply ?? null),
      borrowerOverlap: overlap(borrowers, movers),
    }
  }, [snapshot, borrowers])

  if (!snapshot || !view) {
    return (
      <section aria-label="Holder flows" className="rounded-md border border-line bg-panel px-3 py-3 text-sm text-muted">
        {error ? `Nansen data unavailable. ${error}` : 'Reading Nansen holder and flow data…'}
      </section>
    )
  }

  const borrowerSet = new Set(borrowers.map((address) => address.toLowerCase()))
  const vaultBorrowers = new Set(exposures.filter((row) => row.share > 0.05).map((row) => row.address.toLowerCase()))
  const tagsFor = (address: string): string[] => {
    const key = address.toLowerCase()
    const tags: string[] = []
    if (vaultBorrowers.has(key)) tags.push('credit-vault borrower')
    if (borrowerSet.has(key)) tags.push('Loopback borrower')
    return tags
  }
  const { info, flow1d, flow7d } = snapshot
  const netVolume = info?.buyVolumeUsd != null && info.sellVolumeUsd != null ? info.buyVolumeUsd - info.sellVolumeUsd : null
  const buyers = [...view.movers].sort((a, b) => b.netUsd - a.netUsd).filter((row) => row.netUsd > 0).slice(0, 8)
  const sellers = [...view.movers].sort((a, b) => a.netUsd - b.netUsd).filter((row) => row.netUsd < 0).slice(0, 8)
  const smartHeld = (snapshot.smartHolders ?? []).reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const smartHeld7d = (snapshot.smartHolders ?? []).reduce((sum, row) => sum + (row.change7d ?? 0), 0)
  const accumulators = view.tape.traders.filter((row) => row.netUsd > 0).slice(0, 5)
  const distributors = [...view.tape.traders].reverse().filter((row) => row.netUsd < 0).slice(0, 5)

  return (
    <section aria-label="Holder flows" className="rounded-md border border-line bg-panel" data-testid="flows-panel">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-faint">Holders and flows · Nansen · NET</h2>
          <p className="mt-1 text-sm text-ink">Who is buying and selling NET this week, and what smart money does.</p>
        </div>
        <p className={cx('text-xs', snapshot.stale ? 'text-amber' : 'text-muted')}>
          {snapshot.stale ? 'Stale · ' : ''}read {formatWarsaw(snapshot.fetchedAt).replace(' Europe/Warsaw', '')} · refreshes every {snapshot.ttlMinutes}m
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
        <Cell label="Holders" value={formatCount(info?.holders ?? null)} hint={`${formatCount(info?.uniqueBuyers ?? null)} buyers · ${formatCount(info?.uniqueSellers ?? null)} sellers, 7d`} />
        <Cell
          label="DEX net, 7d"
          value={formatSignedUsd(netVolume)}
          hint={`${formatUsd(info?.buyVolumeUsd ?? null, true)} bought · ${formatUsd(info?.sellVolumeUsd ?? null, true)} sold`}
          tone={netVolume === null ? 'ink' : netVolume >= 0 ? 'mint' : 'rose'}
        />
        <Cell
          label="Staking pool"
          value={view.holders.stakingShare === null ? '—' : formatRatio(view.holders.stakingShare)}
          hint={`of supply · ${view.holders.stakingChange7d === null ? '—' : `${view.holders.stakingChange7d >= 0 ? '+' : ''}${Math.round(view.holders.stakingChange7d).toLocaleString('en-US')} NET`} 7d`}
        />
        <Cell
          label="Smart money net"
          value={formatSignedUsd(flow7d?.smart.netUsd ?? null)}
          hint={`7d, ${formatCount(flow7d?.smart.wallets ?? null)} wallets · 1d ${formatSignedUsd(flow1d?.smart.netUsd ?? null)}`}
          tone={toneOf(flow7d?.smart.netUsd)}
        />
        <Cell
          label="Public figures net"
          value={formatSignedUsd(flow7d?.publicFigure.netUsd ?? null)}
          hint={`7d, ${formatCount(flow7d?.publicFigure.wallets ?? null)} wallets · top-PnL ${formatSignedUsd(flow7d?.topPnl.netUsd ?? null)}`}
          tone={toneOf(flow7d?.publicFigure.netUsd)}
        />
        <Cell
          label="Smart money holds"
          value={`${smartHeld.toFixed(1)} NET`}
          hint={`${snapshot.smartHolders?.length ?? 0} wallets · ${smartHeld7d >= 0 ? '+' : ''}${smartHeld7d.toFixed(1)} NET 7d`}
        />
      </dl>

      <div className="border-t border-line px-3 py-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-faint">Top 100 buyers and sellers by label, 7d</p>
        <table className="mt-1.5 w-full text-left text-xs">
          <thead className="text-faint">
            <tr>
              <th className="py-1 font-normal">Group</th>
              <th className="py-1 text-right font-normal">Wallets</th>
              <th className="py-1 text-right font-normal">Bought</th>
              <th className="py-1 text-right font-normal">Sold</th>
              <th className="py-1 text-right font-normal">Net</th>
            </tr>
          </thead>
          <tbody className="num">
            {view.segments.map((row) => (
              <tr key={row.key} className="border-t border-line/60">
                <td className="py-1 font-sans text-ink">{CLASS_LABEL[row.key]}</td>
                <td className="py-1 text-right">{row.wallets}</td>
                <td className="py-1 text-right">{formatUsd(row.boughtUsd, true)}</td>
                <td className="py-1 text-right">{formatUsd(row.soldUsd, true)}</td>
                <td className={cx('py-1 text-right', row.netUsd >= 0 ? 'text-mint' : 'text-rose')}>{formatSignedUsd(row.netUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 border-t border-line px-3 py-3 *:min-w-0 sm:grid-cols-2">
        <MoverList title="Top net buyers, 7d" rows={buyers} tagsFor={tagsFor} />
        <MoverList title="Top net sellers, 7d" rows={sellers} tagsFor={tagsFor} />
      </div>

      <div className="border-t border-line px-3 py-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-faint">Smart-money DEX trades, 7d</p>
        <p className="mt-1 text-sm text-ink">
          {view.tape.traders.length} wallets bought {formatUsd(view.tape.boughtUsd, true)} and sold {formatUsd(view.tape.soldUsd, true)}:{' '}
          <span className={view.tape.boughtUsd >= view.tape.soldUsd ? 'text-mint' : 'text-rose'}>
            {formatSignedUsd(view.tape.boughtUsd - view.tape.soldUsd)}
          </span>
          {view.tape.trades >= 200 ? <span className="text-xs text-faint"> (first 200 trades only)</span> : null}
        </p>
        <div className="mt-2 grid gap-3 *:min-w-0 sm:grid-cols-2">
          <TraderList title="Adding" rows={accumulators} tagsFor={tagsFor} />
          <TraderList title="Cutting" rows={distributors} tagsFor={tagsFor} />
        </div>
      </div>

      <ul className="space-y-1.5 border-t border-line px-3 py-3 text-xs leading-relaxed text-muted">
        <li className="border-l border-line pl-2">
          Loopback borrowers this week: {view.borrowerOverlap.buyers} in the net-buyer lists ({formatUsd(view.borrowerOverlap.buyUsd, true)}),{' '}
          {view.borrowerOverlap.sellers} in the net-seller lists ({formatUsd(view.borrowerOverlap.sellUsd, true)}).{' '}
          {view.borrowerOverlap.buyUsd >= view.borrowerOverlap.sellUsd ? 'Levered holders are net adding.' : 'Levered holders are net selling.'}
        </li>
        <li className="border-l border-line pl-2">
          Free float is about {view.holders.freeFloat === null ? '—' : `${Math.round(view.holders.freeFloat).toLocaleString('en-US')} NET`}. The ten largest non-pool holders own{' '}
          {view.holders.top10FreeShare === null ? '—' : formatRatio(view.holders.top10FreeShare)} of it. In the top 300, {view.holders.grew7d} addresses grew and{' '}
          {view.holders.shrank7d} shrank this week.
        </li>
        <li className="border-l border-line pl-2">
          Labels are Nansen’s. “Smart money” means 🤓 labels. Most volume comes from unlabeled wallets. The staking pool trades too, so its buys and sells are protocol flow, not a holder.
        </li>
        {snapshot.errors.length > 0 ? <li className="border-l border-amber pl-2 text-amber">Partial read: {snapshot.errors.join('; ')}</li> : null}
      </ul>
    </section>
  )
}

function toneOf(value: number | null | undefined): 'ink' | 'mint' | 'rose' {
  if (value == null || !Number.isFinite(value)) return 'ink'
  return value >= 0 ? 'mint' : 'rose'
}

function MoverList({ title, rows, tagsFor }: { title: string; rows: NetMover[]; tagsFor: (address: string) => string[] }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-faint">{title}</p>
      <ul className="mt-1 space-y-1 text-xs">
        {rows.length === 0 ? <li className="text-muted">None in the top 100.</li> : null}
        {rows.map((row) => (
          <li key={row.address} className="flex items-baseline justify-between gap-2">
            <Who address={row.address} label={row.label} tags={tagsFor(row.address)} />
            <span className={cx('num shrink-0', row.netUsd >= 0 ? 'text-mint' : 'text-rose')}>{formatSignedUsd(row.netUsd)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TraderList({
  title,
  rows,
  tagsFor,
}: {
  title: string
  rows: Array<{ address: string; label: string | null; netUsd: number; trades: number }>
  tagsFor: (address: string) => string[]
}) {
  return (
    <div>
      <p className="text-[11px] text-faint">{title}</p>
      <ul className="mt-1 space-y-1 text-xs">
        {rows.length === 0 ? <li className="text-muted">None.</li> : null}
        {rows.map((row) => (
          <li key={row.address} className="flex items-baseline justify-between gap-2">
            <Who address={row.address} label={row.label} tags={tagsFor(row.address)} />
            <span className={cx('num shrink-0', row.netUsd >= 0 ? 'text-mint' : 'text-rose')}>
              {formatSignedUsd(row.netUsd)} <span className="text-faint">· {row.trades}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Who({ address, label, tags }: { address: string; label: string | null; tags: string[] }) {
  const kind = labelClass(label)
  return (
    <span className="min-w-0 truncate">
      <a className="num text-cyan hover:underline" href={`https://robinhoodchain.blockscout.com/address/${address}`} target="_blank" rel="noreferrer">
        {shortAddress(address)}
      </a>
      {tags.map((tag) => (
        <span key={tag} className="ml-1.5 rounded border border-amber/50 px-1 text-[10px] text-amber">
          {tag}
        </span>
      ))}
      {label ? <span className={cx('ml-1.5', LABEL_TONE[kind ?? 'other'])}>{label}</span> : null}
    </span>
  )
}

function Cell({ label, value, hint, tone = 'ink' }: { label: string; value: string; hint: ReactNode; tone?: 'ink' | 'rose' | 'mint' }) {
  const color = { ink: 'text-ink', rose: 'text-rose', mint: 'text-mint' }[tone]
  return (
    <div className="bg-panel px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className={cx('num mt-1 text-base', color)}>{value}</dd>
      <dd className="text-[11px] leading-snug text-muted">{hint}</dd>
    </div>
  )
}
