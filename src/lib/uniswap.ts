import { PAIR_FEE_DENOM, PAIR_FEE_NUMER, SPOT_SCALE, isqrt } from './units.ts'

export type Reserves = {
  reserveUsdg: bigint
  reserveNet: bigint
}

/** Constant-product USDG out for selling NET into the canonical pair (0.30% fee). */
export function quoteUsdgOut(netInRaw: bigint, reserves: Reserves): bigint {
  if (netInRaw <= 0n || reserves.reserveNet <= 0n || reserves.reserveUsdg <= 0n) return 0n
  const inWithFee = netInRaw * PAIR_FEE_NUMER
  return (reserves.reserveUsdg * inWithFee) / (reserves.reserveNet * PAIR_FEE_DENOM + inWithFee)
}

export function priceAfterSell(netInRaw: bigint, reserves: Reserves): bigint | null {
  if (reserves.reserveNet <= 0n) return null
  const out = quoteUsdgOut(netInRaw, reserves)
  if (out >= reserves.reserveUsdg) return 0n
  const nextNet = reserves.reserveNet + netInRaw
  const nextUsdg = reserves.reserveUsdg - out
  if (nextNet === 0n) return null
  return (nextUsdg * SPOT_SCALE) / nextNet
}

/**
 * Move the pool to `targetSpotWad` while keeping k = x·y.
 * Used only as a hypothetical for "TWAP has fallen and spot has reconverged".
 */
export function repriceReserves(reserves: Reserves, targetSpotWad: bigint): Reserves | null {
  if (targetSpotWad <= 0n || reserves.reserveNet <= 0n || reserves.reserveUsdg <= 0n) return null
  const k = reserves.reserveUsdg * reserves.reserveNet
  const nextNet = isqrt((k * SPOT_SCALE) / targetSpotWad)
  if (nextNet === 0n) return null
  return { reserveNet: nextNet, reserveUsdg: k / nextNet }
}

export type CurvePoint = {
  netRaw: bigint
  priceWad: bigint
}

export function impactCurve(maxNetRaw: bigint, reserves: Reserves, steps = 36): CurvePoint[] {
  const points: CurvePoint[] = []
  const safeSteps = steps < 1 ? 1 : steps
  for (let i = 0; i <= safeSteps; i += 1) {
    const qty = (maxNetRaw * BigInt(i)) / BigInt(safeSteps)
    const price = priceAfterSell(qty, reserves)
    if (price === null) continue
    points.push({ netRaw: qty, priceWad: price })
  }
  return points
}

export function moveBps(before: bigint, after: bigint): bigint | null {
  if (before === 0n) return null
  return ((after - before) * 10_000n) / before
}
