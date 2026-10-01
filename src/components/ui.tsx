import { useState, type ReactNode } from 'react'
import { cleanLabel, labelClass } from '../lib/flows.ts'
import { cx } from '../lib/format.ts'
import { protocolLabel } from '../lib/protocol.ts'

/** Evidence card: seal, eyebrow, serif title with an italic accent, then one lead answer and the detail. */
export function Section(props: {
  id: string
  seal: string
  eyebrow: string
  title: string
  accent?: string
  fresh?: ReactNode
  meta?: ReactNode
  answer?: ReactNode
  children: ReactNode
  testId?: string
}) {
  const titleId = `${props.id}-title`
  return (
    <section id={props.id} data-testid={props.testId} aria-labelledby={titleId} className="min-w-0 rounded-lg border border-line bg-card px-[15px] py-[13px] sm:px-5 sm:py-4">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="mt-0.5">
          <Seal glyph={props.seal} />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <p className="eyebrow">{props.eyebrow}</p>
          <h2 id={titleId} className="mt-0.5 font-display text-[clamp(22px,1.9vw,28px)] font-semibold leading-[1.15] tracking-[-0.005em] text-ink">
            {props.title}
            {props.accent ? (
              <>
                {' '}
                <em className="font-medium text-accent">{props.accent}</em>
              </>
            ) : null}
          </h2>
          {props.fresh}
        </div>
        {props.meta ? <div className="text-xs text-muted [&_strong]:font-[650] [&_strong]:text-ink">{props.meta}</div> : null}
      </header>
      {props.answer ? <p className="mt-3 text-[15px] leading-snug text-ink">{props.answer}</p> : null}
      <div className="mt-3">{props.children}</div>
    </section>
  )
}

const KPI_TONE = { up: 'text-up', down: 'text-seal', flat: 'text-muted', warn: 'text-warn' } as const

/** One stat. Use inside KpiRow (a <dl>). `lead` marks the one answer tile of a section. */
export function Kpi(props: { label: string; value: ReactNode; hint?: ReactNode; tone?: keyof typeof KPI_TONE; lead?: boolean }) {
  return (
    <div
      className={cx(
        'min-w-0',
        props.lead &&
          'rounded-md border border-line border-t-2 border-t-gold bg-[linear-gradient(180deg,rgb(255_251_240/0.72),rgb(226_207_166/0.3))] px-3.5 py-3 shadow-[inset_0_1px_rgb(255_255_255/0.55)]',
      )}
    >
      <dt className="text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.12em] text-muted">{props.label}</dt>
      <dd
        className={cx(
          'num mt-1 font-[650] leading-[1.15]',
          props.lead ? 'text-[clamp(20px,2.4vw,26px)]' : 'text-[clamp(17px,1.9vw,22px)]',
          props.tone ? KPI_TONE[props.tone] : 'text-ink',
        )}
      >
        {props.value}
      </dd>
      {props.hint ? <dd className="mt-0.5 text-xs leading-snug text-muted">{props.hint}</dd> : null}
    </div>
  )
}

const KPI_COLS = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
} as const

export function KpiRow(props: { children: ReactNode; cols?: keyof typeof KPI_COLS }) {
  return (
    <dl
      className={cx(
        'm-0 grid gap-3 border-t border-line pt-2.5',
        props.cols ? KPI_COLS[props.cols] : 'grid-cols-[repeat(auto-fit,minmax(140px,1fr))]',
      )}
    >
      {props.children}
    </dl>
  )
}

const CHIP_TONE = {
  buy: 'rounded bg-[rgb(47_125_91/0.14)] text-up',
  sell: 'rounded bg-[rgb(163_40_31/0.12)] text-seal',
  warn: 'rounded-full bg-[rgb(184_145_63/0.22)] text-warn',
  neutral: 'rounded-full border border-line bg-[rgb(255_250_238/0.7)] text-muted',
  smart: 'rounded-full border border-jade/40 bg-[rgb(255_250_238/0.7)] text-jade',
  public: 'rounded-full border border-lotus/40 bg-[rgb(255_250_238/0.7)] text-lotus',
  hl: 'rounded-full border border-gold-ink/40 bg-[rgb(255_250_238/0.7)] text-gold-ink',
  labelled: 'rounded-full border border-muted/40 bg-[rgb(255_250_238/0.7)] text-muted',
} as const

