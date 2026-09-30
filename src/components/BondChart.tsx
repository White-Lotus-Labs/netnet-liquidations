import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { EpochRow } from '../lib/bonds.ts'

/** One stacked layer: a buyer group or a bond source. `paint` is a CSS color, or 'hatch'. */
export type Layer = { key: string; name: string; paint: string; value: (row: EpochRow) => number }
/** A vertical rule at the left edge of an epoch. 'seal' is the v3 launch; 'muted' marks a desk's first bond. `short` is for narrow plots. */
export type Marker = { epoch: number; label: string; short?: string; tone: 'seal' | 'muted' }

const MIN_STEP = 2 // px per epoch; a narrower plot scrolls inside its box
const AXIS_L = 38
const AXIS_R = 46
const BOTTOM = 22
const TIP_W = 240
const CANDLE = 4 * 3600 // feed.price holds 4 h candles, keyed by their open
const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short' })
const DAY_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const AXIS_TEXT = 'num absolute text-[10px] leading-none font-medium text-muted'
const AXIS_TITLE = 'absolute top-0 text-[9.5px] leading-none font-semibold uppercase tracking-[0.12em] text-muted'

/**
 * Bonded NET per epoch as stacked columns, the depository cap as a tick, launch rules, and an optional
 * NET price line on a right axis. Pixel geometry from the measured width, so every edge is crisp.
 * Arrow keys move between epochs; the panel renders the tooltip body and the spoken description.
 */
