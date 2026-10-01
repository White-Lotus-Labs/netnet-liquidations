import { useState } from 'react'
import { cx, formatHealth, formatNet, formatPercentWad, formatUsdg, formatWad } from '../lib/format.ts'
import type { EnrichedPosition } from '../lib/model.ts'
import { WAD } from '../lib/units.ts'
import { Hint, Section, Who } from './ui.tsx'

const NEAR = WAD / 5n // within 20% of the liquidation line
const DUST = 1_000_000n // under 1 USDG of debt
const SHORT_LIST = 15

export function Ladder({
  rows,
  borrowerCount,
  labels,
  vaultBorrowers,
}: {
  rows: EnrichedPosition[]
  borrowerCount: number | null
  labels: Map<string, string>
  vaultBorrowers: Set<string>
}) {
  const [all, setAll] = useState(false)
  const [dust, setDust] = useState(false)
  const [query, setQuery] = useState('')
  const real = rows.filter((row) => row.borrowRaw >= DUST)
  const near = real.filter((row) => row.distanceWad !== null && row.distanceWad < NEAR)
  const needle = query.trim().toLowerCase()
  const shown = all
    ? (dust ? rows : real).filter((row) => !needle || row.address.toLowerCase().includes(needle))
    : near.slice(0, SHORT_LIST)
  const nearDebt = near.reduce((sum, row) => sum + row.borrowRaw, 0n)
  const nearNet = near.reduce((sum, row) => sum + (row.seizedNetRaw ?? 0n), 0n)

  return (
    <Section
      id="ladder"
      testId="ladder"
      seal="梯"
      eyebrow="Loopback borrowers · Morpho"
      title="Next to"
      accent="liquidate"
      answer={
        near.length === 0 ? (
          <>
            No borrower sits <Hint id="nearLiquidation">within 20% of liquidation</Hint>.
          </>
        ) : (
          <>
            {near.length} borrower{near.length === 1 ? '' : 's'} sit <Hint id="nearLiquidation">within 20% of liquidation</Hint>. They owe{' '}
            {formatUsdg(nearDebt, 0)} USDG and would send {formatNet(nearNet, 2)} NET to market.
          </>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <button
          type="button"
          className="min-h-8 cursor-pointer rounded-[3px] border border-[rgb(74_47_29/0.32)] bg-[rgb(255_252_243/0.6)] px-3 font-semibold tracking-[0.06em] text-ink hover:border-accent/60"
          aria-expanded={all}
          onClick={() => setAll((value) => !value)}
        >
          {all ? 'Show the nearest' : `Show all ${real.length.toLocaleString('en-US')}`}
        </button>
        {borrowerCount !== null && borrowerCount > rows.length ? <span>of {borrowerCount.toLocaleString('en-US')} indexed</span> : null}
        {all ? (
          <>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter address"
              aria-label="Filter borrowers by address"
              className="w-44 rounded border border-[rgb(74_47_29/0.3)] bg-field px-2 py-1 text-sm text-ink outline-none placeholder:text-muted"
            />
            {rows.length > real.length ? (
              <span className="inline-flex items-center">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={dust} onChange={(event) => setDust(event.target.checked)} className="accent-accent" />
                  Include dust ({rows.length - real.length})
                </label>
                <Hint id="dust" />
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      <div className={cx('mt-3 overflow-x-auto', all && 'max-h-[34rem] overflow-y-auto')}>
        <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
          <thead className="sticky top-0 bg-paper text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            <tr className="border-b border-line">
              <th className="px-2.5 pb-1.5 font-semibold">Who</th>
              <th className="px-2.5 pb-1.5 text-right font-semibold">Debt USDG</th>
              <th className="px-2.5 pb-1.5 text-right font-semibold">
                <Hint id="netToMarket">NET to market</Hint>
              </th>
              <th className="px-2.5 pb-1.5 text-right font-semibold">
                <Hint id="priceToLiq">Price to liq</Hint>
              </th>
              <th className="px-2.5 pb-1.5 text-right font-semibold">
                <Hint id="health">Health</Hint>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2.5 py-6 text-center text-muted">
                  {all ? 'No address matches that filter.' : 'Show all to see the full book.'}
                </td>
              </tr>
            ) : (
              shown.map((row) => {
                const key = row.address.toLowerCase()
                const liq = trigger(row)
                return (
                  <tr key={row.address} className="border-b border-line last:border-b-0 hover:bg-gold/10">
                    <td className="px-2.5 py-1.5">
                      <Who address={row.address} label={labels.get(key) ?? null} tags={vaultBorrowers.has(key) ? ['Credit-vault borrower'] : undefined} />
                    </td>
                    <td className="num px-2.5 py-1.5 text-right font-semibold">{formatUsdg(row.borrowRaw, 0)}</td>
                    <td className="num px-2.5 py-1.5 text-right">{formatNet(row.seizedNetRaw, 2)}</td>
                    <td className="px-2.5 py-1.5 text-right">
                      <span className="num block text-ink">{liq.price}</span>
                      <span className="num block text-[11px] text-muted">{liq.note}</span>
                    </td>
                    <td className={cx('num px-2.5 py-1.5 text-right', healthClass(row.healthWad))}>
                      {formatHealth(row.healthWad)}
                      {row.healthSource === 'indexed' ? (
                        <span className="ml-1 text-[10px] text-muted">
                          <Hint id="healthIndexed">idx</Hint>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

function healthClass(health: bigint | null): string {
  if (health === null) return 'text-muted'
  if (health < 1_050_000_000_000_000_000n) return 'text-seal'
  if (health < 1_100_000_000_000_000_000n) return 'text-warn'
  return 'text-ink'
}

function trigger(row: EnrichedPosition): { price: string; note: string } {
  const drop = row.distanceWad === null ? '' : formatPercentWad(-row.distanceWad, 1)
  switch (row.trigger.kind) {
    case 'twap':
      return { price: formatWad(row.trigger.twapWad, 2), note: `TWAP · ${drop}` }
    case 'nav':
      return { price: formatWad(row.trigger.navWad, 2), note: `NAV · ${drop}` }
    case 'liquidatable':
      return { price: 'Now', note: 'past the line' }
    case 'unavailable':
      return { price: '—', note: 'no oracle mark' }
    default: {
      const neverTrigger: never = row.trigger
      return neverTrigger
    }
  }
}
