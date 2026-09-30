import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  COHORT_LABEL,
  bondBuyers,
  bondCohort,
  bondDynamics,
  bondHeadline,
  bondSummary,
  epochSeries,
  type BondCohort,
  type BondFeed,
  type BondSummary,
  type EpochRow,
} from '../lib/bonds.ts'
import { cx, formatClock, formatCount, formatRatio, formatUsd } from '../lib/format.ts'
import { Fresh, Kpi, KpiRow, Progress, Section, Segmented, Who } from './ui.tsx'

type Period = '7d' | '30d' | 'all'

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]
const DAYS: Record<Period, number | null> = { '7d': 7, '30d': 30, all: null }
const SPAN: Record<Period, string> = { '7d': '7d', '30d': '30d', all: 'all time' }
const ORDER = Object.keys(COHORT_LABEL) as BondCohort[] // bottom of the stack first
// Categories, so no seal red. Unlabelled is a hatch, "not read yet" a dashed paper box.
const FILL: Record<BondCohort, string> = {
  smart: 'bg-jade',
  public: 'bg-lotus',
  hl: 'bg-gold-ink',
  labelled: 'bg-muted/55',
  unlabelled: 'hatch',
  unread: 'border border-dashed border-[rgb(74_47_29/0.45)] bg-paper-deep',
}
const LABELS_OFF = 'Nansen labels are off on this server.'
const SUBHEAD = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-muted'
const TH = 'px-2 pb-1.5 font-semibold'
const TD = 'px-2 py-1.5'
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
  const [period, setPeriod] = useState<Period>('7d')
  const [expanded, setExpanded] = useState(false)
  // Wall clock for the epoch countdown only. The model uses the feed's own time, so it stays consistent with its data.
  const [clock, setClock] = useState(0)
  useEffect(() => {
    const tick = () => setClock(Math.floor(Date.now() / 1000))
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const view = useMemo(() => {
    if (!feed || feed.status !== 'ready') return null
    const now = Math.max(feed.headTime ?? 0, Math.floor(feed.fetchedAt / 1000))
    const cohortOf = (address: string) => bondCohort(address, feed, labels)
    const days = DAYS[period]
    const since = days === null ? 0 : now - days * 86_400
    const summary = bondSummary(feed, { since, now, cohortOf, borrowers, sellers })
    const launch = days === null ? summary : bondSummary(feed, { since: 0, now, cohortOf })
    const buyers = bondBuyers(feed, { since, cohortOf, borrowers, sellers, extraLabels: labels })
    // The completed epochs of the window, then the open one.
    const epochs = epochSeries(feed, { fromEpoch: summary.current.epoch - summary.epochsInWindow, toEpoch: summary.current.epoch, cohortOf })
    return { now, summary, buyers, epochs, dynamics: bondDynamics(summary, launch, buyers) }
  }, [feed, period, labels, borrowers, sellers])

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
            <p className="mt-2 text-xs text-muted">The first full read of the chain takes about 20 minutes. This section checks again every 10 seconds.</p>
          </>
        ) : null}
      </Section>
    )
  }

  const { now, summary, buyers, epochs, dynamics } = view
  const { current, totals, cohorts } = summary
  const span = SPAN[period]
  const allTime = period === 'all'
  const failed = feed.errors.filter((message) => message !== LABELS_OFF)
  const top = buyers.slice(0, expanded ? 50 : 10)
  const { bondPrice, twap } = feed.live
  const discount = summary.discount
  const tickNow = Math.max(now, clock)

  return (
    <Section
      {...head}
      fresh={
        <Fresh state="live" stale={error !== null || failed.length > 0}>
          {`${error ? `Updated ${formatClock(feed.fetchedAt)} · showing the last saved copy.` : `Onchain reading · updated ${formatClock(feed.fetchedAt)}`}${
            feed.labelsReadThrough ? ` · labels through ${DAY.format(Date.parse(feed.labelsReadThrough))}` : ''
          }`}
        </Fresh>
      }
      answer={bondHeadline(summary)}
    >
      <Segmented
        label="Bond window"
        options={PERIODS}
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
            value={
              <>
                {fixed(current.sold, 0)}
                <span className="text-[0.7em] text-muted"> / {fixed(current.cap, 0)} NET</span>
              </>
            }
            hint={
              <>
                <div className="mt-1.5">
                  <Progress value={current.fill} label={`Epoch ${current.epoch}: share of the cap sold`} />
                </div>
                <div className="mt-1">
                  {current.soldOut
                    ? current.soldOutAfter === null
                      ? 'Sold out'
                      : `Sold out after ${duration(current.soldOutAfter)}`
                    : `Closes in ${duration(current.closesAt - tickNow)}`}
                </div>
              </>
            }
          />
          <Kpi
            label="Bond price · USDG"
            value={fixed(bondPrice, 2)}
            hint={discount === null ? 'TWAP unavailable' : `${formatRatio(Math.abs(discount))} ${discount >= 0 ? 'under' : 'over'} TWAP ${fixed(twap, 2)}`}
          />
          <Kpi
            label={`Bonded · ${span}`}
            value={formatUsd(totals.usdg, true)}
            hint={`${fixed(totals.net, 0)} NET · ${formatCount(totals.wallets)} wallets${allTime ? '' : ` · ${formatCount(totals.newWallets)} new`}`}
          />
          <Kpi
            label={`Smart money · ${span}`}
            value={formatRatio(cohorts.smart.share)}
            tone="flat"
            hint={`of bonded NET · ${formatCount(cohorts.smart.wallets)} wallets · ${fixed(cohorts.smart.net, 1)} NET`}
          />
        </KpiRow>
      </div>

      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className={SUBHEAD}>Bonds per epoch · share of cap · {span}</p>
          <Legend cohorts={cohorts} />
        </div>
        <EpochChart key={`${period}-${current.epoch}`} rows={epochs} now={tickNow} closesAt={current.closesAt} span={span} />
        <p className="mt-2 text-[13px] leading-snug text-ink">{chartLine(summary)}</p>
      </div>

      <div className="mt-5 grid gap-5 *:min-w-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <p className={SUBHEAD}>Who bought · {span}</p>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full min-w-[380px] border-collapse text-left text-[13px]">
              <thead className={SUBHEAD}>
                <tr className="border-b border-line">
                  <th className={TH}>Group</th>
                  <th className={cx(TH, 'text-right')}>Wallets</th>
                  <th className={cx(TH, 'text-right')}>NET</th>
                  <th className={TH}>Share</th>
                  <th className={cx(TH, 'text-right')} title="USDG per NET, USDG bonds only">
                    Avg price
                  </th>
                </tr>
              </thead>
              <tbody className="num">
                {totals.wallets === 0 ? (
                  <tr>
                    <td colSpan={5} className={cx(TD, 'text-muted')}>
                      No bonds in this window.
                    </td>
                  </tr>
                ) : null}
                {ORDER.filter((cohort) => cohorts[cohort].wallets > 0).map((cohort) => (
                  <tr key={cohort} className="border-b border-line last:border-b-0">
                    <td className={cx(TD, 'text-ink')}>
                      <span className="inline-flex items-center gap-1.5">
                        <Swatch cohort={cohort} />
                        {COHORT_LABEL[cohort]}
                      </span>
                    </td>
                    <td className={cx(TD, 'text-right')}>{formatCount(cohorts[cohort].wallets)}</td>
                    <td className={cx(TD, 'text-right font-semibold')}>{fixed(cohorts[cohort].net, 1)}</td>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        <span className="block h-1 w-10 flex-none overflow-hidden rounded-full bg-[rgb(74_47_29/0.1)]">
                          <span className={cx('block h-full rounded-full', FILL[cohort])} style={{ width: `${cohorts[cohort].share * 100}%` }} />
                        </span>
                        {formatRatio(cohorts[cohort].share)}
                      </span>
                    </td>
                    <td className={cx(TD, 'text-right')}>{fixed(cohorts[cohort].avgPrice, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <p className={SUBHEAD}>Top bond buyers · {span}</p>
          <div className="overflow-x-auto">
            <table className="mt-1 w-full min-w-[560px] border-collapse text-left text-[13px]">
              <thead className={SUBHEAD}>
                <tr className="border-b border-line">
                  <th className={TH}>Who</th>
                  <th className={cx(TH, 'text-right')}>NET</th>
                  <th className={cx(TH, 'text-right')}>Share</th>
                  <th className={cx(TH, 'text-right')}>Epochs</th>
                  <th className={cx(TH, 'text-right')}>First bond</th>
                  <th className={cx(TH, 'text-right')} title="NET, sNET, wsNET and unvested bonds held now, against what the wallet's bonds would be worth staked (all time)">
                    Still holds
                  </th>
                </tr>
              </thead>
              <tbody className="num">
                {top.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={cx(TD, 'text-muted')}>
                      No bonds in this window.
                    </td>
                  </tr>
                ) : null}
                {top.map((buyer) => (
                  <tr key={buyer.address} className="border-b border-line last:border-b-0 hover:bg-[rgb(184_145_63/0.1)]">
                    <td className={TD}>
                      <Who address={buyer.address} label={buyer.label} tags={!allTime && buyer.isNew ? [...buyer.tags, 'New'] : buyer.tags} />
                    </td>
                    <td className={cx(TD, 'text-right font-semibold')}>{fixed(buyer.net, 1)}</td>
                    <td className={cx(TD, 'text-right')}>{formatRatio(buyer.share)}</td>
                    <td className={cx(TD, 'text-right')}>{buyer.epochs}</td>
                    <td className={cx(TD, 'whitespace-nowrap text-right text-[11.5px] text-muted')}>{ago(now - buyer.firstAt)}</td>
                    <td className={cx(TD, 'text-right')}>{kept(buyer.keptRatio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {buyers.length > 10 ? (
            <div className="mt-2 text-xs font-semibold tracking-[0.06em]">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
                className="min-h-8 cursor-pointer rounded-[3px] border border-[rgb(74_47_29/0.32)] bg-[rgb(255_252_243/0.6)] px-3 text-ink hover:border-accent/60"
              >
                {expanded ? 'Show top 10' : `Show top ${Math.min(50, buyers.length)}`}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {dynamics.length > 0 ? (
        <div className="mt-5">
          <p className={SUBHEAD}>Buying dynamics · {span}</p>
          <ul className="mt-1.5 space-y-1 text-[13.5px] leading-snug text-ink">
            {dynamics.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-[0.5em] size-1 flex-none rounded-full bg-gold-ink" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 border-t border-dashed border-line pt-2 text-xs text-muted">
        Labels come from Nansen. A label does not prove who owns a wallet. Holdings include staked sNET, wrapped wsNET, and unvested bonds.
      </p>
    </Section>
  )
}

function Swatch({ cohort }: { cohort: BondCohort }) {
  // Paper backing keeps the hatch and the dashed box visible on the ink tooltip too.
  return (
    <span aria-hidden="true" className="inline-block flex-none rounded-[2px] bg-paper p-px">
      <span className={cx('block size-2.5 rounded-[1px]', FILL[cohort])} />
    </span>
  )
}

function Legend({ cohorts }: { cohorts: BondSummary['cohorts'] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted">
      {ORDER.filter((cohort) => cohorts[cohort].net > 0).map((cohort) => (
        <li key={cohort} className="inline-flex items-center gap-1.5">
          <Swatch cohort={cohort} />
          {COHORT_LABEL[cohort]}
          <span className="num font-semibold text-ink">{formatRatio(cohorts[cohort].share)}</span>
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="h-px w-3 bg-ink/70" />
        Epoch cap
      </li>
    </ul>
  )
}

/** One column per epoch, stacked by cohort, as a share of the epoch's cap. Arrow keys move between columns. */
function EpochChart({ rows, now, closesAt, span }: { rows: EpochRow[]; now: number; closesAt: number; span: string }) {
  const last = rows.length - 1
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState(last)
  const [focused, setFocused] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const active = hover ?? (focused ? cursor : null)
  const gap = rows.length <= 40 ? 'gap-[3px] sm:gap-1' : rows.length <= 120 ? 'gap-px' : 'gap-0 sm:gap-px'

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: cursor - 1, ArrowRight: cursor + 1, Home: 0, End: last }
    if (!(event.key in moves)) return
    event.preventDefault()
    setHover(null)
    const next = Math.max(0, Math.min(last, moves[event.key]))
    setCursor(next)
    const column = plot.current?.children[next]
    if (column instanceof HTMLElement) column.focus()
  }

  if (rows.length === 0) return null
  const tip = active === null ? null : rows[active]
  const center = active === null ? 0 : ((active + 0.5) / rows.length) * 100
  // Anchor the slip to the column, sliding it so it never leaves the chart box.
  const tipStyle: CSSProperties = { left: `${center}%`, transform: `translateX(-${center}%)` }

  return (
    <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      <div aria-hidden="true" className="num flex h-[140px] flex-col justify-between text-right text-[10px] leading-none text-muted">
        <span>Cap</span>
        <span>50%</span>
        <span>0</span>
      </div>
      <div className="relative">
        {tip ? <Tip row={tip} status={epochStatus(tip, active === last, closesAt, now)} style={tipStyle} /> : null}
        <div
          ref={plot}
          role="group"
          aria-label={`Bonds per epoch, ${span}, as a share of each epoch's cap. Arrow keys move between epochs.`}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setHover(null)}
          className={cx(
            'flex h-[140px] border-b border-[rgb(74_47_29/0.35)] bg-[repeating-linear-gradient(to_top,rgb(74_47_29/0.12)_0_1px,transparent_1px_25%)]',
            gap,
          )}
        >
          {rows.map((row, i) => (
            <div
              key={row.epoch}
              role="img"
              aria-label={describe(row, epochStatus(row, i === last, closesAt, now))}
              tabIndex={i === cursor ? 0 : -1}
              data-open={i === last || undefined}
              onMouseEnter={() => setHover(i)}
              onFocus={() => {
                setCursor(i)
                setFocused(true)
              }}
              onBlur={() => setFocused(false)}
              className="relative flex min-w-0 flex-1 flex-col justify-end data-open:outline-1 data-open:outline-offset-2 data-open:outline-dashed data-open:outline-[rgb(74_47_29/0.35)]"
            >
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-ink/70" />
              <span className="flex flex-col-reverse gap-px overflow-hidden rounded-t-[2px]" style={{ height: `${row.fill * 100}%` }}>
                {ORDER.map((cohort) =>
                  row.byCohort[cohort] > 0 ? <span key={cohort} className={cx('block min-h-0 basis-0', FILL[cohort])} style={{ flexGrow: row.byCohort[cohort] }} /> : null,
                )}
              </span>
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="num mt-1 flex justify-between text-[10px] text-muted">
          <span>{DAY.format(rows[0].opensAt * 1000)}</span>
          <span>{DAY.format(rows[Math.floor(last / 2)].opensAt * 1000)}</span>
          <span>Open</span>
        </div>
      </div>
    </div>
  )
}

function Tip({ row, status, style }: { row: EpochRow; status: string; style: CSSProperties }) {
  return (
    <div aria-hidden="true" style={style} className="num pointer-events-none absolute bottom-[calc(100%+8px)] z-10 w-max max-w-[16rem] rounded bg-ink px-2.5 py-2 text-[10.5px] leading-[1.45] font-semibold text-paper">
      <p>
        Epoch {row.epoch} · {DAY_TIME.format(row.opensAt * 1000)}
      </p>
      <p>
        {fixed(row.sold, 1)} of {fixed(row.cap, 1)} NET · {formatRatio(row.fill)}
      </p>
      <p>{status}</p>
      <p>
        {formatCount(row.wallets)} wallets · {formatCount(row.newWallets)} new
        {row.sold > 0 ? ` · first minute ${formatRatio(row.firstMinuteShare)}` : ''}
      </p>
      {row.sold > 0 ? (
        <ul className="mt-1 border-t border-paper/20 pt-1">
          {ORDER.filter((cohort) => row.byCohort[cohort] > 0).map((cohort) => (
            <li key={cohort} className="flex items-center gap-1.5">
              <Swatch cohort={cohort} />
              <span className="flex-1">{COHORT_LABEL[cohort]}</span>
              <span>
                {fixed(row.byCohort[cohort], 1)} · {formatRatio(row.byCohort[cohort] / row.sold)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function epochStatus(row: EpochRow, open: boolean, closesAt: number, now: number): string {
  if (row.soldOut && row.soldOutAfter !== null) return `Sold out after ${duration(row.soldOutAfter)}`
  if (open) return `Open · closes in ${duration(closesAt - now)}`
  return row.sold > 0 ? 'Did not sell out' : 'No bonds'
}

function describe(row: EpochRow, status: string): string {
  const split = ORDER.filter((cohort) => row.byCohort[cohort] > 0)
    .map((cohort) => `${COHORT_LABEL[cohort]} ${formatRatio(row.byCohort[cohort] / row.sold)}`)
    .join(', ')
  return `Epoch ${row.epoch}, opened ${DAY_TIME.format(row.opensAt * 1000)}. ${fixed(row.sold, 1)} of ${fixed(row.cap, 1)} NET sold. ${status}. ${formatCount(row.wallets)} wallets.${split ? ` ${split}.` : ''}`
}

function chartLine(summary: BondSummary): string {
  if (summary.epochsInWindow === 0) return 'No epoch has closed in this window yet.'
  const parts = [`${summary.soldOutCount} of ${summary.epochsInWindow} epochs sold out.`]
  if (summary.medianSoldOutAfter !== null) parts.push(`Median sell-out: ${duration(summary.medianSoldOutAfter)}.`)
  if (summary.medianFirstMinuteShare !== null) parts.push(`Median first-minute share: ${formatRatio(summary.medianFirstMinuteShare)}.`)
  return parts.join(' ')
}

function fixed(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
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

/** Held now over what the bonds would be worth staked. Above 150% the wallet bought more elsewhere; the exact number says little. */
function kept(ratio: number | null): string {
  if (ratio === null) return '—'
  return ratio > 1.5 ? '>150%' : `${Math.round(ratio * 100)}%`
}
