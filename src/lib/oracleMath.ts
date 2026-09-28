import { INDEX_SCALE, SPOT_SCALE, USDG_DECIMALS } from './units.ts'

export type Regime = 'nav-floor' | 'haircut' | 'cap'

/**
 * Credited USDG per NET before the dividend index:
 * clamp(TWAP × 0.90, NAV, 5 × NAV).
 * TWAP and NAV are 1e18 wad USDG per 1 NET.
 */
export function haircutTwap(twapWad: bigint): bigint {
  return (twapWad * 9_000n) / 10_000n
}

export function fiveTimesNav(navWad: bigint): bigint {
  return navWad * 5n
}

export function clampCredit(twapWad: bigint, navWad: bigint): { clampedWad: bigint; regime: Regime } {
  const haircut = haircutTwap(twapWad)
  const cap = fiveTimesNav(navWad)
  if (haircut <= navWad) return { clampedWad: navWad, regime: 'nav-floor' }
  if (haircut >= cap) return { clampedWad: cap, regime: 'cap' }
  return { clampedWad: haircut, regime: 'haircut' }
}

/** sNET.index() is a 9-decimal multiplier. 1 wsNET unwraps to index/1e9 NET. */
export function creditedPerWsNetWad(clampedPerNetWad: bigint, index: bigint): bigint {
  return (clampedPerNetWad * index) / INDEX_SCALE
}

/** Morpho oracle.price() = credited wad (USDG per wsNET) × 10^USDG decimals. */
export function morphoPriceFromCredited(creditedWad: bigint): bigint {
  return creditedWad * 10n ** BigInt(USDG_DECIMALS)
}

export function creditedFromMorphoPrice(price: bigint): bigint {
  return price / 10n ** BigInt(USDG_DECIMALS)
}

export function pauseSpotWad(twapWad: bigint): bigint {
  return (twapWad * 8_500n) / 10_000n
}

/** Docs and the oracle: pause when pool price < TWAP × 0.85. Equality still prices. */
export function isDiverged(spotWad: bigint, twapWad: bigint): boolean {
  return spotWad * 10_000n < twapWad * 8_500n
}

export function spotWadFromReserves(reserveUsdg: bigint, reserveNet: bigint): bigint | null {
  if (reserveNet <= 0n || reserveUsdg < 0n) return null
  return (reserveUsdg * SPOT_SCALE) / reserveNet
}

/** NET raw (9 decimals) received for a wsNET raw amount at the current index. */
export function netRawFromWsNet(wsRaw: bigint, index: bigint): bigint {
  return (wsRaw * index) / 10n ** 18n
}

export function twapForClamp(clampWad: bigint): bigint {
  return (clampWad * 10_000n) / 9_000n
}

export function regimeLabel(regime: Regime | null): string {
  switch (regime) {
    case 'nav-floor':
      return 'NAV floor'
    case 'haircut':
      return 'Haircut band'
    case 'cap':
      return '5× NAV cap'
    case null:
      return 'Unknown'
    default: {
      const neverRegime: never = regime
      return neverRegime
    }
  }
}
