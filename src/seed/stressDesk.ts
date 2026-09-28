import { LLTV } from '../config.ts'
import { healthWad } from '../lib/liquidation.ts'
import {
  clampCredit,
  creditedPerWsNetWad,
  morphoPriceFromCredited,
  pauseSpotWad,
  spotWadFromReserves,
} from '../lib/oracleMath.ts'
import { ORACLE_PRICE_SCALE } from '../lib/units.ts'
import type { Desk, RawPosition } from '../types.ts'

/** Block time of the attached stress read. */
export const STRESS_SNAPSHOT_AT = Date.parse('2026-09-28T18:02:43+02:00')
export const STRESS_SNAPSHOT_BLOCK = 74_925_656

/**
 * Weakest 30 borrowers from seed/wsnet-morpho-liquidation-stress-2026-09-28.md.
 * Debt is the reported USDG. Health is the reported HF. Collateral is solved so
 * this desk's oracle math reproduces that health.
 */
const WEAKEST_30: ReadonlyArray<readonly [string, string, string]> = [
  ['0x505BD4496939C8763Ad84717305E71EB1fF9D472', '0.30', '1.0063'],
  ['0xffF15DB33ca3187dFEE2C9bDb7BCDAC89172Dae9', '1051.08', '1.0068'],
  ['0x47852Fdb50952ea95E845b02366c2f7E728e4b4F', '2363.66', '1.0341'],
  ['0x8cE1dE121ee39E6539B0e8F52373Fec4eBB1eCB9', '25.88', '1.0434'],
  ['0x3Fb50b14058BB5bffbf871eE973f7ccdDE7ff426', '2130.98', '1.0451'],
  ['0x42b0A676617490466877B9F9239d8FF35bfaa9d1', '8.01', '1.0504'],
  ['0xCD2adEe11bF6b79a4a197D8f80e2b575d2412781', '8263.08', '1.0618'],
  ['0xDd583ca50e583380E4746e5E740ed0E02fb25559', '170.86', '1.0662'],
  ['0xef14EBD0f14f1fECFBe3b1016718BF913A16a291', '1347.59', '1.0674'],
  ['0x1A513863f9235b0D6ad7fAbbdd0f1062E9C0491c', '22.94', '1.0740'],
  ['0x31a16c9d3A30334CA002dA04F38ee9688EcFA40a', '210.32', '1.0850'],
  ['0xE690341E50dce63c764Ce7E0A6e923349d77ae2F', '3028.63', '1.0853'],
  ['0x7F67C0bd79A988879Bd6cF9e02800741A657db3C', '475.01', '1.0860'],
  ['0x46d9F5add63A0603065Bd1284274Dd522E35C354', '4540.69', '1.0875'],
  ['0xeb963cd99f451bB3573124b668FDE2D26076A137', '1494.19', '1.1123'],
  ['0xf94b8f9eedeEf1B1e4c120906eeEABc089F4DDBD', '4564.99', '1.1166'],
  ['0xb2aCB2f7ace4068CE7cb3B2F6dB08a8305D03705', '1902.90', '1.1212'],
  ['0xd987fb324dbAff0080844B771A0eB7AC40E7aA63', '48.52', '1.1234'],
  ['0xb2Cd76921325064FA42a457A691eb2dB1F56Edaa', '110.29', '1.1283'],
  ['0xc4B2bC56a375BD39D6E0F8FA3aC6aA06abb6a9B8', '3760.94', '1.1398'],
  ['0x95c5ba5eEC55259d59D06886609B280B9086291D', '2729.25', '1.1398'],
  ['0x51bbfc1864A2C97D22A3c6A038aED5E90613188f', '20438.05', '1.1505'],
  ['0x9f8aA6cCAa5E978f52B44928D0196079ef83DB97', '2018.47', '1.1588'],
  ['0x74d09665900A5f29BaC25BEfd30C73a5962d44e7', '48252.52', '1.1676'],
  ['0xa278D0d1B444d67246674B9EEDD66e731F327078', '1464.96', '1.1710'],
  ['0xbAa1A10744773c83c04DB52a8Cc4443e8a68c6d2', '972.97', '1.1816'],
  ['0xE234fC2b831e40d06c2B78d2F9924250829B08bE', '4338.78', '1.1896'],
  ['0x8ddB67c83b0213A7015B09c177626A96D93E7F34', '2680.57', '1.1917'],
  ['0xeBB66a61DD35fac2B46DdE44Be266dFF7853F832', '38.03', '1.1940'],
  ['0x617cC76686F17E545Aff640D9927965cf8A60a06', '10709.67', '1.1957'],
]

