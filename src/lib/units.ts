export const WAD = 10n ** 18n
export const INDEX_SCALE = 10n ** 9n
export const ORACLE_PRICE_SCALE = 10n ** 36n
export const USDG_DECIMALS = 6
export const NET_DECIMALS = 9
export const WSNET_DECIMALS = 18

/** Morpho Blue liquidation cursor (30%). */
export const LIQUIDATION_CURSOR = 300_000_000_000_000_000n
/** Morpho Blue cap on the liquidation incentive factor (15%). */
export const MAX_LIF = 1_150_000_000_000_000_000n

/**
 * Loopback spot scale. USDG is 6 decimals and NET is 9, so
 * USDG-per-NET in 1e18 wad = reserveUsdg * 1e21 / reserveNet.
 * Same constant the oracle multiplies into getReserves().
 */
export const SPOT_SCALE = 10n ** 21n

/** Uniswap v2 pair fee: balance * 1000 - amountIn * 3. */
export const PAIR_FEE_NUMER = 997n
export const PAIR_FEE_DENOM = 1000n

export const VIRTUAL_SHARES = 1_000_000n
export const VIRTUAL_ASSETS = 1n

export function minBigint(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

export function maxBigint(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

export function isqrt(value: bigint): bigint {
  if (value < 0n) {
    throw new Error('square root of a negative')
  }
  if (value < 2n) return value
  let x = value
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }
  return x
}
