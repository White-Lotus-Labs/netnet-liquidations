import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  COHORT_LABEL,
  GROUP_INFO,
  SOURCES,
  SOURCE_LABEL,
  V3_LAUNCH,
  bondBuyers,
  bondCohort,
  bondDynamics,
  bondHeadline,
  bondOutcomeLine,
  bondSummary,
  buyersCsv,
  epochSeries,
  sourceStarts,
  walletGroups,
  type BondBuyer,
  type BondCohort,
  type BondFeed,
  type BondGroup,
  type BondOutcome,
  type BondSource,
  type BondSummary,
  type BondWindow,
  type EpochRow,
} from '../lib/bonds.ts'
import { cx, decimals, formatClock, formatCount, formatRatio, formatSignedUsd, formatUsd } from '../lib/format.ts'
import type { GlossaryId } from '../lib/glossary.ts'
import { BondChart, type Layer, type Marker } from './BondChart.tsx'
import { Details, Fresh, Hint, Kpi, KpiRow, Progress, Section, Segmented, Who } from './ui.tsx'

const WINDOWS: ReadonlyArray<{ value: BondWindow; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '14d', label: '14d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]
const SPAN: Record<BondWindow, string> = { '24h': '24h', '7d': '7d', '14d': '14d', '30d': '30d', all: 'all time' }

type ColorBy = 'group' | 'source'
const COLOR_BY: ReadonlyArray<{ value: ColorBy; label: string }> = [
  { value: 'group', label: 'Buyer group' },
  { value: 'source', label: 'Source' },
]

// Bottom of the stack first: what buyers kept, then what left. Groups are categories, so seal red never marks one.
const GROUP_ORDER: BondGroup[] = ['protocol', 'strong', 'trimmer', 'looper', 'new', 'mixed', 'mover', 'left', 'weak', 'mercenary', 'arbitrageur', 'unknown']
const GROUP_PAINT: Record<BondGroup, string> = {
  protocol: 'var(--color-ink)',
  strong: 'var(--color-jade)',
  trimmer: 'rgb(44 110 82 / 0.42)',
  looper: 'var(--color-lotus)',
  new: 'rgb(26 60 95 / 0.55)',
  mixed: 'rgb(74 47 29 / 0.2)',
  mover: 'rgb(101 86 63 / 0.45)',
  left: 'rgb(101 86 63 / 0.45)',
  weak: 'var(--color-brocade)',
  mercenary: 'var(--color-gold)',
  arbitrageur: 'var(--color-gold-ink)',
  unknown: 'hatch',
}
const SOURCE_PAINT: Record<BondSource, string> = { 0: 'var(--color-lotus)', 1: 'var(--color-gold-ink)', 2: 'var(--color-gold)', 3: 'var(--color-jade)', 4: 'rgb(61 37 21 / 0.4)' }
// Short enough for the tooltip. The depository mints at bond time; v3 sells NET the manager sleeve bought back.
const SOURCE_NAME: Record<BondSource, string> = { 0: 'Depository · minted', 1: SOURCE_LABEL[1], 2: SOURCE_LABEL[2], 3: 'v3 desk · buybacks', 4: SOURCE_LABEL[4] }
const SOURCE_TERM: Record<BondSource, GlossaryId> = { 0: 'depository', 1: 'bondDesks', 2: 'bondDesks', 3: 'v3Desk', 4: 'bondDesks' }
const GROUP_TERM: Record<BondGroup, GlossaryId> = {
  protocol: 'groupProtocol',
  new: 'groupNew',
  arbitrageur: 'groupArbitrageur',
  weak: 'groupWeak',
  mercenary: 'groupMercenary',
  mover: 'groupMover',
  left: 'groupLeft',
  looper: 'groupLooper',
  strong: 'groupStrong',
  trimmer: 'groupTrimmer',
  mixed: 'groupMixed',
  unknown: 'groupUnknown',
}
const COHORT_TERM: Record<BondCohort, GlossaryId> = {
  smart: 'smartMoney',
  public: 'cohortPublic',
  hl: 'cohortHl',
  labelled: 'cohortLabelled',
  unlabelled: 'cohortUnlabelled',
  unread: 'cohortUnread',
}

// What the window's buyers did with the NET. Same paints as the groups they feed; "Sold on DEX" is a direction, so seal.
const OUTCOME: ReadonlyArray<{ key: keyof BondOutcome; name: string; paint: string; term: GlossaryId }> = [
  { key: 'vesting', name: 'Vesting', paint: GROUP_PAINT.new, term: 'outcomeVesting' },
  { key: 'staked', name: 'Staked', paint: GROUP_PAINT.strong, term: 'outcomeStaked' },
  { key: 'wrapped', name: 'Wrapped', paint: GROUP_PAINT.trimmer, term: 'outcomeWrapped' },
  { key: 'looped', name: 'Looped', paint: GROUP_PAINT.looper, term: 'outcomeLooped' },
  { key: 'liquid', name: 'Liquid', paint: 'rgb(33 25 17 / 0.55)', term: 'outcomeLiquid' },
  { key: 'sold', name: 'Sold on DEX', paint: 'var(--color-seal)', term: 'outcomeSold' },
  { key: 'moved', name: 'Moved out', paint: GROUP_PAINT.mover, term: 'outcomeMoved' },
  { key: 'left', name: 'Left the wallet', paint: GROUP_PAINT.left, term: 'outcomeLeft' },
  { key: 'unknown', name: 'Not read yet', paint: 'hatch', term: 'outcomeUnread' },
]
const KEPT = ['vesting', 'staked', 'wrapped', 'looped', 'liquid'] as const

const LABELS_OFF = 'Nansen labels are off on this server.'
// Rows in the longer buyer list. The CSV has every wallet.
const SHOW_MAX = 100
const SUBHEAD = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-muted'
const CARD_TITLE = 'text-[10.5px] font-bold uppercase tracking-[0.16em] text-brocade'
const CARD = 'rounded-md border border-line bg-[rgb(255_252_243/0.5)] px-3 py-3 sm:px-4'
const TH = 'px-2 pb-1.5 font-semibold'
const TD = 'px-2 py-1.5'
const BUTTON =
  'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[3px] border border-[rgb(74_47_29/0.32)] bg-[rgb(255_252_243/0.6)] px-3 text-ink transition-colors duration-[160ms] ease-lift hover:border-accent/60'
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short' })
const DAY_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

export function BondsPanel({
  feed,
  error,
  borrowers,
  sellers,
  labels,
}: {
  feed: BondFeed | null
  error: string | null
  borrowers: Set<string>
  sellers: Set<string>
  labels: Map<string, string>
}) {
  const [period, setPeriod] = useState<BondWindow>('7d')
  const [colorBy, setColorBy] = useState<ColorBy>('group')
  const [showPrice, setShowPrice] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // Wall clock for the epoch countdown only. The model uses the feed's own time, so it stays consistent with its data.
  const [clock, setClock] = useState(0)
  useEffect(() => {
    const tick = () => setClock(Math.floor(Date.now() / 1000))
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  // Work that does not depend on the window: the all-time summary, groups, and markers.
  const base = useMemo(() => {
    if (!feed || feed.status !== 'ready') return null
    const now = Math.max(feed.headTime ?? 0, Math.floor(feed.fetchedAt / 1000))
    // One lookup per wallet per feed; the summaries and series ask for the same wallets many times.
    const cohorts = new Map<string, BondCohort>()
    const cohortOf = (address: string) => {
      let cohort = cohorts.get(address)
      if (cohort === undefined) cohorts.set(address, (cohort = bondCohort(address, feed, labels)))
      return cohort
    }
    const epochAt = (t: number) => Math.floor((t - feed.startTime) / feed.epochSeconds)
    const starts = sourceStarts(feed)
    const markers: Marker[] = [
      ...([4, 1, 2] as const).flatMap((src): Marker[] => {
        const start = starts[src]
        return start === null ? [] : [{ epoch: epochAt(start), label: SOURCE_LABEL[src], tone: 'muted' }]
      }),
      { epoch: epochAt(V3_LAUNCH.at), label: 'v3 · bonds from buybacks, no mint', short: 'v3 · buybacks', tone: 'seal' },
    ]
    return { feed, now, cohortOf, launch: bondSummary(feed, { window: 'all', now, cohortOf }), groups: walletGroups(feed, now), markers }
  }, [feed, labels])

  const view = useMemo(() => {
    if (!base) return null
    const { feed, now, cohortOf, groups, markers } = base
    const summary = bondSummary(feed, { window: period, now, cohortOf, borrowers, sellers })
    const launch = period === 'all' ? summary : base.launch
    const buyers = bondBuyers(feed, { window: period, now, cohortOf, borrowers, sellers, extraLabels: labels })
    // The completed epochs of the window, then the open one.
    const epochs = epochSeries(feed, {
      fromEpoch: summary.current.epoch - summary.epochsInWindow,
      toEpoch: summary.current.epoch,
      cohortOf,
      groupOf: (address) => groups.get(address) ?? 'unknown',
    })
    return { now, summary, launch, buyers, epochs, markers, dynamics: bondDynamics(summary, launch, buyers) }
  }, [base, period, labels, borrowers, sellers])

  const layers = useMemo((): Layer[] => {
    const rows = view?.epochs ?? []
    return colorBy === 'group'
      ? GROUP_ORDER.filter((group) => rows.some((row) => row.byGroup[group] > 0)).map((group) => ({
          key: group,
          name: GROUP_INFO[group].name,
          term: GROUP_TERM[group],
          paint: GROUP_PAINT[group],
          value: (row: EpochRow) => row.byGroup[group],
        }))
      : SOURCES.filter((src) => rows.some((row) => row.bySource[src] > 0)).map((src) => ({
          key: String(src),
          name: SOURCE_NAME[src],
          term: SOURCE_TERM[src],
          paint: SOURCE_PAINT[src],
          value: (row: EpochRow) => row.bySource[src],
        }))
  }, [view, colorBy])

  const head = { id: 'bonds', testId: 'bonds-panel', seal: '券', eyebrow: 'NetNet bonds · Onchain + Nansen', title: 'Bond', accent: 'Buyers', meta: <>Powered by <strong>Nansen</strong></> }

  if (!feed || !view) {
    const progress = feed?.progress ?? null
    const text = feed
      ? `Reading bond history…${progress ? ` ${progress.step} (${formatCount(progress.done)}/${formatCount(progress.total)})` : ''}`
      : error
        ? 'Bond history is offline.'
        : 'Loading bond history…'
    return (
      <Section {...head} fresh={<Fresh state={!feed && error ? 'offline' : 'loading'}>{text}</Fresh>}>
        {feed ? (
          <>
            {progress && progress.total > 0 ? <Progress value={progress.done / progress.total} label={`Bond history: ${progress.step}`} /> : null}
            <p className="mt-2 text-xs text-muted">The first full read of the chain takes a few minutes. This section checks again every 10 seconds.</p>
          </>
        ) : null}
      </Section>
    )
  }

  const { now, summary, launch, buyers, epochs, markers, dynamics } = view
  const { current, totals, cohorts, buyback } = summary
  const span = SPAN[period]
  const allTime = period === 'all'
  const failed = feed.errors.filter((message) => message !== LABELS_OFF)
  const top = buyers.slice(0, expanded ? SHOW_MAX : 10)
  const { bondPrice, twap } = feed.live
  const discount = summary.discount
  const tickNow = Math.max(now, clock)
  const hasDex = summary.outcome.sold !== null
  const hasPrice = (feed.price?.length ?? 0) > 0
  const outcome = bondOutcomeLine(summary)
  // Shares of the NET the chart draws: whole epochs, so the first column can start a few hours before the window.
  const drawn = epochs.reduce((sum, row) => sum + row.net, 0)
  const legend = layers.map((layer) => ({ ...layer, share: drawn > 0 ? epochs.reduce((sum, row) => sum + layer.value(row), 0) / drawn : 0 }))

  const tip = (row: EpochRow, open: boolean) => (
    <>
      <p>
        Epoch {row.epoch} · {DAY_TIME.format(row.opensAt * 1000)}
      </p>
      <p className="font-medium text-paper/80">
        {fixed(row.net, 1)} NET bonded{row.net > row.sold ? ` · ${fixed(row.net - row.sold, 1)} from desks` : ''}
      </p>
      <p className="font-medium text-paper/80">
        {row.cap === null ? '' : `Cap ${fixed(row.cap, 1)} · `}
        {epochStatus(row, open, current.closesAt, tickNow)}
      </p>
      {row.net > 0 ? (
        <ul className="mt-1 space-y-px border-t border-paper/20 pt-1">
          {[...layers].reverse().flatMap((layer) => {
            const value = layer.value(row)
            return value > 0
              ? [
                  <li key={layer.key} className="flex items-center gap-1.5">
                    <Swatch paint={layer.paint} />
                    <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                    <span>
                      {fixed(value, 1)} · {formatRatio(value / row.net)}
                    </span>
                  </li>,
                ]
              : []
          })}
        </ul>
      ) : null}
      <p className="mt-1 border-t border-paper/20 pt-1 font-medium text-paper/80">
        Price {fixed(row.price, 2)} · bond fill {fixed(row.avgPrice, 2)} USDG
        <br />
        {formatCount(row.wallets)} wallets · {formatCount(row.newWallets)} first-time
      </p>
    </>
  )
  const describe = (row: EpochRow, open: boolean) => {
    const split = layers
      .filter((layer) => layer.value(row) > 0)
      .map((layer) => `${layer.name} ${formatRatio(layer.value(row) / row.net)}`)
      .join(', ')
    return `Epoch ${row.epoch}, opened ${DAY_TIME.format(row.opensAt * 1000)}. ${fixed(row.net, 1)} NET bonded. ${epochStatus(row, open, current.closesAt, tickNow)}.${split ? ` ${split}.` : ''}${
      row.price !== null ? ` NET price ${fixed(row.price, 2)} USDG.` : ''
    }`
  }

  const download = () => {
    const blob = new Blob([buyersCsv(buyers, period)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bond-buyers-${period}-${new Date(now * 1000).toISOString().slice(0, 10)}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Section
      {...head}
      fresh={
        <Fresh state="live" stale={error !== null || failed.length > 0}>
          <span>
            {error ? `Updated ${formatClock(feed.fetchedAt)} · showing the last saved copy.` : `Onchain reading · updated ${formatClock(feed.fetchedAt)}`}
            {feed.labelsReadThrough ? (
              <>
                {' · '}
                <Hint id="labelsThrough">labels through</Hint> {DAY.format(Date.parse(feed.labelsReadThrough))}
              </>
            ) : null}
          </span>
        </Fresh>
      }
      answer={outcome ? `${bondHeadline(summary)} ${outcome}` : bondHeadline(summary)}
    >
      <Segmented
        label="Bond window"
        options={WINDOWS}
        value={period}
        onChange={(next) => {
          setPeriod(next)
          setExpanded(false)
        }}
      />
      {feed.errors.includes(LABELS_OFF) ? <p className="mt-2 text-xs text-warn">{LABELS_OFF}</p> : null}
      {failed.length > 0 ? (
        <p className="mt-2 text-xs text-warn" title={failed.join(' ')}>
          Part of the bond read failed · showing the last saved data.
        </p>
      ) : null}

      <div className="mt-3">
        <KpiRow cols={4}>
          <Kpi
            label={`This epoch · ${current.epoch}`}
            term={['epoch', 'epochCap']}
            value={
              <>
                {fixed(current.sold, 0)}
                <span className="text-[0.7em] text-muted"> / {fixed(current.cap, 0)} NET</span>
              </>
            }
            hint={
              <>
                <div className="mt-1.5">
                  <Progress value={current.fill} label={`Epoch ${current.epoch}: share of the depository cap sold`} />
                </div>
                <div className="mt-1">
                  {current.soldOut ? (
                    current.soldOutAfter === null ? (
                      <Hint id="soldOut">Sold out</Hint>
                    ) : (
                      <>
                        <Hint id={['soldOut', 'sellOutTime']}>Sold out after</Hint> {duration(current.soldOutAfter)}
                      </>
                    )
                  ) : (
                    `Closes in ${duration(current.closesAt - tickNow)}`
                  )}
                </div>
                <div>
                  <Hint id="bondPrice">Bond price</Hint> {fixed(bondPrice, 2)}
                  {discount === null ? '' : ` · ${formatRatio(Math.abs(discount))} ${discount >= 0 ? 'under' : 'over'} TWAP ${fixed(twap, 2)}`}
                </div>
              </>
            }
          />
          <Kpi
            label={`Bonded · ${span}`}
            term="bonded"
            value={
              <>
                {fixed(totals.net, 0)}
                <span className="text-[0.7em] text-muted"> NET</span>
              </>
            }
            hint={`${formatUsd(totals.usdg, true)} · ${formatCount(totals.wallets)} wallets${allTime ? '' : ` · ${formatCount(totals.newWallets)} first-time`}`}
          />
          <Kpi
            label={`Minted vs desk stock · ${span}`}
            term="mintedVsDeskStock"
            value={
              <>
                {fixed(summary.minted, 0)}
                <span className="text-[0.7em] text-muted"> minted</span>
              </>
            }
            hint={
              summary.fromInventory > 0
                ? `${fixed(summary.fromInventory, 0)} NET from desk stock${buyback.v3Sold > 0 ? ` · ${fixed(buyback.v3Sold, 0)} of it from buybacks (v3)` : ''}`
                : 'No desk sales in this window.'
            }
          />
          <Kpi
            label={`Sleeve buyback · ${span}`}
            term="sleeveBuyback"
            value={
              buyback.net > 0 ? (
                <>
                  {fixed(buyback.net, 0)}
                  <span className="text-[0.7em] text-muted"> NET</span>
                </>
              ) : (
                'None'
              )
            }
            tone={buyback.net > 0 ? undefined : 'flat'}
            hint={
              buyback.net > 0
                ? `Bought on the DEX for ${fixed(buyback.usd, 0)} USDG · ${formatCount(buyback.buys)} ${buyback.buys === 1 ? 'buy' : 'buys'}`
                : 'The manager sleeve bought no NET on the DEX.'
            }
          />
        </KpiRow>
      </div>

      <div className={cx(CARD, 'mt-5')}>
        <p className={CARD_TITLE}>
          <Hint id="outcome">What buyers did with the NET</Hint> · {span}
        </p>
        <OutcomeBar outcome={summary.outcome} total={totals.net} />
        <p className="mt-2 text-xs leading-snug text-muted">
          {hasDex
            ? 'Sold on DEX comes from Nansen DEX trades since launch. Moved out is NET that left the wallet another way: transfers, other contracts, or exchanges.'
            : 'DEX sells are not read yet, so NET sold and NET moved show as one part: Left the wallet.'}
          {feed.holdings ? '' : ' Holdings are not read yet.'}
        </p>
      </div>

      <div data-testid="bond-chart" className="mt-4 rounded-md border border-line border-t-2 border-t-gold bg-[linear-gradient(180deg,rgb(255_251_240/0.78),rgb(255_250_238/0.4))] px-3 pt-3 pb-3 shadow-[inset_0_1px_rgb(255_255_255/0.55)] sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-72">
            <p className={CARD_TITLE}>
              <Hint id="bondChart">Bonded NET per epoch</Hint> · {epochs.length} epochs from {DAY_TIME.format(new Date(epochs[0].opensAt * 1000))}
            </p>
            <p className="mt-1 text-[13px] leading-snug text-ink">{chartLine(summary)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Color the columns by" options={COLOR_BY} value={colorBy} onChange={setColorBy} />
            <button
              type="button"
              aria-pressed={showPrice && hasPrice}
              disabled={!hasPrice}
              title={hasPrice ? 'Show the NET/USDG price on a right axis' : 'Price history is not read yet.'}
              onClick={() => setShowPrice((value) => !value)}
              className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-[19px] border border-line bg-[rgb(255_250_238/0.55)] px-3.5 text-[11.5px] font-[650] tracking-[0.02em] text-muted transition-colors duration-[160ms] ease-lift hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-[rgb(138_47_34/0.28)] aria-pressed:bg-accent/12 aria-pressed:text-accent"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.5]">
                <path d="M1.5 12 5.5 7.5l3 2.5 6-7" />
              </svg>
              Price
            </button>
            <Hint id="priceOverlay" />
          </div>
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted">
          {legend.map((item) => (
            <li key={item.key} className="inline-flex items-center gap-1.5">
              <Swatch paint={item.paint} />
              <Hint id={item.term}>{item.name}</Hint>
              <span className="num font-semibold text-ink">{formatRatio(item.share)}</span>
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-px w-3 bg-ink/75" />
            <Hint id="epochCap">Depository cap</Hint>
          </li>
          {markers.some((marker) => marker.epoch >= epochs[0].epoch && marker.epoch <= epochs[epochs.length - 1].epoch) ? (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-3 w-0 border-l-[1.5px] border-dashed border-seal" />
              <Hint id="chartMarkers">Desk markers</Hint>
            </li>
          ) : null}
        </ul>
        <BondChart
          key={period}
          rows={epochs}
          layers={layers}
          markers={markers}
          price={showPrice && hasPrice ? feed.price : null}
          epochSeconds={feed.epochSeconds}
          now={now}
          label={`Bonded NET per epoch, ${span}, colored by ${colorBy === 'group' ? 'buyer group' : 'bond source'}.`}
          tip={tip}
          describe={describe}
        />
      </div>

      <div className="mt-5 grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,2.6fr)_minmax(0,1fr)]">
        <div>
          <p className={SUBHEAD}>
            <Hint id="buyerGroup">Buyer groups</Hint> · {span}
          </p>
          <GroupTable summary={summary} hasDex={hasDex} />
        </div>
        <div>
          <p className={SUBHEAD}>Nansen labels · {span}</p>
          <CohortList cohorts={cohorts} />
          <p className="mt-2 text-[13px] leading-snug text-ink">
            <Hint id="smartMoney">Nansen smart money</Hint>: {formatRatio(cohorts.smart.share)} of bonded NET, {walletCount(cohorts.smart.wallets)}.
          </p>
        </div>
      </div>

      <div className="mt-5">
        <p className={SUBHEAD}>Top bond buyers · {span}</p>
        <div className="overflow-x-auto">
          <table className="mt-1 w-full min-w-[860px] border-collapse text-left text-[13px]">
            <caption className="sr-only">Top bond buyers, {span}</caption>
            <thead className={SUBHEAD}>
              <tr className="border-b border-line">
                <th className={TH}>Who</th>
                <th className={TH}>Group</th>
                <th className={cx(TH, 'text-right')}>Bonded</th>
                <th className={cx(TH, 'text-right')}>Share</th>
                <th className={cx(TH, 'text-right')}>Epochs</th>
                <th className={cx(TH, 'text-right')}>
                  <Hint id="firstBond">First bond</Hint>
                </th>
                <th className={TH}>
                  <Hint id="nowBar">Now</Hint>
                </th>
                <th className={cx(TH, 'text-right')}>
                  <Hint id="dexSold">DEX sold</Hint>
                </th>
              </tr>
            </thead>
            <tbody className="num">
              {top.length === 0 ? (
                <tr>
                  <td colSpan={8} className={cx(TD, 'text-muted')}>
                    No bonds in this window.
                  </td>
                </tr>
              ) : null}
              {top.map((buyer, rank) => (
                <tr key={buyer.address} className="border-b border-line last:border-b-0 hover:bg-[rgb(184_145_63/0.1)]">
                  <td className={TD}>
                    <Who stacked address={buyer.address} label={buyer.label} tags={buyerTags(buyer, rank, allTime, expanded)} />
                  </td>
                  <td className={TD}>
                    <GroupName group={buyer.group} />
                  </td>
                  <td className={cx(TD, 'text-right font-semibold')}>{fixed(buyer.bonded, 1)}</td>
                  <td className={cx(TD, 'text-right')}>{formatRatio(buyer.share)}</td>
                  <td className={cx(TD, 'text-right')}>{buyer.epochs}</td>
                  <td className={cx(TD, 'whitespace-nowrap text-right text-[11.5px] text-muted')}>{ago(now - buyer.firstAt)}</td>
                  <td className={TD}>
                    <NowBar buyer={buyer} />
                  </td>
                  <td className={cx(TD, 'text-right')}>{buyer.dexSold === null ? '—' : buyer.dexSold > 0 ? fixed(buyer.dexSold, 1) : '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold tracking-[0.06em]">
          {buyers.length > 10 ? (
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className={BUTTON}>
              {expanded ? 'Show top 10' : buyers.length > SHOW_MAX ? `Show top ${SHOW_MAX}` : `Show all ${formatCount(buyers.length)}`}
            </button>
          ) : null}
          {buyers.length > 0 ? (
            <button type="button" onClick={download} className={BUTTON}>
              <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.4]">
                <path d="M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11" />
              </svg>
              Download CSV
            </button>
          ) : null}
          {expanded && buyers.length > SHOW_MAX ? (
            <p className="self-center font-normal tracking-normal text-muted">The CSV lists all {formatCount(buyers.length)} wallets.</p>
          ) : null}
        </div>
      </div>

      {dynamics.length > 0 ? (
        <Details summary={`Buying dynamics · ${span}`}>
          <ul className="space-y-1 text-[13.5px] leading-snug text-ink">
            {dynamics.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-[0.5em] size-1 flex-none rounded-full bg-gold-ink" />
                <span>
                  {line}
                  {/* ponytail: matched on bondDynamics' wording; give its lines a term if more of them need hints. */}
                  {line.endsWith('in the first minute.') ? <Hint id="firstMinuteShare" /> : null}
                </span>
              </li>
            ))}
          </ul>
        </Details>
      ) : null}

      <div className="mt-4 space-y-0.5 border-t border-dashed border-line pt-2 text-xs leading-snug text-muted">
        <p>Labels come from Nansen and from NetNet&apos;s own contract registry. A label does not prove who owns a wallet.</p>
        <p>Groups use DEX sells from Nansen and on-chain balances. A wallet can hold NET it bought elsewhere; the split caps at what bonding explains.</p>
        <p>
          Desk stock is NET deposited into the bond desks. Since launch, {fixed(launch.buyback.depositedMinted, 0)} of {fixed(launch.buyback.deposited, 0)} NET was minted
          in the deposit transaction. Only the v3 desk sells NET that the manager sleeve bought back on the DEX.
        </p>
        <p>The genesis bond and the OTC desk also paid NET, outside the public bonds. That NET is not in this section.</p>
      </div>
    </Section>
  )
}

function Swatch({ paint }: { paint: string }) {
  // Paper backing keeps the hatch and the pale tints visible on the ink tooltip too.
  return (
    <span aria-hidden="true" className="inline-block flex-none rounded-[2px] bg-paper p-px">
      <span className={cx('block size-2.5 rounded-[1px]', paint === 'hatch' && 'hatch')} style={paint === 'hatch' ? undefined : { background: paint }} />
    </span>
  )
}

function GroupName({ group }: { group: BondGroup }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-ink">
      <Swatch paint={GROUP_PAINT[group]} />
      <Hint id={GROUP_TERM[group]}>{GROUP_INFO[group].name}</Hint>
    </span>
  )
}

function OutcomeBar({ outcome, total }: { outcome: BondOutcome; total: number }) {
  const hasDex = outcome.sold !== null
  const parts = OUTCOME.filter((part) => (hasDex ? part.key !== 'left' : part.key !== 'sold' && part.key !== 'moved'))
    .map((part) => ({ ...part, net: outcome[part.key] ?? 0 }))
    .filter((part) => part.net > 0)
  if (total <= 0 || parts.length === 0) return <p className="mt-2 text-[13px] text-muted">No bonds in this window.</p>
  return (
    <>
      <div
        role="img"
        aria-label={parts.map((part) => `${part.name} ${formatRatio(part.net / total)}`).join(', ')}
        className="mt-2.5 flex h-3 gap-[2px] overflow-hidden rounded-full bg-[rgb(74_47_29/0.12)]"
      >
        {parts.map((part) => (
          <span key={part.key} className={cx('block min-w-[2px]', part.paint === 'hatch' && 'hatch')} style={{ flexGrow: part.net, flexBasis: 0, background: part.paint === 'hatch' ? undefined : part.paint }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        {parts.map((part) => (
          <li key={part.key} className={cx('inline-flex items-center gap-1.5', part.key === 'sold' && 'text-seal')}>
            <Swatch paint={part.paint} />
            <Hint id={part.term}>{part.name}</Hint>
            <span className={cx('num font-semibold', part.key === 'sold' ? 'text-seal' : 'text-ink')}>{formatRatio(part.net / total)}</span>
            <span className="num">{fixed(part.net, 0)} NET</span>
          </li>
        ))}
      </ul>
    </>
  )
}

function GroupTable({ summary, hasDex }: { summary: BondSummary; hasDex: boolean }) {
  const rows = GROUP_ORDER.filter((group) => summary.groups[group].wallets > 0)
  return (
    <div className="overflow-x-auto">
      <table className="mt-1 w-full min-w-[680px] border-collapse text-left text-[13px]">
        <caption className="sr-only">Buyer groups</caption>
        <thead className={SUBHEAD}>
          <tr className="border-b border-line">
            <th className={TH}>Group</th>
            <th className={cx(TH, 'text-right')}>Wallets</th>
            <th className={cx(TH, 'text-right')}>Bonded</th>
            <th className={TH}>Share</th>
            <th className={cx(TH, 'text-right')}>
              <Hint id="avgPrice">Avg price</Hint>
            </th>
            <th className={cx(TH, 'text-right')}>
              <Hint id="groupSold">Sold</Hint>
            </th>
            <th className={cx(TH, 'text-right')}>
              <Hint id="stillHeld">Still held</Hint>
            </th>
            <th className={cx(TH, 'text-right')}>
              <Hint id="realizedPnl">Realized PnL</Hint>
            </th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className={cx(TD, 'text-muted')}>
                No bonds in this window.
              </td>
            </tr>
          ) : null}
          {rows.map((group) => {
            const row = summary.groups[group]
            return (
              <tr key={group} className="border-b border-line align-top last:border-b-0">
                <td className={TD}>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                    <Swatch paint={GROUP_PAINT[group]} />
                    <Hint id={GROUP_TERM[group]}>{GROUP_INFO[group].name}</Hint>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug font-medium text-muted">{GROUP_INFO[group].info}</span>
                </td>
                <td className={cx(TD, 'text-right')}>{formatCount(row.wallets)}</td>
                <td className={cx(TD, 'text-right font-semibold')}>{fixed(row.net, 1)}</td>
                <td className={TD}>
                  <span className="flex items-center gap-2">
                    <span className="block h-1 w-10 flex-none overflow-hidden rounded-full bg-[rgb(74_47_29/0.1)]">
                      <span className="block h-full rounded-full bg-ink/70" style={{ width: `${row.share * 100}%` }} />
                    </span>
                    {formatRatio(row.share)}
                  </span>
                </td>
                <td className={cx(TD, 'text-right')}>{fixed(row.avgPrice, 2)}</td>
                <td className={cx(TD, 'text-right')}>{hasDex ? formatRatio(row.sold) : '—'}</td>
                <td className={cx(TD, 'text-right')}>{formatRatio(row.held)}</td>
                <td className={cx(TD, 'text-right font-semibold', row.pnl === null || row.pnl === 0 ? 'text-muted' : row.pnl > 0 ? 'text-up' : 'text-seal')}>
                  {row.pnl === null ? '—' : formatSignedUsd(row.pnl)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CohortList({ cohorts }: { cohorts: BondSummary['cohorts'] }) {
  const keys = (Object.keys(COHORT_LABEL) as BondCohort[]).filter((cohort) => cohorts[cohort].wallets > 0)
  if (keys.length === 0) return <p className="mt-1 text-[13px] text-muted">No bonds in this window.</p>
  const lead = Math.max(...keys.map((cohort) => cohorts[cohort].share))
  return (
    <ul className="mt-1 divide-y divide-line text-[13px]">
      {keys.map((cohort) => (
        <li key={cohort} className="num grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1.5">
          <span className="min-w-0">
            <span className="block truncate text-ink">
              <Hint id={COHORT_TERM[cohort]}>{COHORT_LABEL[cohort]}</Hint>
            </span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[rgb(74_47_29/0.1)]">
              <span className="block h-full rounded-full bg-ink/70" style={{ width: `${lead > 0 ? (cohorts[cohort].share / lead) * 100 : 0}%` }} />
            </span>
          </span>
          <span className="text-right">
            <span className="font-semibold text-ink">{formatRatio(cohorts[cohort].share)}</span>
            <span className="block text-[11px] text-muted">{walletCount(cohorts[cohort].wallets)}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function NowBar({ buyer }: { buyer: BondBuyer }) {
  const split = buyer.split
  if (!split) return <span className="text-muted">—</span>
  // Without DEX sells, `left` stands in for sold and moved.
  const keys = split.sold === null ? [...KEPT, 'left' as const] : [...KEPT, 'sold' as const, 'moved' as const]
  const parts = OUTCOME.flatMap((part) => {
    const share = (keys as string[]).includes(part.key) ? (split[part.key as (typeof keys)[number]] ?? 0) : 0
    return share > 0 ? [{ ...part, share }] : []
  })
  const text = parts.map((part) => `${part.name} ${formatRatio(part.share)}`).join(' · ')
  return (
    <span role="img" aria-label={text} title={text} className="flex h-2 w-24 gap-px overflow-hidden rounded-full bg-[rgb(74_47_29/0.12)]">
      {parts.map((part) => (
        <span key={part.key} className={cx('block', part.paint === 'hatch' && 'hatch')} style={{ flexGrow: part.share, flexBasis: 0, background: part.paint === 'hatch' ? undefined : part.paint }} />
      ))}
    </span>
  )
}

// The default view is the top 10, so the rank tag shows only in the longer list.
function buyerTags(buyer: BondBuyer, rank: number, allTime: boolean, expanded: boolean): string[] {
  const tags: string[] = []
  if (expanded && rank < 10) tags.push('Top 10')
  if (!allTime && buyer.isNew) tags.push('First bond in window')
  return [...tags, ...buyer.tags]
}

function epochStatus(row: EpochRow, open: boolean, closesAt: number, now: number): string {
  if (row.soldOut && row.soldOutAfter !== null) return `Sold out after ${duration(row.soldOutAfter)}`
  if (open) return `Open · closes in ${duration(closesAt - now)}`
  return row.sold > 0 ? 'Did not sell out' : 'No depository bonds'
}

function chartLine(summary: BondSummary): ReactNode {
  if (summary.epochsInWindow === 0) return 'No epoch has closed in this window yet.'
  const median = summary.medianSoldOutAfter
  return (
    <>
      The depository cap filled in {summary.soldOutCount} of {summary.epochsInWindow} epochs.
      {median === null ? null : (
        <>
          {' '}
          <Hint id="sellOutTime">Median sell-out</Hint>: {duration(median)}.
        </>
      )}
      {summary.fromInventory > 0 ? ` Bond desks sold ${fixed(summary.fromInventory, 0)} NET more, outside the cap.` : null}
    </>
  )
}

const walletCount = (count: number) => `${formatCount(count)} ${count === 1 ? 'wallet' : 'wallets'}`

function fixed(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return decimals(digits).format(value)
}

/** "45 s", "12 m", "3 h 05 m", "4 d 2 h". */
function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, '0')} m`
  return `${Math.floor(h / 24)} d ${h % 24} h`
}

function ago(seconds: number): string {
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h ago`
  return `${Math.round(seconds / 86_400)} d ago`
}
