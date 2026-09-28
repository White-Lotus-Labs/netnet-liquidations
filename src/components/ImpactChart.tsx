import { useId, useState } from 'react'
import { formatNet, wadToNumber } from '../lib/format.ts'
import type { CurvePoint } from '../lib/uniswap.ts'
import { NET_DECIMALS } from '../lib/units.ts'

type AggPoint = { netRaw: bigint; priceWad: bigint }

type Props = {
  curve: CurvePoint[]
  agg: AggPoint[]
  aggLabel: string
  markerNetRaw: bigint | null
  spotWad: bigint | null
  twapWad: bigint | null
  navWad: bigint | null
  pauseWad: bigint | null
  bandLow: bigint | null
  bandHigh: bigint | null
}

const VB = { w: 680, h: 268, left: 54, right: 14, top: 16, bottom: 34 }

export function ImpactChart(props: Props) {
  const { curve } = props
  const labelId = useId()
  const [hoverNet, setHoverNet] = useState<number | null>(null)

  if (curve.length < 2 && props.agg.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center rounded border border-dashed border-line text-sm text-muted" data-testid="impact-chart">
        Pool reserves and router quotes unavailable — impact curve not drawn.
      </div>
    )
  }

  const points = curve.map((point) => ({
    net: humanNet(point.netRaw),
    price: wadToNumber(point.priceWad),
  }))
  const aggPoints = props.agg.map((point) => ({
    net: humanNet(point.netRaw),
    price: wadToNumber(point.priceWad),
  }))
  const maxNet = Math.max(...points.map((point) => point.net), ...aggPoints.map((point) => point.net), 0.0001)
  const prices = [
    ...points.map((point) => point.price),
    ...aggPoints.map((point) => point.price),
    ...[props.spotWad, props.twapWad, props.navWad, props.pauseWad, props.bandLow, props.bandHigh]
      .filter((value): value is bigint => value !== null)
      .map((value) => wadToNumber(value)),
  ].filter((value) => Number.isFinite(value) && value > 0)
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const pad = Math.max((maxPrice - minPrice) * 0.08, maxPrice * 0.01)
  const yMin = Math.max(0, minPrice - pad)
  const yMax = maxPrice + pad
  const plotW = VB.w - VB.left - VB.right
  const plotH = VB.h - VB.top - VB.bottom

  const xOf = (net: number) => VB.left + (net / maxNet) * plotW
  const yOf = (price: number) => VB.top + (1 - (price - yMin) / (yMax - yMin || 1)) * plotH

  const path = polyline(points, xOf, yOf)
  const aggPath = polyline(aggPoints, xOf, yOf)
  const markerNet = props.markerNetRaw === null ? null : wadToNumber(props.markerNetRaw * 10n ** BigInt(18 - NET_DECIMALS))
  const band =
    props.bandLow !== null && props.bandHigh !== null
      ? { low: wadToNumber(props.bandLow), high: wadToNumber(props.bandHigh) }
      : null
  const hoverCanon = hoverNet === null ? null : nearest(points, hoverNet)
  const hoverAgg = hoverNet === null ? null : nearest(aggPoints, hoverNet)

  const yTicks = [0, 1, 2, 3].map((step) => yMin + ((yMax - yMin) * step) / 3)
  const xTicks = [0, 1, 2, 3].map((step) => (maxNet * step) / 3)

  return (
    <div data-testid="impact-chart">
      <svg
        viewBox={`0 0 ${VB.w} ${VB.h}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={labelId}
        onMouseLeave={() => setHoverNet(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const rel = ((event.clientX - rect.left) / rect.width) * VB.w
          const net = ((rel - VB.left) / plotW) * maxNet
          setHoverNet(net)
        }}
      >
        <title id={labelId}>Router average fill versus the canonical Uniswap v2 price after a NET sale</title>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={VB.left} x2={VB.w - VB.right} y1={yOf(tick)} y2={yOf(tick)} stroke="#2a3344" strokeWidth="1" />
            <text x={VB.left - 6} y={yOf(tick) + 3} textAnchor="end" fill="#667386" fontSize="10" fontFamily="IBM Plex Mono, monospace">
              {tick.toFixed(0)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={tick} x={xOf(tick)} y={VB.h - 10} textAnchor="middle" fill="#667386" fontSize="10" fontFamily="IBM Plex Mono, monospace">
            {tick.toFixed(tick >= 100 ? 0 : 1)}
          </text>
        ))}
        {band ? (
          <rect
            x={VB.left}
            width={plotW}
            y={Math.min(yOf(band.low), yOf(band.high))}
            height={Math.abs(yOf(band.low) - yOf(band.high))}
            fill="#e6b35a"
            opacity="0.14"
          />
        ) : null}
        <Level y={props.navWad} color="#667386" dashed xOf={xOf} yOf={yOf} maxNet={maxNet} />
        <Level y={props.pauseWad} color="#e07a86" dashed xOf={xOf} yOf={yOf} maxNet={maxNet} />
        <Level y={props.twapWad} color="#e6b35a" xOf={xOf} yOf={yOf} maxNet={maxNet} />
        <Level y={props.spotWad} color="#7fd1c7" xOf={xOf} yOf={yOf} maxNet={maxNet} />
        {path ? <path d={path} fill="none" stroke="#93b4ea" strokeWidth="1.75" strokeDasharray="5 4" /> : null}
        {aggPath ? <path d={aggPath} fill="none" stroke="#8fceab" strokeWidth="2.25" /> : null}
        {markerNet !== null && markerNet > 0 ? (
          <line x1={xOf(markerNet)} x2={xOf(markerNet)} y1={VB.top} y2={VB.top + plotH} stroke="#e6b35a" strokeDasharray="3 3" />
        ) : null}
        {hoverAgg ? <circle cx={xOf(hoverAgg.net)} cy={yOf(hoverAgg.price)} r="3.5" fill="#8fceab" /> : null}
        {hoverCanon ? <circle cx={xOf(hoverCanon.net)} cy={yOf(hoverCanon.price)} r="3" fill="#93b4ea" /> : null}
        <text x={VB.left} y={12} fill="#93a0b3" fontSize="10">
          USDG/NET
        </text>
        <text x={VB.w - VB.right} y={VB.h - 10} textAnchor="end" fill="#93a0b3" fontSize="10">
          NET sold
        </text>
      </svg>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted">
        <Legend color="#8fceab" label={props.aggLabel} />
        <Legend color="#93b4ea" label="Canonical Uniswap v2 only" />
        <Legend color="#7fd1c7" label="Spot" />
        <Legend color="#e6b35a" label="TWAP / buy zone" />
        <Legend color="#e07a86" label="Pause (TWAP × 0.85)" />
        <Legend color="#667386" label="NAV" />
        <span className="num text-ink">
          {hoverNet !== null
            ? `${hoverNet.toFixed(1)} NET · router ${hoverAgg ? hoverAgg.price.toFixed(2) : '—'} · pair ${hoverCanon ? hoverCanon.price.toFixed(2) : '—'}`
            : props.markerNetRaw
              ? `Marker ${formatNet(props.markerNetRaw, 2)} NET`
              : 'Hover the curve'}
        </span>
      </div>
    </div>
  )
}

function Level({
  y,
  color,
  dashed,
  yOf,
  xOf,
  maxNet,
}: {
  y: bigint | null
  color: string
  dashed?: boolean
  yOf: (price: number) => number
  xOf: (net: number) => number
  maxNet: number
}) {
  if (y === null) return null
  const py = yOf(wadToNumber(y))
  return (
    <line
      x1={xOf(0)}
      x2={xOf(maxNet)}
      y1={py}
      y2={py}
      stroke={color}
      strokeWidth="1"
      strokeDasharray={dashed ? '4 4' : undefined}
      opacity="0.85"
    />
  )
}

function nearest(points: Array<{ net: number; price: number }>, net: number): { net: number; price: number } | null {
  let best: { net: number; price: number } | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const point of points) {
    const dist = Math.abs(point.net - net)
    if (dist < bestDist) {
      best = point
      bestDist = dist
    }
  }
  return best
}

function humanNet(netRaw: bigint): number {
  return wadToNumber(netRaw * 10n ** BigInt(18 - NET_DECIMALS))
}

function polyline(
  points: Array<{ net: number; price: number }>,
  xOf: (net: number) => number,
  yOf: (price: number) => number,
): string {
  if (points.length < 2) return ''
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xOf(point.net).toFixed(1)} ${yOf(point.price).toFixed(1)}`)
    .join(' ')
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-0.5 w-3" style={{ background: color }} />
      {label}
    </span>
  )
}
