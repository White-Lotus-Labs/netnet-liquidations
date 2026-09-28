import { ADDRESSES } from '../config.ts'
import type { Desk, PauseReason } from '../types.ts'
import {
  clampCredit,
  creditedFromMorphoPrice,
  creditedPerWsNetWad,
  isDiverged,
  pauseSpotWad,
  spotWadFromReserves,
} from '../lib/oracleMath.ts'
import { readMorpho } from './morpho.ts'
import { readChain } from './rpc.ts'

export async function loadDesk(signal?: AbortSignal): Promise<Desk> {
  const [chainResult, morphoResult] = await Promise.allSettled([readChain(signal), readMorpho(signal)])
  if (chainResult.status === 'rejected' && morphoResult.status === 'rejected') {
    throw new Error(`${reasonText(chainResult.reason)} ${reasonText(morphoResult.reason)}`)
  }

  const chain = chainResult.status === 'fulfilled' ? chainResult.value : null
  const morpho = morphoResult.status === 'fulfilled' ? morphoResult.value : null
  const warnings: string[] = []
  if (chainResult.status === 'rejected') warnings.push(`RPC unavailable. ${reasonText(chainResult.reason)}`)
  if (morphoResult.status === 'rejected') warnings.push(`Morpho API unavailable. ${reasonText(morphoResult.reason)}`)
  if (chain) warnings.push(...chain.errors)

  const liveEnough = Boolean(
    chain?.morphoPrice ||
      chain?.reserve0 ||
      chain?.twapWad ||
      (morpho && morpho.positions.length > 0) ||
      morpho?.borrowRaw,
  )
  if (!liveEnough) {
    throw new Error(warnings.join(' ') || 'No live Loopback data')
  }

  const reserves = alignReserves(chain?.token0 ?? null, chain?.token1 ?? null, chain?.reserve0 ?? null, chain?.reserve1 ?? null, warnings)
  const spotWad =
    reserves.reserveUsdg !== null && reserves.reserveNet !== null
      ? spotWadFromReserves(reserves.reserveUsdg, reserves.reserveNet)
      : null

  const parts =
    chain?.twapWad != null && chain.navWad != null ? clampCredit(chain.twapWad, chain.navWad) : null
  const creditedFromParts =
    parts && chain?.index != null ? creditedPerWsNetWad(parts.clampedWad, chain.index) : null
  const creditedFromPrice = chain?.morphoPrice != null ? creditedFromMorphoPrice(chain.morphoPrice) : null
  if (creditedFromParts != null && creditedFromPrice != null && creditedFromPrice > 0n) {
    const deltaBps = Number(((creditedFromParts - creditedFromPrice) * 10_000n) / creditedFromPrice)
    if (Math.abs(deltaBps) > 25) {
      warnings.push(
        `Credited value reconstructed from TWAP, NAV, and index differs from oracle.price() by ${deltaBps} bps. Health follows price().`,
      )
    }
  }

  const pause = pauseState(chain?.morphoPrice ?? null, chain?.priceReverted ?? false, chain?.twapReverted ?? false, spotWad, chain?.twapWad ?? null)

  const supplyRaw = chain?.supplyRaw ?? morpho?.supplyRaw ?? null
  const borrowRaw = chain?.borrowRaw ?? morpho?.borrowRaw ?? null
  if (chain?.borrowRaw != null && morpho?.borrowRaw != null && chain.borrowRaw > 0n) {
    const driftBps = Number(((morpho.borrowRaw - chain.borrowRaw) * 10_000n) / chain.borrowRaw)
    if (Math.abs(driftBps) > 150) {
      warnings.push(
        `Morpho API borrow differs from on-chain market() by ${(driftBps / 100).toFixed(1)}%. The header uses the chain. Ladder debts are the API’s accrued figures.`,
      )
    }
  }

  const utilization =
    supplyRaw != null && borrowRaw != null && supplyRaw > 0n
      ? Number((borrowRaw * 10_000n) / supplyRaw) / 10_000
      : (morpho?.utilization ?? null)

  return {
    mode: 'live',
    fetchedAt: Date.now(),
    blockNumber: chain?.blockNumber ?? null,
    blockTimestamp: chain?.blockTimestamp ?? null,
    warnings,
    supplyRaw,
    borrowRaw,
    collateralRaw: morpho?.collateralRaw ?? null,
    utilization,
    supplyApy: morpho?.supplyApy ?? null,
    borrowApy: morpho?.borrowApy ?? null,
    chainLastUpdate: chain?.chainLastUpdate ?? null,
    spotWad,
    twapWad: chain?.twapWad ?? null,
    navWad: chain?.navWad ?? null,
    index: chain?.index ?? null,
    creditedWad: creditedFromPrice ?? creditedFromParts,
    morphoPrice: chain?.morphoPrice ?? null,
    regime: parts?.regime ?? null,
    liquidationsEnabled: pause.enabled,
    pauseReason: pause.reason,
    pauseSpotWad: chain?.twapWad != null ? pauseSpotWad(chain.twapWad) : null,
    checkpointAt: chain?.checkpointAt ?? null,
    twapMinSec: chain?.twapMinSec ?? null,
    twapMaxSec: chain?.twapMaxSec ?? null,
    reserveUsdg: reserves.reserveUsdg,
    reserveNet: reserves.reserveNet,
    positions: morpho?.positions ?? [],
    borrowerCount: morpho?.borrowerCount ?? null,
    footnote: morpho?.footnote ?? null,
  }
}

function alignReserves(
  token0: string | null,
  token1: string | null,
  reserve0: bigint | null,
  reserve1: bigint | null,
  warnings: string[],
): { reserveUsdg: bigint | null; reserveNet: bigint | null } {
  if (reserve0 === null || reserve1 === null || !token0 || !token1) {
    return { reserveUsdg: null, reserveNet: null }
  }
  const t0 = token0.toLowerCase()
  const t1 = token1.toLowerCase()
  const usdg = ADDRESSES.usdg.toLowerCase()
  const net = ADDRESSES.net.toLowerCase()
  if (t0 === usdg && t1 === net) return { reserveUsdg: reserve0, reserveNet: reserve1 }
  if (t0 === net && t1 === usdg) return { reserveUsdg: reserve1, reserveNet: reserve0 }
  warnings.push('Canonical pair tokens did not match NET and USDG. Spot and impact are unavailable.')
  return { reserveUsdg: null, reserveNet: null }
}

function pauseState(
  morphoPrice: bigint | null,
  priceReverted: boolean,
  twapReverted: boolean,
  spotWad: bigint | null,
  twapWad: bigint | null,
): { enabled: boolean | null; reason: PauseReason } {
  if (morphoPrice != null) return { enabled: true, reason: 'none' }
  if (!priceReverted && morphoPrice == null) return { enabled: null, reason: 'unknown' }
  if (spotWad != null && twapWad != null && isDiverged(spotWad, twapWad)) {
    return { enabled: false, reason: 'divergence' }
  }
  if (twapReverted) return { enabled: false, reason: 'twap-reverted' }
  return { enabled: false, reason: 'price-reverted' }
}

function reasonText(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Request failed'
}