/** Small uppercase tag. buy/sell mean direction only; the cohort tones are categories. */
export function Chip(props: { tone?: keyof typeof CHIP_TONE; children: ReactNode; title?: string }) {
  return (
    <span
      title={props.title}
      className={cx(
        'inline-flex items-center whitespace-nowrap px-[7px] py-0.5 text-[9.5px] font-bold uppercase leading-[1.2] tracking-[0.08em]',
        CHIP_TONE[props.tone ?? 'neutral'],
      )}
    >
      {props.children}
    </span>
  )
}

/** Flat red seal with one CJK glyph. Decorative only. */
export function Seal(props: { glyph: string; size?: number }) {
  const size = props.size ?? 26
  return (
    <span
      aria-hidden="true"
      className="inline-grid -rotate-3 place-items-center rounded-[3px] bg-seal font-cjk font-semibold leading-none text-[#f8ead0] shadow-[inset_0_0_0_1.5px_rgb(248_234_208/0.5)] select-none"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
    >
      {props.glyph}
    </span>
  )
}

/** Pill group of toggle buttons (Shelf tabs). */
export function Segmented<T extends string>(props: {
  label: string
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={props.label} className="inline-flex min-h-[38px] flex-wrap gap-1 rounded-[19px] text-[11.5px] font-[650] tracking-[0.02em] border border-line bg-[rgb(255_250_238/0.55)] p-[3px]">
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === props.value}
          onClick={() => props.onChange(option.value)}
          className="min-h-[30px] cursor-pointer rounded-full px-3 py-[5px] text-muted transition-colors duration-[160ms] ease-lift hover:text-ink aria-pressed:bg-accent/12 aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_1px_rgb(138_47_34/0.28)]"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** 8px leaf bar. `value` is a fraction 0–1 and is clamped. */
export function Progress(props: { value: number; label: string }) {
  const fraction = Number.isFinite(props.value) ? Math.min(1, Math.max(0, props.value)) : 0
  return (
    <div
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      className="h-2 overflow-hidden rounded-full bg-[rgb(74_47_29/0.12)]"
    >
      <span className="block h-full bg-[linear-gradient(90deg,var(--color-gold),var(--color-brocade))]" style={{ width: `${fraction * 100}%` }} />
    </div>
  )
}

/** Freshness line: jade dot when live, gold while loading, red-brown text when offline. */
export function Fresh(props: { state: 'live' | 'loading' | 'offline'; children: ReactNode; stale?: boolean }) {
  return (
    <p className={cx('mt-0.5 flex flex-wrap items-center gap-[7px] text-xs leading-[1.35] tracking-[0.02em]', props.state === 'offline' ? 'text-[#7a3326]' : 'text-muted')}>
      {props.state === 'offline' ? null : (
        <span
          aria-hidden="true"
          className={cx(
            'size-[7px] flex-none rounded-full',
            props.state === 'live' ? 'bg-jade shadow-[0_0_0_3px_rgb(44_110_82/0.16)]' : 'bg-gold shadow-[0_0_0_3px_rgb(184_145_63/0.2)]',
          )}
        />
      )}
      {props.children}
      {props.stale ? (
        <span className="rounded-full bg-[rgb(184_145_63/0.22)] px-2 py-0.5 text-[10px] font-bold uppercase leading-[1.4] tracking-[0.1em] text-warn">Stale</span>
      ) : null}
    </p>
  )
}

const LABEL_TONE: Record<string, string> = {
  smart: 'border-jade/40 text-jade',
  'public-figure': 'border-lotus/40 text-lotus',
  'hl-trader': 'border-gold-ink/40 text-gold-ink',
}

const ICON_ACTION =
  'inline-grid size-[26px] flex-none cursor-pointer place-items-center rounded-[5px] border border-transparent text-muted transition-colors duration-[160ms] ease-lift hover:border-line hover:bg-[rgb(255_250_238/0.7)] hover:text-brocade'

/** Wallet cell: short address, label (NetNet's registry name wins over Nansen's), tags, copy, and a Nansen profiler link. */
/** `stacked` keeps one row height in long tables: name and actions on one line, tags on a second line that never wraps. */
export function Who(props: { address: string; label?: string | null; tags?: string[]; stacked?: boolean }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  const protocol = protocolLabel(props.address)
  const name = protocol ?? cleanLabel(props.label)
  const tone = LABEL_TONE[labelClass(props.label) ?? ''] ?? 'border-line text-muted'
  const flash = (next: 'copied' | 'failed') => {
    setCopy(next)
    window.setTimeout(() => setCopy('idle'), 1500)
  }
  const onCopy = () => {
    const write = navigator.clipboard?.writeText(props.address) ?? Promise.reject(new Error('No clipboard'))
    write.then(
      () => flash('copied'),
      () => flash('failed'),
    )
  }
  const tags = props.tags?.map((tag) => (
    <Chip key={tag} tone={tag.startsWith('Sold') ? 'sell' : 'neutral'}>
      {tag}
    </Chip>
  ))
  const main = (
    <div className={cx('flex min-w-0 items-center gap-x-2 gap-y-1', props.stacked ? 'flex-nowrap' : 'flex-wrap')}>
      <span className="flex-none font-mono text-xs text-muted" title={props.address}>
        {props.address.slice(0, 6)}…{props.address.slice(-4)}
      </span>
      {name ? (
        <span title={name} className={cx(props.stacked ? 'min-w-0 max-w-[13rem]' : 'max-w-[16rem]', 'truncate rounded-full border bg-[rgb(255_250_238/0.7)] px-2 py-px text-[11.5px] font-semibold', tone)}>
          {name}
        </span>
      ) : null}
      {protocol ? (
        <Chip tone="labelled" title="Address from NetNet's own contract registry">
          Protocol
        </Chip>
      ) : null}
      {props.stacked ? null : tags}
      <span className="relative inline-flex">
        <button type="button" className={ICON_ACTION} aria-label="Copy address" title="Copy address" onClick={onCopy}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.3]">
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
          </svg>
        </button>
        <span
          role="status"
          className={cx(
            'pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink px-[7px] py-[3px] text-[10.5px] font-semibold leading-[1.2] text-paper',
            copy === 'idle' && 'sr-only',
          )}
        >
          {copy === 'copied' ? 'Copied' : copy === 'failed' ? 'Copy failed' : ''}
        </span>
      </span>
      <a
        className={ICON_ACTION}
        href={`https://app.nansen.ai/profiler?address=${props.address}&chain=robinhood`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Research in Nansen (new tab)"
        title="Research in Nansen"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.3]">
          <path d="M9 2.5h4.5V7M13.5 2.5 7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
        </svg>
      </a>
    </div>
  )
  if (!props.stacked) return main
  // The tag line is always there, so rows without tags keep the same height.
  // Wide enough for three tags; the table scrolls inside its own box.
  return (
    <div className="min-w-[24rem]">
      {main}
      <div className="mt-0.5 flex h-[18px] min-w-0 flex-nowrap items-center gap-x-1.5 overflow-hidden" title={props.tags?.join(' · ') || undefined}>
        {tags}
      </div>
    </div>
  )
}

/** Disclosure for detail that does not change the lead answer. */
export function Details(props: { summary: string; children: ReactNode }) {
  return (
    <details className="group mt-3 border-t border-dashed border-line pt-2">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brocade [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3 fill-none stroke-current stroke-[1.6] transition-transform duration-[260ms] ease-lift group-open:rotate-90">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
        {props.summary}
      </summary>
      <div className="mt-2">{props.children}</div>
    </details>
  )
}
