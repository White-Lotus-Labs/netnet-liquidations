import { LLTV } from '../config.ts'
import { twapForClamp } from './oracleMath.ts'
import {
  INDEX_SCALE,
  LIQUIDATION_CURSOR,
  MAX_LIF,
  ORACLE_PRICE_SCALE,
  WAD,
  minBigint,
} from './units.ts'

export function liquidationIncentive(lltv: bigint = LLTV): bigint {
  const denom = WAD - (LIQUIDATION_CURSOR * (WAD - lltv)) / WAD
  if (denom <= 0n) return MAX_LIF
  const lif = (WAD * WAD) / denom
  return lif < MAX_LIF ? lif : MAX_LIF
}

export function collateralValueUsdgRaw(collateralRaw: bigint, morphoPrice: bigint): bigint {
  return (collateralRaw * morphoPrice) / ORACLE_PRICE_SCALE
}

/** Health as a 1e18 wad. Below 1e18 the position can be liquidated. */
export function healthWad(
  collateralRaw: bigint,
  borrowRaw: bigint,
  morphoPrice: bigint,
): bigint | null {
  if (collateralRaw <= 0n || borrowRaw <= 0n || morphoPrice <= 0n) return null
  const value = collateralValueUsdgRaw(collateralRaw, morphoPrice)
  return (value * LLTV) / borrowRaw
}

/** Debt / credited collateral value, as a 1e18 wad. */
export function ltvWad(
  collateralRaw: bigint,
  borrowRaw: bigint,
  morphoPrice: bigint,
): bigint | null {
  if (collateralRaw <= 0n || morphoPrice <= 0n) return null
  const value = collateralValueUsdgRaw(collateralRaw, morphoPrice)
  if (value === 0n) return null
  return (borrowRaw * WAD) / value
}

/**
 * Credited USDG per wsNET (1e18 wad) at which this debt hits 62.5% LTV.
 * P = borrow / (collateral × LLTV), scaled to wad.
 */
export function liqCreditedWad(collateralRaw: bigint, borrowRaw: bigint): bigint | null {
  if (collateralRaw <= 0n || borrowRaw <= 0n) return null
  return (borrowRaw * 10n ** 48n) / (collateralRaw * LLTV)
}

export type Trigger =
  | { kind: 'liquidatable' }
  | { kind: 'twap'; twapWad: bigint }
  | { kind: 'nav'; navWad: bigint }
  | { kind: 'unavailable' }

/**
 * Price that must be reached for credited value to hit the liquidation mark.
 * Spot only matters in the haircut band. Under the NAV floor or through the
 * 5× cap, a pure spot move does not change the mark.
 */
export function liquidationTrigger(args: {
  liqCredited: bigint
  index: bigint
  navWad: bigint
  health: bigint
}): Trigger {
  if (args.index <= 0n || args.navWad <= 0n) return { kind: 'unavailable' }
  if (args.health < WAD) return { kind: 'liquidatable' }
  const clampNeeded = (args.liqCredited * INDEX_SCALE) / args.index
  const cap = args.navWad * 5n
  if (clampNeeded <= args.navWad) return { kind: 'nav', navWad: clampNeeded }
  if (clampNeeded >= cap) return { kind: 'nav', navWad: clampNeeded }
  return { kind: 'twap', twapWad: twapForClamp(clampNeeded) }
}

export type Seizure = {
  seizedWsRaw: bigint
  repaidRaw: bigint
  badDebtRaw: bigint
}

/**
 * Collateral a liquidator receives.
 * Healthy names are modeled at the boundary: seized value = debt × incentive,
 * which is LLTV × LIF ≈ 70.42% of collateral when they cross health 1.
 * Already-liquidatable names use the live oracle and can seize up to 100%.
 */
export function estimateSeizure(args: {
  collateralRaw: bigint
  borrowRaw: bigint
  morphoPrice: bigint
  health: bigint
  lif: bigint
}): Seizure {
  const { collateralRaw, borrowRaw, morphoPrice, health, lif } = args
  if (collateralRaw <= 0n || borrowRaw <= 0n || lif <= 0n) {
    return { seizedWsRaw: 0n, repaidRaw: 0n, badDebtRaw: 0n }
  }
  if (health >= WAD) {
    const seized = (collateralRaw * LLTV * lif) / WAD / WAD
    return {
      seizedWsRaw: minBigint(seized, collateralRaw),
      repaidRaw: borrowRaw,
      badDebtRaw: 0n,
    }
  }
  if (morphoPrice <= 0n) {
    return { seizedWsRaw: 0n, repaidRaw: 0n, badDebtRaw: borrowRaw }
  }
  const collValue = collateralValueUsdgRaw(collateralRaw, morphoPrice)
  const maxRepay = (collValue * WAD) / lif
  if (borrowRaw <= maxRepay) {
    const seizedValue = (borrowRaw * lif) / WAD
    const seizedWs = (seizedValue * ORACLE_PRICE_SCALE) / morphoPrice
    return {
      seizedWsRaw: minBigint(seizedWs, collateralRaw),
      repaidRaw: borrowRaw,
      badDebtRaw: 0n,
    }
  }
  return {
    seizedWsRaw: collateralRaw,
    repaidRaw: maxRepay,
    badDebtRaw: borrowRaw - maxRepay,
  }
}
