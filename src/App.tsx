import { useEffect, useMemo, useRef, useState } from 'react'
import { ADDRESSES, LINKS, NANSEN_ROUTE, POLL_MS } from './config.ts'
import { readCredit } from './adapters/credit.ts'
import { loadDesk } from './adapters/loadDesk.ts'
import { readPendle } from './adapters/pendle.ts'
import { QUOTE_RUNGS_NET, loadQuotes, quoteBookSnapshot, rungRaw } from './adapters/quotes.ts'
import { BookHeader } from './components/BookHeader.tsx'
import { BuyCallout } from './components/BuyCallout.tsx'
import { CascadePanel } from './components/CascadePanel.tsx'
import { CreditPanel } from './components/CreditPanel.tsx'
import { FlowsPanel } from './components/FlowsPanel.tsx'
import { Ladder } from './components/Ladder.tsx'
import { OracleStrip } from './components/OracleStrip.tsx'
import { PendlePanel } from './components/PendlePanel.tsx'
import { describeBuyZone } from './lib/buyZone.ts'
import { labelMap, type NansenSnapshot } from './lib/flows.ts'
import { formatAge, formatUsdg, formatWarsaw, cx } from './lib/format.ts'
import { buildScenario, enrichPositions, facilityStats, scenarioLabel, weakestRunway, type ScenarioId } from './lib/model.ts'
import { emptyBook, type QuoteBook } from './lib/quoteBook.ts'
import { stressDesk } from './seed/stressDesk.ts'
import type { Desk } from './types.ts'

