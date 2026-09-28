import type { BuyCopy } from '../lib/buyZone.ts'

export function BuyCallout({ copy }: { copy: BuyCopy }) {
  return (
    <section aria-label="Buy spot" className="mt-4 rounded-md border border-amber/40 bg-panel px-4 py-4" data-testid="buy-callout">
      <p className="text-[11px] uppercase tracking-[0.16em] text-amber">Buy spot</p>
      <h2 className="mt-1 text-lg leading-snug text-ink">{copy.headline}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{copy.detail}</p>
      <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted">
        {copy.caveats.map((caveat) => (
          <li key={caveat} className="border-l border-line pl-2">
            {caveat}
          </li>
        ))}
      </ul>
    </section>
  )
}
