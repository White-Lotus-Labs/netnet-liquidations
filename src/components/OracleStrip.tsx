import { cx, formatAge, formatPercentWad, formatWad } from '../lib/format.ts'
import { regimeLabel } from '../lib/oracleMath.ts'
import { WAD } from '../lib/units.ts'
import type { Desk } from '../types.ts'
import { Chip, Kpi, KpiRow, Section } from './ui.tsx'

/** Status strip: can forced selling happen now? */
export function OracleStrip({ desk }: { desk: Desk }) {
  const enabled = desk.liquidationsEnabled
  const dot = enabled === true ? 'bg-jade shadow-[0_0_0_3px_rgb(44_110_82/0.16)]' : enabled === false ? 'bg-seal' : 'bg-muted'
  const checkpointAge =
    desk.blockTimestamp !== null && desk.checkpointAt !== null ? desk.blockTimestamp - desk.checkpointAt : null
  const cushion =
    desk.spotWad !== null && desk.pauseSpotWad !== null && desk.spotWad > 0n
      ? ((desk.spotWad - desk.pauseSpotWad) * WAD) / desk.spotWad
      : null
  const meaning = desk.regime === null ? '' : `${regimeLabel(desk.regime)}: ${REGIME_MEANING[desk.regime]}`

  return (
    <Section
      id="status"
      testId="status-strip"
      seal="价"
      eyebrow="Loopback oracle · Onchain"
      title="Liquidation"
      accent="status"
      answer={
        <>
          <span aria-hidden="true" className={cx('mr-2 inline-block size-[7px] -translate-y-px rounded-full align-middle', dot)} />
          <span data-testid="oracle-liquidations">{statusLabel(enabled, desk.pauseReason)}</span> {meaning}
        </>
      }
    >
      <KpiRow cols={4}>
        <Kpi label="Spot" value={formatWad(desk.spotWad, 2)} hint="USDG/NET, canonical pool" />
        <Kpi
          label="TWAP"
          value={formatWad(desk.twapWad, 2)}
          hint={checkpointAge === null ? 'USDG/NET' : <Chip>Checkpoint {formatAge(checkpointAge)}</Chip>}
        />
        <Kpi label="NAV" value={formatWad(desk.navWad, 2)} hint="Backing per NET" />
        <Kpi
          label="Pause below"
          value={formatWad(desk.pauseSpotWad, 2)}
          hint={cushion === null ? 'TWAP × 0.85' : `Spot ${formatPercentWad(cushion, 1)} above`}
          tone={cushion !== null && cushion < WAD / 20n ? 'warn' : undefined}
        />
      </KpiRow>
    </Section>
  )
}

const REGIME_MEANING = {
  haircut: 'credit is 90% of TWAP, so a TWAP fall moves health.',
  cap: 'credit is pinned at 5× NAV, so a spot crash does not liquidate.',
  'nav-floor': 'credit is pinned at NAV, so spot weakness does not liquidate.',
} as const

function statusLabel(enabled: boolean | null, reason: Desk['pauseReason']): string {
  if (enabled === true) return 'Liquidations are on.'
  if (enabled === null) return 'Liquidation state is unavailable.'
  switch (reason) {
    case 'divergence':
      return 'Liquidations are paused: spot is more than 15% under TWAP.'
    case 'twap-reverted':
      return 'Liquidations are paused: TWAP is unavailable.'
    case 'price-reverted':
      return 'Liquidations are paused: the oracle price reverts.'
    case 'none':
    case 'unknown':
      return 'Liquidations are paused.'
    default: {
      const neverReason: never = reason
      return neverReason
    }
  }
}
