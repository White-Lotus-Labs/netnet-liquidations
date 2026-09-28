import { useEffect, useMemo, useRef, useState } from 'react'
import { ADDRESSES, LINKS, POLL_MS } from './config.ts'
import { loadDesk } from './adapters/loadDesk.ts'
import { BookHeader } from './components/BookHeader.tsx'
import { BuyCallout } from './components/BuyCallout.tsx'
import { CascadePanel } from './components/CascadePanel.tsx'
import { Ladder } from './components/Ladder.tsx'
import { OracleStrip } from './components/OracleStrip.tsx'
import { describeBuyZone } from './lib/buyZone.ts'
import { formatAge, formatUsdg, formatWarsaw, cx } from './lib/format.ts'
import { buildScenario, enrichPositions, facilityStats, scenarioLabel, weakestRunway, type ScenarioId } from './lib/model.ts'
import { sampleDesk } from './mock/sampleDesk.ts'
import type { Desk } from './types.ts'

export default function App() {
  const [desk, setDesk] = useState<Desk | null>(null)
  const [stale, setStale] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [scenario, setScenario] = useState<ScenarioId>('hf105')
  const [customInput, setCustomInput] = useState('25000')
  const [refreshKey, setRefreshKey] = useState(0)
  const modeRef = useRef<'loading' | 'live' | 'mock'>('loading')

  useEffect(() => {
    let cancelled = false
    const holder = { controller: new AbortController() }

    async function run() {
      holder.controller.abort()
      holder.controller = new AbortController()
      const signal = holder.controller.signal
      try {
        const next = await loadDesk(signal)
        if (cancelled || signal.aborted) return
        modeRef.current = 'live'
        setDesk(next)
        setStale(null)
        setLoading(false)
      } catch (error) {
        if (cancelled || signal.aborted) return
        const message = error instanceof Error ? error.message : 'Fetch failed'
        if (modeRef.current === 'live') {
          setStale(message)
        } else {
          modeRef.current = 'mock'
          setDesk(sampleDesk(message))
          setStale(null)
        }
        setLoading(false)
      }
    }

    void run()
    const timer = window.setInterval(() => void run(), POLL_MS)
    return () => {
      cancelled = true
      holder.controller.abort()
      window.clearInterval(timer)
    }
  }, [refreshKey])

  const rows = useMemo(() => (desk ? enrichPositions(desk) : []), [desk])
  const copy = useMemo(() => {
    if (!desk) return null
    const customDebt = parseDebt(customInput)
    const model = buildScenario(desk, rows, scenario, customDebt)
    return describeBuyZone({
      label: scenarioLabel(scenario),
      model,
      desk,
      facilityMultiple: facilityStats(desk).multiple,
      runwayDays: weakestRunway(rows),
    })
  }, [desk, rows, scenario, customInput])

  const age =
    desk?.blockTimestamp != null ? Math.max(0, Math.round(desk.fetchedAt / 1000) - desk.blockTimestamp) : null

  return (
    <div className="min-h-svh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-3 px-4 py-4 md:px-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber">NetNet · Robinhood Chain 4663</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-ink">Loopback buy zones</h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Where a wsNET/USDG margin call is likely to print in the canonical NET pool. Built for sizing bids into that supply.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 text-xs text-muted sm:items-end">
            <span className="flex items-center gap-2">
              <span
                className={cx(
                  'rounded border px-2 py-0.5 uppercase tracking-[0.14em]',
                  desk?.mode === 'live' ? 'border-mint/50 text-mint' : 'border-rose/60 text-rose',
                )}
                data-testid="mode-badge"
              >
                {loading && !desk ? 'Loading' : desk?.mode === 'live' ? 'Live' : 'Sample'}
              </span>
              <button
                type="button"
                className="rounded border border-line px-2 py-0.5 text-ink hover:border-amber"
                onClick={() => setRefreshKey((key) => key + 1)}
              >
                Refresh
              </button>
            </span>
            <span className="num">{desk ? formatWarsaw(desk.fetchedAt) : '—'}</span>
            <span>
              {desk?.blockNumber ? `Block ${desk.blockNumber.toLocaleString('en-US')}` : 'Block unavailable'}
              {age !== null ? ` · ${formatAge(age)}` : ''}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-4 py-4 md:px-6">
        {loading && !desk ? <Loading /> : null}
        {desk?.mode === 'mock' ? (
          <p className="mb-3 rounded border border-rose/50 bg-rose/10 px-3 py-2 text-sm text-rose" data-testid="mock-banner">
            {desk.warnings[0]}
          </p>
        ) : null}
        {stale ? (
          <p className="mb-3 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
            Refresh failed. Still showing the last live book. {stale}
          </p>
        ) : null}
        {desk && desk.mode === 'live' && desk.warnings.length > 0 ? (
          <ul className="mb-3 space-y-1 text-xs text-amber">
            {desk.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}

        {desk && copy ? (
          <>
            <BookHeader desk={desk} />
            <OracleStrip desk={desk} runwayDays={weakestRunway(rows)} />
            <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
              <Ladder rows={rows} borrowerCount={desk.borrowerCount} />
              <CascadePanel
                desk={desk}
                rows={rows}
                scenario={scenario}
                onScenario={setScenario}
                customInput={customInput}
                onCustom={setCustomInput}
              />
            </div>
            <BuyCallout copy={copy} />
            <footer className="mt-6 space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-faint">
              <p>
                Market {short(ADDRESSES.marketId)} · oracle {short(ADDRESSES.oracle)} · pair {short(ADDRESSES.pair)}. Polls every{' '}
                {Math.round(POLL_MS / 1000)}s. No wallet, no orders.
              </p>
              <p className="flex flex-wrap gap-x-3 gap-y-1">
                <FooterLink href={LINKS.morphoMarket}>Morpho market</FooterLink>
                <FooterLink href={LINKS.netnet}>NetNet app</FooterLink>
                <FooterLink href={LINKS.lendingDocs}>Lending docs</FooterLink>
                <FooterLink href={LINKS.creditDocs}>Credit docs</FooterLink>
                <FooterLink href={LINKS.pairExplorer}>Pool</FooterLink>
                <FooterLink href={LINKS.oracleExplorer}>Oracle</FooterLink>
              </p>
              {desk.footnote?.borrowRaw != null ? (
                <p>
                  Footnote: the 38.5% LLTV twin market is separate and tiny here (
                  {formatUsdg(desk.footnote.borrowRaw, 0)} USDG borrowed). It is not in the ladder.
                </p>
              ) : null}
            </footer>
          </>
        ) : null}
      </main>
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-3" data-testid="loading">
      <div className="grid gap-2 sm:grid-cols-3">
        {['a', 'b', 'c'].map((key) => (
          <div key={key} className="h-20 animate-pulse rounded-md border border-line bg-panel" />
        ))}
      </div>
      <p className="text-sm text-muted">Reading Morpho, the Loopback oracle, and the NET/USDG pool…</p>
    </div>
  )
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="text-cyan hover:underline" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

function short(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function parseDebt(input: string): bigint {
  const cleaned = input.replace(/,/g, '').trim()
  if (!/^\d+(\.\d{0,6})?$/.test(cleaned)) return 0n
  const [whole, frac = ''] = cleaned.split('.')
  return BigInt(whole) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6))
}
