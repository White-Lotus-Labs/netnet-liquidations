import { useState } from 'react'
import { cx, formatHealth, formatPercentWad, formatUsdg, formatWad, formatWsNet, shortAddress } from '../lib/format.ts'
import type { Trigger } from '../lib/liquidation.ts'
import { LABEL_TONE, labelClass } from '../lib/flows.ts'
import type { EnrichedPosition } from '../lib/model.ts'
import { WAD } from '../lib/units.ts'

export function Ladder({
  rows,
  borrowerCount,
  labels,
}: {
  rows: EnrichedPosition[]
  borrowerCount: number | null
  labels: Map<string, string>
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? rows.filter((row) => row.address.toLowerCase().includes(query.trim().toLowerCase()))
    : rows

  return (
    <section aria-label="Liquidation ladder" className="rounded-md border border-line bg-panel" data-testid="ladder">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 py-2.5">
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.16em] text-faint">Liquidation ladder</h2>
          <p className="mt-1 text-sm text-ink">
            {rows.length.toLocaleString('en-US')} open borrows
            {borrowerCount !== null && borrowerCount !== rows.length ? ` of ${borrowerCount.toLocaleString('en-US')} indexed` : ''}
            , weakest health first
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter address"
          aria-label="Filter ladder by address"
          className="w-full rounded border border-line bg-desk px-2 py-1 text-sm text-ink outline-none placeholder:text-faint focus:border-amber sm:w-44"
        />
      </div>
      <div className="max-h-[34rem] overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-panel-2 text-[11px] uppercase tracking-[0.12em] text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium text-right">wsNET</th>
              <th className="px-3 py-2 font-medium text-right">Debt USDG</th>
              <th className="px-3 py-2 font-medium text-right">Health</th>
              <th className="px-3 py-2 font-medium text-right">LTV</th>
              <th className="px-3 py-2 font-medium text-right">Price to liq</th>
              <th className="px-3 py-2 font-medium text-right">Distance</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  {rows.length === 0 ? 'No open borrows returned.' : 'No address matches that filter.'}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.address} className="border-t border-line/80 hover:bg-panel-2">
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      className="num text-cyan hover:underline"
                      title={copied === row.address ? 'Copied' : row.address}
                      onClick={() => {
                        void navigator.clipboard?.writeText(row.address).then(
                          () => {
                            setCopied(row.address)
                            window.setTimeout(() => setCopied((current) => (current === row.address ? null : current)), 1200)
                          },
                          () => setCopied(null),
                        )
                      }}
                    >
                      {shortAddress(row.address)}
                    </button>
                    <Label text={labels.get(row.address.toLowerCase()) ?? null} />
                  </td>
                  <td className="num px-3 py-1.5 text-right">{formatWsNet(row.collateralRaw, 2)}</td>
                  <td className="num px-3 py-1.5 text-right">{formatUsdg(row.borrowRaw, 0)}</td>
                  <td className={cx('num px-3 py-1.5 text-right', healthClass(row.healthWad))}>
                    {formatHealth(row.healthWad)}
                    {row.healthSource === 'indexed' ? <span className="ml-1 text-[10px] text-faint">idx</span> : null}
                  </td>
                  <td className="num px-3 py-1.5 text-right">{formatPercentWad(row.ltvWad, 1)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="num block text-ink">{triggerPrimary(row.trigger)}</span>
                    <span className="block text-[10px] text-faint">{triggerSecondary(row.trigger)}</span>
                  </td>
                  <td className={cx('num px-3 py-1.5 text-right', distanceClass(row.distanceWad))}>
                    {formatPercentWad(row.distanceWad, 1)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Label({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <span className={cx('block max-w-[11rem] truncate text-[10px]', LABEL_TONE[labelClass(text) ?? 'other'])} title={`Nansen: ${text}`}>
      {text}
    </span>
  )
}

function healthClass(health: bigint | null): string {
  if (health === null) return 'text-muted'
  if (health < WAD) return 'text-rose'
  if (health < 1_050_000_000_000_000_000n) return 'text-rose'
  if (health < 1_100_000_000_000_000_000n) return 'text-amber'
  if (health < 1_200_000_000_000_000_000n) return 'text-amber-dim'
  return 'text-mint'
}

function distanceClass(distance: bigint | null): string {
  if (distance === null) return 'text-muted'
  if (distance < 0n) return 'text-rose'
  if (distance < 50_000_000_000_000_000n) return 'text-amber'
  return 'text-muted'
}

function triggerPrimary(trigger: Trigger): string {
  switch (trigger.kind) {
    case 'twap':
      return formatWad(trigger.twapWad, 2)
    case 'nav':
      return formatWad(trigger.navWad, 2)
    case 'liquidatable':
      return 'Now'
    case 'unavailable':
      return '—'
    default: {
      const neverTrigger: never = trigger
      return neverTrigger
    }
  }
}

function triggerSecondary(trigger: Trigger): string {
  switch (trigger.kind) {
    case 'twap':
      return 'TWAP USDG/NET'
    case 'nav':
      return 'NAV · spot-immune'
    case 'liquidatable':
      return 'line already crossed'
    case 'unavailable':
      return 'oracle mark missing'
    default: {
      const neverTrigger: never = trigger
      return neverTrigger
    }
  }
}
