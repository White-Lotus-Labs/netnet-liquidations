import { formatAge, formatDays, formatWad } from '../lib/format.ts'
import { regimeLabel } from '../lib/oracleMath.ts'
import { INDEX_SCALE } from '../lib/units.ts'
import type { Desk } from '../types.ts'

export function OracleStrip({
  desk,
  runwayDays,
}: {
  desk: Desk
  runwayDays: number | null
}) {
  const indexText =
    desk.index === null ? '—' : formatWad((desk.index * 10n ** 18n) / INDEX_SCALE, 4).replace(/,/g, '')
  const checkpointAge =
    desk.blockTimestamp !== null && desk.checkpointAt !== null ? desk.blockTimestamp - desk.checkpointAt : null
  const enabled = desk.liquidationsEnabled
  const lamp = enabled === true ? 'bg-mint lamp' : enabled === false ? 'bg-rose' : 'bg-faint'

  return (
    <section aria-label="Oracle strip" className="mt-3 rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${lamp}`} />
          <p className="text-[11px] uppercase tracking-[0.16em] text-faint">Loopback oracle</p>
          <p className="text-sm text-ink" data-testid="oracle-liquidations">
            {enabled === true ? 'Liquidations enabled' : enabled === false ? pauseLabel(desk.pauseReason) : 'Liquidation state unavailable'}
          </p>
        </div>
        <p className="text-xs text-muted">
          {regimeLabel(desk.regime)}
          {desk.regime === 'cap' ? ' · spot crash does not liquidate' : ''}
          {desk.regime === 'nav-floor' ? ' · credit pinned at NAV' : ''}
          {desk.regime === 'haircut' ? ' · credit = 90% of TWAP' : ''}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 xl:grid-cols-6">
        <Cell label="Spot" value={formatWad(desk.spotWad, 2)} unit="USDG / NET" testId="oracle-spot" />
        <Cell label="TWAP" value={formatWad(desk.twapWad, 2)} unit="USDG / NET" testId="oracle-twap" />
        <Cell label="NAV" value={formatWad(desk.navWad, 2)} unit="backing / NET" testId="oracle-nav" />
        <Cell
          label="Credited"
          value={formatWad(desk.creditedWad, 2)}
          unit="USDG / wsNET"
          testId="oracle-credited"
        />
        <Cell label="LLTV" value="62.5%" unit="incentive ≈ 12.7%" />
        <Cell
          label="Pause if spot"
          value={formatWad(desk.pauseSpotWad, 2)}
          unit="TWAP × 0.85"
          testId="oracle-pause"
        />
      </dl>
      <p className="px-3 py-2 text-[11px] leading-relaxed text-muted">
        Index {indexText} NET per wsNET
        {desk.checkpointAt === null ? '' : ` · TWAP checkpoint ${formatAge(checkpointAge)}`}
        {desk.twapMinSec && desk.twapMaxSec
          ? ` · valid window ${Math.round(desk.twapMinSec / 60)}m–${Math.round(desk.twapMaxSec / 3600)}h`
          : ''}
        {runwayDays !== null ? ` · flat-credit interest runway on names under 1.20 health: ${formatDays(runwayDays)}` : ''}
        . Credited value is clamp(TWAP × 0.90, NAV, 5 × NAV) × index. One wsNET is treated as {indexText} NET. Health on the ladder uses oracle.price(), the mark Morpho liquidates against.
      </p>
    </section>
  )
}

function pauseLabel(reason: Desk['pauseReason']): string {
  switch (reason) {
    case 'divergence':
      return 'Paused · spot diverged from TWAP'
    case 'twap-reverted':
      return 'Paused · TWAP unavailable'
    case 'price-reverted':
      return 'Paused · oracle price reverted'
    case 'none':
      return 'Liquidations enabled'
    case 'unknown':
      return 'Liquidation state unavailable'
    default: {
      const neverReason: never = reason
      return neverReason
    }
  }
}

function Cell({ label, value, unit, testId }: { label: string; value: string; unit: string; testId?: string }) {
  return (
    <div className="bg-panel px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</dt>
      <dd className="num mt-1 text-base text-amber" data-testid={testId}>
        {value}
      </dd>
      <dd className="text-[11px] text-muted">{unit}</dd>
    </div>
  )
}
