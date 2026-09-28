import type { ReactNode } from 'react'
import { LINKS } from '../config.ts'
import { facilityStats } from '../lib/model.ts'
import { formatApy, formatNet, formatRatio, formatUsdg, formatWsNet } from '../lib/format.ts'
import { netRawFromWsNet } from '../lib/oracleMath.ts'
import { ORACLE_PRICE_SCALE } from '../lib/units.ts'
import type { Desk } from '../types.ts'

export function BookHeader({ desk }: { desk: Desk }) {
  const { guideRaw, multiple } = facilityStats(desk)
  const overGuide = multiple !== null && multiple > 1
  const creditedUsdg =
    desk.collateralRaw !== null && desk.morphoPrice !== null
      ? (desk.collateralRaw * desk.morphoPrice) / ORACLE_PRICE_SCALE
      : null
  const netOutstanding =
    desk.collateralRaw !== null && desk.index !== null ? netRawFromWsNet(desk.collateralRaw, desk.index) : null
  const utilization =
    desk.utilization ??
    (desk.supplyRaw !== null && desk.borrowRaw !== null && desk.supplyRaw > 0n
      ? Number((desk.borrowRaw * 10_000n) / desk.supplyRaw) / 10_000
      : null)

  return (
    <section aria-label="Book header" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
      <Tile
        label="USDG supplied"
        value={formatUsdg(desk.supplyRaw, 0)}
        hint={`Borrow APY ${formatApy(desk.borrowApy)} · supply ${formatApy(desk.supplyApy)}`}
        testId="book-supply"
      />
      <Tile label="USDG borrowed" value={formatUsdg(desk.borrowRaw, 0)} hint="On-chain market(), else Morpho API" testId="book-borrow" />
      <Tile label="Utilization" value={formatRatio(utilization)} hint="Borrowed / supplied" testId="book-util" />
      <Tile
        label="wsNET collateral"
        value={formatWsNet(desk.collateralRaw, 1)}
        hint={
          creditedUsdg === null
            ? 'Credited value unavailable'
            : `${formatUsdg(creditedUsdg, 0)} credited · ${formatNet(netOutstanding, 0)} NET`
        }
        testId="book-collateral"
      />
      <Tile
        label="10% pool guide"
        value={guideRaw === null ? '—' : formatUsdg(guideRaw, 0)}
        hint={
          multiple === null
            ? 'Needs pool USDG depth'
            : overGuide
              ? `${multiple.toFixed(1)}× guidance — expect tranched unwinds`
              : `${multiple.toFixed(1)}× guidance`
        }
        tone={overGuide ? 'rose' : 'mint'}
        testId="book-guide"
      />
      <Tile
        label="Pool USDG depth"
        value={formatUsdg(desk.reserveUsdg, 0)}
        hint={
          <a className="text-cyan hover:underline" href={LINKS.lendingDocs} target="_blank" rel="noreferrer">
            Docs: keep borrows near 10% of depth
          </a>
        }
      />
    </section>
  )
}

function Tile({
  label,
  value,
  hint,
  tone = 'ink',
  testId,
}: {
  label: string
  value: string
  hint: ReactNode
  tone?: 'ink' | 'rose' | 'mint'
  testId?: string
}) {
  const color = tone === 'rose' ? 'text-rose' : tone === 'mint' ? 'text-mint' : 'text-ink'
  return (
    <article className="rounded-md border border-line bg-panel px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</p>
      <p className={`num mt-1 text-lg leading-none ${color}`} data-testid={testId}>
        {value}
      </p>
      <p className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</p>
    </article>
  )
}
