import { useMemo } from 'react'
import { CLASS_LABEL, holderStats, netMovers, overlap, segmentTotals, smartTape, type NansenSnapshot } from '../lib/flows.ts'
import { cx, formatClock, formatCount, formatRatio, formatSignedUsd, formatUsd } from '../lib/format.ts'
import { Details, Fresh, Kpi, KpiRow, Section, Who } from './ui.tsx'

type Row = { address: string; label: string | null; netUsd: number }

export function FlowsPanel({
  snapshot,
  error,
  borrowers,
  vaultBorrowers,
}: {
  snapshot: NansenSnapshot | null
  error: string | null
  borrowers: Set<string>
  vaultBorrowers: Set<string>
}) {
  const view = useMemo(() => {
    if (!snapshot) return null
    const movers = netMovers(snapshot.buyers ?? [], snapshot.sellers ?? [])
    return {
      movers,
      // Smart money comes from flow-intelligence only; the top-100 row would be a second, disagreeing number.
      segments: segmentTotals(movers).filter((row) => row.key !== 'smart'),
      tape: smartTape(snapshot.smartTrades ?? []),
      holders: holderStats(snapshot.holders ?? [], snapshot.info?.totalSupply ?? null),
      levered: overlap(borrowers, movers),
    }
  }, [snapshot, borrowers])

  const head = { id: 'flows', testId: 'flows-panel', seal: '流', eyebrow: 'NET holders · Nansen', title: 'DEX', accent: 'flows', meta: <>Powered by <strong>Nansen</strong></> }

  if (!snapshot || !view) {
    return (
      <Section {...head} fresh={<Fresh state={error ? 'offline' : 'loading'}>{error ? 'Nansen research is offline.' : 'Loading saved Nansen readings…'}</Fresh>}>
        {null}
      </Section>
    )
  }

  const tagsFor = (address: string): string[] => {
    const key = address.toLowerCase()
    const tags: string[] = []
    if (vaultBorrowers.has(key)) tags.push('Credit-vault borrower')
    if (borrowers.has(key)) tags.push('Loopback borrower')
    return tags
  }
  const { info, flow1d, flow7d } = snapshot
  const dexNet = info?.buyVolumeUsd != null && info.sellVolumeUsd != null ? info.buyVolumeUsd - info.sellVolumeUsd : null
  const buyers = [...view.movers].sort((a, b) => b.netUsd - a.netUsd).filter((row) => row.netUsd > 0).slice(0, 5)
  const sellers = [...view.movers].sort((a, b) => a.netUsd - b.netUsd).filter((row) => row.netUsd < 0).slice(0, 5)
  const smartHeld7d = (snapshot.smartHolders ?? []).reduce((sum, row) => sum + (row.change7d ?? 0), 0)
  const adding = view.tape.traders.filter((row) => row.netUsd > 0).slice(0, 3)
  const cutting = [...view.tape.traders].reverse().filter((row) => row.netUsd < 0).slice(0, 3)
  // The staking pool and protocol contracts trade too, but they are not holders.
  const ranked = view.segments.filter((row) => row.key !== 'staking' && row.key !== 'protocol').sort((a, b) => b.netUsd - a.netUsd)
  const top = ranked[0]
  const bottom = ranked[ranked.length - 1]
  const answer = [
    top && top.netUsd > 0 ? `${CLASS_LABEL[top.key]} net-bought the most in 7d (${formatSignedUsd(top.netUsd)}).` : '',
    bottom && bottom.netUsd < 0 ? `${CLASS_LABEL[bottom.key]} net-sold the most (${formatSignedUsd(bottom.netUsd)}).` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const levered = view.levered.buyUsd - view.levered.sellUsd

  return (
    <Section
      {...head}
      fresh={
        <Fresh state="live" stale={snapshot.stale || error !== null}>
          Saved Nansen readings · updated {formatClock(snapshot.fetchedAt)}
        </Fresh>
      }
      answer={answer || null}
    >
      <KpiRow cols={3}>
        <Kpi
          lead
          label="Smart money net · 7d"
          value={formatSignedUsd(flow7d?.smart.netUsd ?? null)}
          tone={toneOf(flow7d?.smart.netUsd)}
          hint={`${formatCount(flow7d?.smart.wallets ?? null)} wallets · 1d ${formatSignedUsd(flow1d?.smart.netUsd ?? null)} · holdings ${signed(smartHeld7d)} NET`}
        />
        <Kpi
          label="DEX net · 7d"
          value={formatSignedUsd(dexNet)}
          tone={toneOf(dexNet)}
          hint={`${formatUsd(info?.buyVolumeUsd ?? null, true)} bought · ${formatUsd(info?.sellVolumeUsd ?? null, true)} sold`}
        />
        <Kpi
          label="Loopback borrowers · 7d"
          value={formatSignedUsd(levered)}
          tone={toneOf(levered)}
          hint={`${view.levered.buyers} buying · ${view.levered.sellers} selling in the top 100`}
        />
      </KpiRow>

      {adding.length + cutting.length > 0 ? (
        <div className="mt-3 grid gap-3 *:min-w-0 sm:grid-cols-2">
          <List title="Smart money adding" rows={adding} tagsFor={tagsFor} />
          <List title="Smart money cutting" rows={cutting} tagsFor={tagsFor} />
        </div>
      ) : null}

      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Top 100 wallets by label · 7d</p>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-[420px] text-left text-[13px]">
          <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            <tr className="border-b border-line">
              <th className="py-1.5 font-semibold">Group</th>
              <th className="py-1.5 text-right font-semibold">Wallets</th>
              <th className="py-1.5 text-right font-semibold">Bought</th>
              <th className="py-1.5 text-right font-semibold">Sold</th>
              <th className="py-1.5 text-right font-semibold">Net</th>
            </tr>
          </thead>
          <tbody className="num">
            {view.segments.map((row) => (
              <tr key={row.key} className="border-b border-line last:border-b-0">
                <td className="py-1.5 text-ink">{CLASS_LABEL[row.key]}</td>
                <td className="py-1.5 text-right">{row.wallets}</td>
                <td className="py-1.5 text-right">{formatUsd(row.boughtUsd, true)}</td>
                <td className="py-1.5 text-right">{formatUsd(row.soldUsd, true)}</td>
                <td className={cx('py-1.5 text-right font-semibold', row.netUsd >= 0 ? 'text-up' : 'text-seal')}>{formatSignedUsd(row.netUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 *:min-w-0 sm:grid-cols-2">
        <List title="Top net buyers · 7d" rows={buyers} tagsFor={tagsFor} />
        <List title="Top net sellers · 7d" rows={sellers} tagsFor={tagsFor} />
      </div>

      {snapshot.errors.length > 0 ? <p className="mt-3 text-xs text-warn">Partial read: {snapshot.errors.join('; ')}</p> : null}

      <Details summary="Holders and float">
        <KpiRow>
          <Kpi label="Holders" value={formatCount(info?.holders ?? null)} />
          <Kpi
            label="Staking pool"
            value={formatRatio(view.holders.stakingShare)}
            hint={`of supply · ${view.holders.stakingChange7d === null ? '—' : signed(view.holders.stakingChange7d)} NET 7d`}
          />
          <Kpi label="Free float" value={view.holders.freeFloat === null ? '—' : `${Math.round(view.holders.freeFloat).toLocaleString('en-US')} NET`} />
          <Kpi
            label="Top 10 of float"
            value={formatRatio(view.holders.top10FreeShare)}
            hint={`${view.holders.grew7d} grew · ${view.holders.shrank7d} shrank in 7d`}
          />
        </KpiRow>
      </Details>
    </Section>
  )
}

function toneOf(value: number | null | undefined): 'up' | 'down' | undefined {
  if (value == null || !Number.isFinite(value) || value === 0) return undefined
  return value > 0 ? 'up' : 'down'
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}`
}

function List({ title, rows, tagsFor }: { title: string; rows: Row[]; tagsFor: (address: string) => string[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      <ul className="mt-1 text-[13px]">
        {rows.length === 0 ? <li className="py-1.5 text-muted">None.</li> : null}
        {rows.map((row) => (
          <li key={row.address} className="flex items-center justify-between gap-3 border-b border-line py-1.5 last:border-b-0">
            <Who address={row.address} label={row.label} tags={tagsFor(row.address)} />
            <span className={cx('num shrink-0 font-semibold', row.netUsd >= 0 ? 'text-up' : 'text-seal')}>{formatSignedUsd(row.netUsd)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
