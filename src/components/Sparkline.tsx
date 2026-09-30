type Series = { values: number[]; className: string; label: string; dashed?: boolean }

/** Minimal shared-axis line chart. Each series is scaled to the same y range. */
export function Sparkline({ series, height = 56, floor }: { series: Series[]; height?: number; floor?: number }) {
  const width = 300
  const all = series.flatMap((line) => line.values).filter(Number.isFinite)
  if (all.length < 2) return <p className="text-xs text-muted">Not enough history to draw.</p>
  const min = floor ?? Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const path = (values: number[]) =>
    values
      .map((value, i) =>
        Number.isFinite(value)
          ? `${((i / Math.max(values.length - 1, 1)) * width).toFixed(1)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`
          : null,
      )
      .filter(Boolean)
      .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} role="img" aria-label={series.map((line) => line.label).join(', ')}>
      {series.map((line) => (
        <polyline
          key={line.label}
          points={path(line.values)}
          fill="none"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={line.dashed ? '4 3' : undefined}
          className={line.className}
        />
      ))}
    </svg>
  )
}