export function BondChart(props: {
  rows: EpochRow[]
  layers: Layer[]
  markers: Marker[]
  price: Array<[number, number]> | null // [candle open, close]; null hides the price line
  epochSeconds: number
  now: number
  label: string
  tip: (row: EpochRow, open: boolean) => ReactNode
  describe: (row: EpochRow, open: boolean) => string
}) {
  const { rows, layers, markers, price, epochSeconds, now } = props
  const n = rows.length
  const last = n - 1
  const scroller = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(0)
  const [scroll, setScroll] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState(last)
  const [focused, setFocused] = useState(false)
  const hatch = `hatch-${useId().replace(/:/g, '')}`

  useLayoutEffect(() => {
    const node = scroller.current
    if (!node) return
    const measure = () => setAvail(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const plotW = Math.max(avail, n * MIN_STEP)
  const step = n > 0 ? plotW / n : 0
  const gap = step >= 8 ? 2 : step >= 3 ? 1 : 0
  const height = avail > 0 && avail < 480 ? 214 : 262
  const inRange = markers.filter((marker) => marker.epoch >= rows[0]?.epoch && marker.epoch <= rows[last]?.epoch)
  const top = inRange.some((marker) => marker.tone === 'seal') ? 30 : 14
  const base = height - BOTTOM

  // The newest epochs sit at the right edge; start there when the plot scrolls, and again when the box resizes.
  useLayoutEffect(() => {
    const node = scroller.current
    if (node) node.scrollLeft = node.scrollWidth
  }, [plotW, avail])

  const netTicks = ticks(0, Math.max(1, ...rows.map((row) => Math.max(row.net, row.cap ?? 0))), 5)
  const netTop = netTicks[netTicks.length - 1]
  const { x, width, yNet } = useMemo(() => {
    const x = (i: number) => Math.round(i * step)
    return {
      x,
      width: (i: number) => Math.max(1, x(i + 1) - x(i) - gap),
      yNet: (value: number) => base - (value / netTop) * (base - top),
    }
  }, [step, gap, base, top, netTop])

  const dots = step >= 6 // fill-price dots crowd the line below this
  const line = useMemo(() => {
    if (!price || n === 0) return null
    const from = rows[0].opensAt
    const points = price.filter(([t]) => t + CANDLE > from && t <= now).map(([t, close]): [number, number] => [Math.min(t + CANDLE, now), close])
    const fills = dots ? rows.flatMap((row, i) => (row.avgPrice === null ? [] : [[i, row.avgPrice] as const])) : []
    const values = [...points.map((point) => point[1]), ...fills.map((fill) => fill[1])]
    if (values.length === 0) return null
    const scale = ticks(Math.min(...values), Math.max(...values), 4)
    return { points, fills, scale, from }
  }, [price, rows, now, n, dots])
  const priceLo = line?.scale[0] ?? 0
  const priceHi = line?.scale[line.scale.length - 1] ?? 1
  const yPrice = (value: number) => base - ((value - priceLo) / (priceHi - priceLo)) * (base - top)

  // Bars, cap ticks and day labels only change with the data and the width, not on hover.
  const columns = useMemo(
    () =>
      rows.map((row, i) => {
        const left = x(i)
        const w = width(i)
        let below = 0
        let edge = base
        const parts = layers.filter((layer) => layer.value(row) > 0)
        const segments = parts.map((layer, k) => {
          below += layer.value(row)
          const y = Math.round(yNet(below))
          const bottom = edge - (k > 0 ? 1 : 0) // 1px paper gap between segments
          edge = y
          const h = bottom - y
          if (h <= 0) return null
          const fill = layer.paint === 'hatch' ? `url(#${hatch})` : layer.paint
          return k === parts.length - 1 && w >= 4 ? (
            <path key={layer.key} d={roundedTop(left, y, w, h, Math.min(2, w / 2, h))} style={{ fill }} />
          ) : (
            <rect key={layer.key} x={left} y={y} width={w} height={h} style={{ fill }} />
          )
        })
        const cap = row.cap === null ? null : Math.round(yNet(row.cap)) + 0.5
        return (
          <g key={row.epoch}>
            {segments}
            {cap === null ? null : <line x1={left - (gap ? 0.5 : 0)} x2={left + w + (gap ? 0.5 : 0)} y1={cap} y2={cap} className="stroke-ink/75" strokeWidth={1} />}
          </g>
        )
      }),
    [rows, layers, x, width, yNet, base, gap, hatch],
  )

  const labels = useMemo(() => dayLabels(rows, step), [rows, step])

  const active = hover ?? (focused ? cursor : null)
  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setHover(Math.max(0, Math.min(last, Math.floor((event.clientX - box.left) / step))))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowLeft: cursor - 1, ArrowRight: cursor + 1, Home: 0, End: last }
    if (!(event.key in moves)) return
    event.preventDefault()
    setHover(null)
    const next = Math.max(0, Math.min(last, moves[event.key]))
    setCursor(next)
    const node = scroller.current
    if (node && (x(next) < node.scrollLeft || x(next + 1) > node.scrollLeft + node.clientWidth)) node.scrollLeft = x(next) - node.clientWidth / 2
  }

  if (n === 0) return null
  const outer = AXIS_L + avail + (line ? AXIS_R : 0)
  const center = active === null ? 0 : AXIS_L + x(active) + width(active) / 2 - scroll
  const tipLeft = center < outer / 2 ? Math.min(center + 14, outer - TIP_W) : Math.max(0, center - 14 - TIP_W)

  return (
    <div className="relative mt-3">
      <div className="flex">
        <div aria-hidden="true" className="relative flex-none" style={{ width: AXIS_L, height }}>
          <span className={`${AXIS_TITLE} left-0`}>NET</span>
          {netTicks.map((tick) => (
            <span key={tick} className={`${AXIS_TEXT} right-2 -translate-y-1/2`} style={{ top: yNet(tick) }}>
              {tick.toLocaleString('en-US')}
            </span>
          ))}
        </div>
        <div
          ref={scroller}
          role="group"
          tabIndex={0}
          aria-label={`${props.label} Arrow keys move between epochs.`}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onScroll={(event) => {
            setScroll(event.currentTarget.scrollLeft)
            setHover(null)
          }}
          className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:thin]"
        >
          <div className="relative" style={{ width: plotW, height }}>
            {avail > 0 ? (
              <svg aria-hidden="true" width={plotW} height={height} className="block" onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHover(null)}>
                <defs>
                  <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="5" height="5" fill="rgb(232 215 178 / 0.5)" />
                    <line x1="0.6" y1="0" x2="0.6" y2="5" stroke="rgb(74 47 29 / 0.5)" strokeWidth="1.2" />
                  </pattern>
                </defs>
                {netTicks.slice(1).map((tick) => (
                  <line key={tick} x1={0} x2={plotW} y1={Math.round(yNet(tick)) + 0.5} y2={Math.round(yNet(tick)) + 0.5} stroke="rgb(74 47 29 / 0.12)" />
                ))}
                {active === null ? null : <rect x={x(active) - gap / 2} y={top - 6} width={width(active) + gap} height={base - top + 6} fill="rgb(184 145 63 / 0.16)" />}
                {step >= 10 ? (
                  <rect
                    x={x(last) + 0.5}
                    y={top - 5.5}
                    width={width(last) - 1}
                    height={base - top + 5}
                    fill="none"
                    stroke="rgb(74 47 29 / 0.35)"
                    strokeDasharray="3 3"
                    rx={2}
                  />
                ) : null}
                {columns}
                <line x1={0} x2={plotW} y1={base + 0.5} y2={base + 0.5} stroke="rgb(74 47 29 / 0.35)" />
                {inRange.map((marker) => {
                  const at = Math.round(x(marker.epoch - rows[0].epoch) - gap / 2) + 0.5
                  return marker.tone === 'seal' ? (
                    <g key={marker.label}>
                      <line x1={at} x2={at} y1={6} y2={base} className="stroke-seal" strokeWidth={1.5} strokeDasharray="5 3" />
                      <circle cx={at} cy={5} r={2.5} className="fill-seal" />
                    </g>
                  ) : (
                    <line key={marker.label} x1={at} x2={at} y1={top - 4} y2={base} className="stroke-muted" strokeDasharray="2 3" />
                  )
                })}
                {line ? (
                  <g>
                    <path d={path(line.points, (t) => ((t - line.from) / epochSeconds) * step, yPrice)} fill="none" stroke="rgb(245 236 214 / 0.92)" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
                    <path d={path(line.points, (t) => ((t - line.from) / epochSeconds) * step, yPrice)} fill="none" className="stroke-ink" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                    {line.fills.map(([i, fill]) => (
                      <circle key={i} cx={x(i) + width(i) / 2} cy={yPrice(fill)} r={step >= 12 ? 3 : 2} className="fill-paper stroke-ink" strokeWidth={1.1} />
                    ))}
                  </g>
                ) : null}
                {labels.map((label) => (
                  <g key={label.i}>
                    <line x1={x(label.i) + 0.5} x2={x(label.i) + 0.5} y1={base + 1} y2={base + 4} stroke="rgb(74 47 29 / 0.35)" />
                    <text
                      x={label.center ? x(label.i) + width(label.i) / 2 : x(label.i)}
                      y={height - 6}
                      textAnchor={label.i === 0 && !label.center ? 'start' : 'middle'}
                      className="num fill-muted text-[10px] font-medium"
                    >
                      {label.text}
                    </text>
                  </g>
                ))}
              </svg>
            ) : null}
            {avail > 0
              ? inRange.map((marker) => {
                  const at = x(marker.epoch - rows[0].epoch) - gap / 2
                  const flip = at > plotW * 0.55
                  // A scrolled plot starts at its right end, so only `avail` px of it show.
                  const room = Math.min(flip ? at : plotW - at, avail) - 8
                  // About 5.6 px per character at 10px semibold, plus padding.
                  const text = marker.short && marker.label.length * 5.6 + 14 > room ? marker.short : marker.label
                  const place = { ...(flip ? { right: plotW - at + 6 } : { left: at + 6 }), maxWidth: room }
                  return marker.tone === 'seal' ? (
                    <span
                      key={marker.label}
                      aria-hidden="true"
                      style={place}
                      className="pointer-events-none absolute top-0 truncate rounded-[3px] border border-seal/40 bg-paper px-1.5 py-[2px] text-[10px] leading-[1.3] font-semibold whitespace-nowrap text-seal shadow-[0_1px_0_rgb(74_47_29/0.1)]"
                    >
                      {text}
                    </span>
                  ) : (
                    <span
                      key={marker.label}
                      aria-hidden="true"
                      style={{ ...place, top: top - 2 }}
                      className="pointer-events-none absolute truncate rounded-[3px] bg-paper/85 px-1 text-[9.5px] leading-[1.4] font-semibold tracking-[0.04em] whitespace-nowrap text-muted"
                    >
                      {text}
                    </span>
                  )
                })
              : null}
          </div>
        </div>
        {line ? (
          <div aria-hidden="true" className="relative flex-none" style={{ width: AXIS_R, height }}>
            <span className={`${AXIS_TITLE} right-0`}>USDG</span>
            {line.scale.map((tick) => (
              <span key={tick} className={`${AXIS_TEXT} left-2 -translate-y-1/2`} style={{ top: yPrice(tick) }}>
                {tick.toLocaleString('en-US')}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {line ? (
        <p aria-hidden="true" className="mt-1.5 flex flex-wrap justify-end gap-x-3 gap-y-1 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[1.5px] w-4 bg-ink" />
            NET price, 4 h close
          </span>
          {line.fills.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-[7px] rounded-full border border-ink bg-paper" />
              Bond fill price
            </span>
          ) : null}
        </p>
      ) : null}
      {active === null ? null : (
        <div
          aria-hidden="true"
          style={{ left: tipLeft, top: top - 4, width: Math.min(TIP_W, outer) }}
          className="num pointer-events-none absolute z-10 rounded bg-ink px-2.5 py-2 text-[10.5px] leading-[1.45] font-semibold text-paper shadow-[0_6px_18px_-6px_rgb(23_12_8/0.55)]"
        >
          {props.tip(rows[active], active === last)}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {focused && hover === null ? props.describe(rows[cursor], cursor === last) : ''}
      </p>
    </div>
  )
}

/** Round ticks from lo to hi, about `count` steps, each 1, 2, 2.5 or 5 × 10^k. */
function ticks(lo: number, hi: number, count: number): number[] {
  const raw = Math.max(hi - lo, Math.abs(hi) * 0.02, 1e-9) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((unit) => unit * power >= raw) ?? 10) * power
  const out: number[] = []
  for (let tick = Math.floor(lo / step) * step; tick < hi + step - 1e-9; tick += step) out.push(Number(tick.toFixed(6)))
  return out.length > 1 ? out : [...out, out[0] + step]
}

/** Few epochs: date and time (or time only, when narrow) under the columns. Many: the first epoch of every 1st, 2nd, 3rd, 7th… Warsaw day. */
function dayLabels(rows: EpochRow[], step: number): Array<{ i: number; text: string; center: boolean }> {
  if (rows.length <= 12) {
    const format = step >= 92 ? DAY_TIME : TIME
    const every = Math.max(1, Math.ceil((step >= 92 ? 92 : 40) / step))
    return rows.flatMap((row, i) => (i % every === 0 ? [{ i, text: format.format(row.opensAt * 1000), center: true }] : []))
  }
  const starts = rows.flatMap((row, i) => (i > 0 && DAY.format(row.opensAt * 1000) !== DAY.format(rows[i - 1].opensAt * 1000) ? [i] : []))
  const every = [1, 2, 3, 7, 14, 30].find((days) => days * 3 * step >= 58) ?? 30
  const edge = 24 // px kept clear at both ends, so a centered label is never cut
  return starts
    .filter((_, k) => k % every === 0)
    .filter((i) => i * step > edge && (rows.length - i) * step > edge)
    .map((i) => ({ i, text: DAY.format(rows[i].opensAt * 1000), center: false }))
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function path(points: Array<[number, number]>, xOf: (t: number) => number, yOf: (value: number) => number): string {
  return points.map(([t, value], i) => `${i ? 'L' : 'M'}${xOf(t).toFixed(1)},${yOf(value).toFixed(1)}`).join('')
}