export function dec(value: string, decimals: number): bigint {
  const negative = value.startsWith('-')
  const body = negative ? value.slice(1) : value
  const [whole, frac = ''] = body.split('.')
  if (!/^\d+$/.test(whole) || (frac !== '' && !/^\d+$/.test(frac))) {
    throw new Error(`Not a decimal: ${value}`)
  }
  const digits = (frac + '0'.repeat(decimals)).slice(0, decimals)
  const raw = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(digits || '0')
  return negative ? -raw : raw
}

/**
 * First-paint book from the 18:02 Europe/Warsaw stress read.
 * Live `loadDesk` replaces it. Router quotes are not baked in.
 */
export function stressDesk(): Desk {
  const twapWad = dec('349.9893', 18)
  const navWad = dec('174.745005', 18)
  const index = dec('3.783476884', 9)
  const { clampedWad, regime } = clampCredit(twapWad, navWad)
  const creditedWad = creditedPerWsNetWad(clampedWad, index)
  const morphoPrice = morphoPriceFromCredited(creditedWad)
  const reserveUsdg = dec('236145.48', 6)
  const reserveNet = dec('702.294883', 9)
  const spotWad = spotWadFromReserves(reserveUsdg, reserveNet)
  const positions = WEAKEST_30.map(([address, debt, hf]) => position(address, debt, hf, morphoPrice))

  return {
    mode: 'seed',
    fetchedAt: STRESS_SNAPSHOT_AT,
    blockNumber: STRESS_SNAPSHOT_BLOCK,
    blockTimestamp: Math.floor(STRESS_SNAPSHOT_AT / 1000),
    warnings: [
      'Snapshot 2026-09-28 18:02 Europe/Warsaw, block 74,925,656. Supply, borrow, oracle, and the canonical pool are that read. The ladder is the 30 weakest borrowers (health under 1.20), not all 192. Top 10 debt is the largest of those 30.',
      'A live poll replaces this book. Router quotes, when they arrive, are the current aggregator book, not a frozen impact table.',
    ],
    supplyRaw: dec('700552.62', 6),
    borrowRaw: dec('699308.25', 6),
    collateralRaw: dec('2037.734734', 18),
    utilization: null,
    supplyApy: 1.5687378897988578,
    borrowApy: 1.5730537832279599,
    chainLastUpdate: Math.floor(STRESS_SNAPSHOT_AT / 1000),
    spotWad,
    twapWad,
    navWad,
    index,
    creditedWad,
    morphoPrice,
    regime,
    liquidationsEnabled: true,
    pauseReason: 'none',
    pauseSpotWad: pauseSpotWad(twapWad),
    checkpointAt: null,
    twapMinSec: 1800,
    twapMaxSec: 14400,
    reserveUsdg,
    reserveNet,
    positions,
    borrowerCount: 192,
    footnote: {
      borrowRaw: dec('171.11', 6),
      supplyRaw: dec('1602.11', 6),
      utilization: null,
    },
  }
}

function position(address: string, debt: string, hf: string, morphoPrice: bigint): RawPosition {
  const borrowRaw = dec(debt, 6)
  const health = dec(hf, 18)
  const value = (borrowRaw * health) / LLTV
  let collateralRaw = (value * ORACLE_PRICE_SCALE) / morphoPrice
  let guard = 0
  while (guard < 8) {
    const got = healthWad(collateralRaw, borrowRaw, morphoPrice)
    if (got !== null && got >= health) break
    collateralRaw += 1n
    guard += 1
  }
  return { address, collateralRaw, borrowRaw, indexedHealth: null }
}
