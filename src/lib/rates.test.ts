import { describe, expect, it } from 'vitest'
import {
  apyToApr,
  borrowApr,
  dailyFromApy,
  daysUntilBorrowApr,
  growthApr,
  projectedBorrowApy,
  rateAtTargetAfter,
} from './rates.ts'

// 29 Sep 2026 19:47Z Loopback read: apyAtTarget 31.1%, utilization 99.8%, API borrow APY 191.9%.
const RAT = apyToApr(0.311)

describe('adaptive curve', () => {
  it('reproduces the live borrow APY from rate-at-target and utilization', () => {
    expect(Math.expm1(borrowApr(RAT, 0.998))).toBeCloseTo(1.906, 2)
  })

  it('is exactly rate-at-target at 90% and a quarter of it at 0%', () => {
    expect(borrowApr(0.2, 0.9)).toBeCloseTo(0.2, 12)
    expect(borrowApr(0.2, 0)).toBeCloseTo(0.05, 12)
    expect(borrowApr(0.2, 1)).toBeCloseTo(0.8, 12)
  })

  it('doubles rate-at-target in ln2/50 years at full utilization and caps at 200%', () => {
    expect(rateAtTargetAfter(0.1, 1, (Math.LN2 / 50) * 365)).toBeCloseTo(0.2, 9)
    expect(rateAtTargetAfter(1.5, 1, 365)).toBe(2)
    expect(rateAtTargetAfter(0.1, 0.9, 30)).toBeCloseTo(0.1, 12)
  })

  it('projects a steep climb when a market is pinned near 100%', () => {
    expect(projectedBorrowApy(RAT, 0.998, 0)).toBeCloseTo(Math.expm1(borrowApr(RAT, 0.998)), 12)
    expect(projectedBorrowApy(RAT, 0.998, 7)).toBeGreaterThan(10)
  })

  it('counts days until borrow cost crosses a yield', () => {
    const days = daysUntilBorrowApr(RAT, 0.998, apyToApr(88.12))
    expect(days).not.toBeNull()
    expect(days!).toBeGreaterThan(10)
    expect(days!).toBeLessThan(11.5)
    expect(daysUntilBorrowApr(RAT, 0.998, 0.1)).toBe(0)
    expect(daysUntilBorrowApr(RAT, 0.8, 5)).toBeNull()
    expect(daysUntilBorrowApr(RAT, 0.95, 100)).toBeNull()
  })
})

describe('growth helpers', () => {
  it('turns an APY into a compounded daily rate', () => {
    expect(dailyFromApy(0)).toBe(0)
    expect((1 + dailyFromApy(1)) ** 365).toBeCloseTo(2, 9)
  })

  it('annualizes index drift between two reads', () => {
    const apr = growthApr(3.783476884, 3.857335835, 27.75 * 3600)!
    expect(Math.expm1(apr / 365)).toBeCloseTo(0.0168, 3)
    expect(growthApr(0, 1, 10)).toBeNull()
  })
})
