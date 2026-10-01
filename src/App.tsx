import { useEffect, useMemo, useRef, useState } from 'react'
import { ADDRESSES, LINKS, NANSEN_ROUTE, POLL_MS } from './config.ts'
import { readBonds } from './adapters/bonds.ts'
import { readCredit } from './adapters/credit.ts'
import { loadDesk } from './adapters/loadDesk.ts'
import { readPendle } from './adapters/pendle.ts'
import { QUOTE_RUNGS_NET, loadQuotes, quoteBookSnapshot, rungRaw } from './adapters/quotes.ts'
import { BondsPanel } from './components/BondsPanel.tsx'
import { BuyZonePanel } from './components/BuyZonePanel.tsx'
import { FlowsPanel } from './components/FlowsPanel.tsx'
import { Ladder } from './components/Ladder.tsx'
import { LoopPanel } from './components/LoopPanel.tsx'
import { MusicToggle } from './components/MusicToggle.tsx'
import { OracleStrip } from './components/OracleStrip.tsx'
import { Petals } from './components/Petals.tsx'
import { describeBuyZone } from './lib/buyZone.ts'
import { labelMap, type NansenSnapshot } from './lib/flows.ts'
import { cx, formatAge, formatWarsaw, parseUsdgInput, shortAddress } from './lib/format.ts'
import {
  SCENARIO_ORDER,
  buildScenario,
  enrichPositions,
  facilityStats,
  scenarioLabel,
  weakestRunway,
  type ScenarioId,
  type ScenarioModel,
} from './lib/model.ts'
import { emptyBook, type QuoteBook } from './lib/quoteBook.ts'
import { useBackdropParallax } from './lib/useBackdropParallax.ts'
import { stressDesk } from './seed/stressDesk.ts'
import type { Desk } from './types.ts'

