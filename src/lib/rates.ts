/**
 * Morpho AdaptiveCurveIrm, in continuous APR. Constants match the deployed IRM
 * (0x2BD3…0fa1): 90% target, steepness 4, speed 50/yr, rate-at-target bounds 0.1%–200%.
 * Morpho accrues with a trapezoid average between updates; this projects the
 * endpoint at constant utilization, which is what "if nothing changes" means.
 */
export const TARGET_UTILIZATION = 0.9
const CURVE_STEEPNESS = 4
const ADJUSTMENT_SPEED = 50
const MIN_RATE_AT_TARGET = 0.001
const MAX_RATE_AT_TARGET = 2

export const apyToApr = (apy: number): number => Math.log1p(apy)
export const aprToApy = (apr: number): number => Math.expm1(apr)
/** Compounded daily rate from an APY. */
export const dailyFromApy = (apy: number): number => Math.expm1(Math.log1p(apy) / 365)

function errorOf(utilization: number): number {
  return utilization > TARGET_UTILIZATION
    ? (utilization - TARGET_UTILIZATION) / (1 - TARGET_UTILIZATION)
    : (utilization - TARGET_UTILIZATION) / TARGET_UTILIZATION
}

function curve(err: number): number {
  const slope = err < 0 ? 1 - 1 / CURVE_STEEPNESS : CURVE_STEEPNESS - 1
  return 1 + slope * err
}

function clampTarget(apr: number): number {
  return Math.min(Math.max(apr, MIN_RATE_AT_TARGET), MAX_RATE_AT_TARGET)
}

export function borrowApr(rateAtTargetApr: number, utilization: number): number {
  return rateAtTargetApr * curve(errorOf(utilization))
}

export function rateAtTargetAfter(rateAtTargetApr: number, utilization: number, days: number): number {
  return clampTarget(rateAtTargetApr * Math.exp((ADJUSTMENT_SPEED * errorOf(utilization) * days) / 365))
}

/** Borrow APY after `days` if utilization holds. */
export function projectedBorrowApy(rateAtTargetApr: number, utilization: number, days: number): number {
  return aprToApy(borrowApr(rateAtTargetAfter(rateAtTargetApr, utilization, days), utilization))
}

/**
 * Days until the borrow APR reaches `targetApr` at constant utilization.
 * 0 when already there. null when it never gets there (rates falling, or the
 * 200% rate-at-target ceiling stops short).
 */
export function daysUntilBorrowApr(rateAtTargetApr: number, utilization: number, targetApr: number): number | null {
  if (borrowApr(rateAtTargetApr, utilization) >= targetApr) return 0
  const err = errorOf(utilization)
  if (err <= 0) return null
  const needed = targetApr / curve(err)
  if (needed > MAX_RATE_AT_TARGET) return null
  return (Math.log(needed / rateAtTargetApr) / (ADJUSTMENT_SPEED * err)) * 365
}

/** Continuous per-year growth between two index reads. */
export function growthApr(from: number, to: number, seconds: number): number | null {
  if (!(from > 0) || !(to > 0) || !(seconds > 0)) return null
  return (Math.log(to / from) * 365 * 86_400) / seconds
}