export default function App() {
  const [desk, setDesk] = useState<Desk>(() => stressDesk())
  const [stale, setStale] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [scenario, setScenario] = useState<ScenarioId>('hf105')
  const [customInput, setCustomInput] = useState('25000')
  const [refreshKey, setRefreshKey] = useState(0)
  const [book, setBook] = useState<QuoteBook | null>(null)
  const modeRef = useRef<'seed' | 'live' | 'mock'>('seed')
  const credit = usePolled(readCredit, CONTEXT_POLL_MS, refreshKey)
  const pendle = usePolled(readPendle, CONTEXT_POLL_MS, refreshKey)
  const nansen = usePolled(readNansen, NANSEN_POLL_MS, refreshKey)
  const labels = useMemo(() => labelMap(nansen.data), [nansen.data])
  const borrowers = useMemo(() => desk.positions.map((position) => position.address), [desk])

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
        setSeedError(null)
        setLoading(false)
      } catch (error) {
        if (cancelled || signal.aborted) return
        const message = error instanceof Error ? error.message : 'Fetch failed'
        if (modeRef.current === 'live') {
          setStale(message)
        } else {
          setSeedError(message)
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
  const flowNet = useMemo(() => {
    if (!desk) return 0n
    return buildScenario(desk, rows, scenario, parseDebt(customInput)).flowNetRaw ?? 0n
  }, [desk, rows, scenario, customInput])

  const shownBook = useMemo(() => {
    if (desk?.mode === 'mock') {
      return emptyBook('Sample book. Router quotes are not applied to illustration borrowers.')
    }
    if (book === null) return emptyBook(null, 'loading')
    return book
  }, [desk, book])

  useEffect(() => {
    if (!desk || desk.mode === 'mock') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const sizes = QUOTE_RUNGS_NET.map((whole) => rungRaw(whole))
      if (flowNet > 0n) sizes.push(flowNet)
      void loadQuotes(desk.fetchedAt, sizes, controller.signal)
        .then(() => {
          if (!controller.signal.aborted) setBook(quoteBookSnapshot())
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setBook(emptyBook('Router quotes failed. Buy zone uses the canonical pool only.'))
          }
        })
    }, 350)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [desk, flowNet])

  const copy = useMemo(() => {
    if (!desk) return null
    const customDebt = parseDebt(customInput)
    const model = buildScenario(desk, rows, scenario, customDebt)
    return describeBuyZone({
      label: scenarioLabel(scenario),
      model,
      desk,
      book: shownBook,
      facilityMultiple: facilityStats(desk).multiple,
      runwayDays: weakestRunway(rows),
    })
  }, [desk, rows, scenario, customInput, shownBook])

  const age =
    desk?.mode === 'live' && desk.blockTimestamp != null
      ? Math.max(0, Math.round(desk.fetchedAt / 1000) - desk.blockTimestamp)
      : null
  const badge = modeBadge(desk, loading)

  return (
    <div className="min-h-svh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-3 px-4 py-4 md:px-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber">NetNet · Robinhood Chain 4663</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight text-ink">Loopback buy zones</h1>
            <p className="mt-1 max-w-xl text-sm text-muted">
              Where a wsNET/USDG margin call is likely to print across router depth. The canonical NET/USDG pool is the floor.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 text-xs text-muted sm:items-end">
            <span className="flex items-center gap-2">
              <span
                className={cx('rounded border px-2 py-0.5 uppercase tracking-[0.14em]', badge.className)}
                data-testid="mode-badge"
              >
                {badge.label}
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
        {desk?.mode === 'seed' ? (
          <div className="mb-3 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber" data-testid="seed-banner">
            {desk.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
            {seedError ? <p>Live fetch failed. Still showing the snapshot. {seedError}</p> : null}
          </div>
        ) : null}
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
            <div className="mt-4 grid items-start gap-4 *:min-w-0 xl:grid-cols-2">
              <Ladder rows={rows} borrowerCount={desk.borrowerCount} labels={labels} />
              <CascadePanel
                desk={desk}
                rows={rows}
                scenario={scenario}
                onScenario={setScenario}
                customInput={customInput}
                onCustom={setCustomInput}
                book={shownBook}
              />
            </div>
            <BuyCallout copy={copy} />
            <CreditPanel credit={credit.data} error={credit.error} />
            <div className="mt-4 grid items-start gap-4 *:min-w-0 xl:grid-cols-2">
              <PendlePanel pendle={pendle.data} error={pendle.error} desk={desk} credit={credit.data} />
              <FlowsPanel
                snapshot={nansen.data}
                error={nansen.error}
                borrowers={borrowers}
                exposures={credit.data?.exposures ?? []}
              />
            </div>
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

const CONTEXT_POLL_MS = 5 * 60_000
const NANSEN_POLL_MS = 15 * 60_000

/** Load on mount, on Refresh, and on an interval. A failed refresh keeps the last good read. */
function usePolled<T>(load: (signal: AbortSignal) => Promise<T>, everyMs: number, refreshKey: number) {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    let controller = new AbortController()
    const run = () => {
      controller.abort()
      controller = new AbortController()
      const signal = controller.signal
      load(signal).then(
        (data) => !signal.aborted && setState({ data, error: null }),
        (error: unknown) =>
          !signal.aborted && setState((prev) => ({ data: prev.data, error: error instanceof Error ? error.message : 'Fetch failed' })),
      )
    }
    run()
    const timer = window.setInterval(run, everyMs)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [load, everyMs, refreshKey])
  return state
}

async function readNansen(signal: AbortSignal): Promise<NansenSnapshot> {
  const response = await fetch(NANSEN_ROUTE, { signal })
  const body = (await response.json().catch(() => null)) as (NansenSnapshot & { error?: string }) | null
  if (!response.ok || !body || body.error) throw new Error(body?.error ?? `HTTP ${response.status}`)
  return body
}

function modeBadge(desk: Desk | null, loading: boolean): { label: string; className: string } {
  if (loading && !desk) return { label: 'Loading', className: 'border-line text-muted' }
  if (desk?.mode === 'live') return { label: 'Live', className: 'border-mint/50 text-mint' }
  if (desk?.mode === 'seed') return { label: 'Snapshot', className: 'border-amber/60 text-amber' }
  return { label: 'Sample', className: 'border-rose/60 text-rose' }
}

function Loading() {
  return (
    <div className="space-y-3" data-testid="loading">
      <div className="grid gap-2 sm:grid-cols-3">
        {['a', 'b', 'c'].map((key) => (
          <div key={key} className="h-20 animate-pulse rounded-md border border-line bg-panel" />
        ))}
      </div>
        <p className="text-sm text-muted">Reading Morpho, the Loopback oracle, the canonical pool, and router quotes…</p>
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