export default function App() {
  const [desk, setDesk] = useState<Desk>(() => stressDesk())
  const [stale, setStale] = useState<string | null>(null)
  const [seedError, setSeedError] = useState<string | null>(null)
  const [picked, setScenario] = useState<ScenarioId | null>(null)
  const [customInput, setCustomInput] = useState('25000')
  const [refreshKey, setRefreshKey] = useState(0)
  const [book, setBook] = useState<QuoteBook | null>(null)
  const modeRef = useRef<'seed' | 'live'>('seed')
  const backdropRef = useRef<HTMLDivElement>(null)
  useBackdropParallax(backdropRef)
  const credit = usePolled(readCredit, CONTEXT_POLL_MS, refreshKey)
  const pendle = usePolled(readPendle, CONTEXT_POLL_MS, refreshKey)
  const nansen = usePolled(readNansen, NANSEN_POLL_MS, refreshKey)
  const labels = useMemo(() => labelMap(nansen.data), [nansen.data])
  const sellers = useMemo(() => new Set((nansen.data?.sellers ?? []).flatMap((row) => (row.address ? [row.address.toLowerCase()] : []))), [nansen.data])
  // The first bond index takes minutes; poll faster until it is ready.
  const [bondsMs, setBondsMs] = useState(BONDS_POLL_MS)
  const bonds = usePolled(readBonds, bondsMs, refreshKey)
  const wantBondsMs = bonds.data?.status === 'indexing' ? BONDS_INDEXING_POLL_MS : BONDS_POLL_MS
  if (wantBondsMs !== bondsMs) setBondsMs(wantBondsMs)
  // Keyed on the addresses, so a desk poll with the same borrowers keeps the Set and the bond panel skips its rebuild.
  const borrowerKey = useMemo(() => [...new Set(desk.positions.map((position) => position.address.toLowerCase()))].sort().join(','), [desk])
  const borrowers = useMemo(() => new Set(borrowerKey ? borrowerKey.split(',') : []), [borrowerKey])
  const vaultBorrowers = useMemo(
    () => new Set((credit.data?.exposures ?? []).filter((row) => row.share > 0.05).map((row) => row.address.toLowerCase())),
    [credit.data],
  )

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
      } catch (error) {
        if (cancelled || signal.aborted) return
        const message = error instanceof Error ? error.message : 'Fetch failed'
        if (modeRef.current === 'live') {
          setStale(message)
        } else {
          setSeedError(message)
        }
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

  const rows = useMemo(() => enrichPositions(desk), [desk])
  const buckets = useMemo(
    () =>
      new Map<ScenarioId, ScenarioModel>(
        SCENARIO_ORDER.filter((id) => id !== 'custom').map((id) => [id, buildScenario(desk, rows, id, 0n)]),
      ),
    [desk, rows],
  )
  // Until the reader picks one, open on the weakest bucket that has borrowers in it.
  const scenario = picked ?? SCENARIO_ORDER.find((id) => (buckets.get(id)?.slices.length ?? 0) > 0) ?? 'top10'
  const customDebt = parseUsdgInput(customInput) ?? 0n
  const model: ScenarioModel = useMemo(
    () => buckets.get(scenario) ?? buildScenario(desk, rows, 'custom', customDebt),
    [buckets, desk, rows, scenario, customDebt],
  )
  const flowNet = model.flowNetRaw ?? 0n
  const shownBook = book ?? emptyBook(null, 'loading')

  useEffect(() => {
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

  const copy = useMemo(
    () =>
      describeBuyZone({
        label: scenarioLabel(scenario),
        model,
        desk,
        book: shownBook,
        facilityMultiple: facilityStats(desk).multiple,
        runwayDays: weakestRunway(rows),
      }),
    [desk, rows, scenario, model, shownBook],
  )

  const age =
    desk.mode === 'live' && desk.blockTimestamp != null
      ? Math.max(0, Math.round(desk.fetchedAt / 1000) - desk.blockTimestamp)
      : null
  const badge = modeBadge(desk)

  return (
    <div className="min-h-svh">
      <div className="backdrop" aria-hidden="true" ref={backdropRef}>
        <img
          src="/images/tea-shop-exterior.webp"
          srcSet="/images/tea-shop-exterior-780w.webp 780w, /images/tea-shop-exterior.webp 1280w"
          sizes="100vw"
          alt=""
          fetchPriority="high"
          decoding="async"
        />
      </div>
      <Petals />
      <header className="topbar text-[#f6e6c8]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 md:min-h-[84px] md:px-[clamp(22px,3vw,40px)]">
          <a className="flex items-center gap-2.5 text-chrome no-underline sm:gap-3.5" href={TEA_SHOP_URL}>
            <span className="grid size-10 flex-none place-items-center rounded-full border border-[rgb(215_170_105/0.4)] bg-[radial-gradient(rgb(215_170_105/0.16),transparent_70%)]">
              <svg viewBox="0 0 32 32" aria-hidden="true" className="size-5 text-[#d7aa69]">
                <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5" />
                <path d="M3 16a13 13 0 0 0 26 0z" fill="currentColor" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5 whitespace-nowrap font-display text-lg leading-[1.1] font-semibold tracking-[0.005em] sm:text-[22px]">
              Iroh&apos;s Tea Shop
              <small className="hidden font-sans text-[9.5px] leading-[1.3] font-semibold tracking-[0.22em] text-[rgb(243_234_217/0.55)] uppercase sm:block">
                NetNet desk · Nansen flows
              </small>
            </span>
          </a>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(212_175_120/0.3)] px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] text-chrome uppercase"
              data-testid="mode-badge"
            >
              <span aria-hidden="true" className={cx('size-[7px] rounded-full', badge.dot)} />
              {badge.label}
            </span>
            <span className="num text-[rgb(243_234_217/0.75)]" title={formatWarsaw(desk.fetchedAt)}>
              {desk.blockNumber ? `Block ${desk.blockNumber.toLocaleString('en-US')}` : 'Block unavailable'}
              {age !== null ? ` · ${formatAge(age)}` : ''}
            </span>
            <button
              type="button"
              className={cx(CHROME_PILL, 'h-8 px-3')}
              onClick={() => setRefreshKey((key) => key + 1)}
            >
              Refresh
            </button>
            <MusicToggle className={cx(CHROME_PILL, 'h-8 px-3')} />
            <a className={cx(CHROME_PILL, 'h-8 px-3')} href={TEA_SHOP_URL} target="_blank" rel="noreferrer">
              Enter the tea shop ↗
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1240px] px-4 pt-5 pb-10 sm:px-8">
        <div className="rod" aria-hidden="true" />
        <main className="sheet">
          <div className="mb-4">
            <p className="eyebrow">NetNet · Robinhood Chain</p>
            <h1 className="mt-1 font-display text-[clamp(30px,2.5vw,38px)] leading-[1.05] font-semibold tracking-[-0.012em] text-ink">
              NET <em className="font-medium text-accent">Desk</em>
            </h1>
          </div>
          {desk.mode === 'seed' ? (
            <p className="mb-3 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber" data-testid="seed-banner" title={seedError ?? undefined}>
              Snapshot {formatWarsaw(desk.fetchedAt)} · {desk.positions.length} of {desk.borrowerCount ?? '—'} borrowers ·{' '}
              {seedError ? 'live read failed' : 'waiting for the live read'}.
            </p>
          ) : null}
          {stale ? (
            <p className="mb-3 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber" title={stale}>
              Refresh failed · showing the last live read.
            </p>
          ) : null}
          {desk.mode === 'live' && desk.warnings.length > 0 ? (
            <ul className="mb-3 space-y-1 text-xs text-amber">
              {desk.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-4">
            <OracleStrip desk={desk} />
            <BuyZonePanel
              desk={desk}
              buckets={buckets}
              model={model}
              copy={copy}
              scenario={scenario}
              onScenario={setScenario}
              customInput={customInput}
              onCustom={setCustomInput}
              book={shownBook}
            />
            <Ladder rows={rows} borrowerCount={desk.borrowerCount} labels={labels} vaultBorrowers={vaultBorrowers} />
            <BondsPanel feed={bonds.data} error={bonds.error} borrowers={borrowers} sellers={sellers} labels={labels} />
            <FlowsPanel snapshot={nansen.data} error={nansen.error} borrowers={borrowers} vaultBorrowers={vaultBorrowers} />
            <LoopPanel desk={desk} credit={credit.data} creditError={credit.error} pendle={pendle.data} pendleError={pendle.error} />
          </div>

          <footer className="mt-6 space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-muted">
            <p>
              Market {shortAddress(ADDRESSES.marketId)} · oracle {shortAddress(ADDRESSES.oracle)} · pair {shortAddress(ADDRESSES.pair)} · bond
              depository {shortAddress(ADDRESSES.bondDepository)}. Polls every {Math.round(POLL_MS / 1000)}s. No wallet, no orders.
            </p>
            <p className="flex flex-wrap gap-x-3 gap-y-1">
              <FooterLink href={THESIS_DESK_URL}>NetNet in the Thesis Desk</FooterLink>
              <FooterLink href={LINKS.morphoMarket}>Morpho market</FooterLink>
              <FooterLink href={LINKS.creditVault}>Credit vault</FooterLink>
              <FooterLink href={LINKS.pendle}>Pendle</FooterLink>
              <FooterLink href={LINKS.netnet}>NetNet app</FooterLink>
              <FooterLink href={LINKS.lendingDocs}>Lending docs</FooterLink>
              <FooterLink href={LINKS.creditDocs}>Credit docs</FooterLink>
              <FooterLink href={LINKS.bondDocs}>Bond docs</FooterLink>
              <FooterLink href={LINKS.pairExplorer}>Pool</FooterLink>
              <FooterLink href={LINKS.oracleExplorer}>Oracle</FooterLink>
              <FooterLink href={LINKS.bondDepository}>Bond depository</FooterLink>
            </p>
            <p>Wallet intelligence by Nansen · A desk of Iroh&apos;s Tea Shop · White Lotus Labs</p>
          </footer>
        </main>
        <div className="rod" aria-hidden="true" />
      </div>
    </div>
  )
}

const CONTEXT_POLL_MS = 5 * 60_000
const NANSEN_POLL_MS = 15 * 60_000
const BONDS_POLL_MS = 60_000
const BONDS_INDEXING_POLL_MS = 10_000

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

const TEA_SHOP_URL = 'https://iroh-tea-shop.up.railway.app'
const THESIS_DESK_URL = 'https://iroh-tea-shop.up.railway.app/?thesis=robinhood'
const CHROME_PILL =
  'inline-flex cursor-pointer items-center gap-2 rounded-full border border-[rgb(212_175_120/0.3)] bg-[rgb(212_175_120/0.06)] font-medium tracking-[0.2px] text-chrome no-underline transition-colors duration-200 hover:border-[rgb(212_175_120/0.6)] hover:bg-[rgb(212_175_120/0.14)]'

function modeBadge(desk: Desk): { label: string; dot: string } {
  if (desk.mode === 'live') return { label: 'Live', dot: 'bg-jade shadow-[0_0_0_3px_rgb(44_110_82/0.3)]' }
  if (desk.mode === 'seed') return { label: 'Snapshot', dot: 'bg-gold' }
  return { label: 'Sample', dot: 'bg-seal' }
}

function FooterLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="text-accent underline underline-offset-3" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}
