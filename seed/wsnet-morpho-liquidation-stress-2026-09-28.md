# wsNET / USDG Morpho Loopback — Liquidation Stress

**Report time (Europe/Warsaw):** 2026-09-28 18:02:43 CEST (UTC+2)  
**On-chain snapshot:** block `74925656` @ 2026-09-28 18:02:43 CEST  
**Market (62.5% LLTV):** `0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589`  
**Chain:** Robinhood Chain `4663`  
**Morpho Blue:** `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`  

## Sources

- Morpho GraphQL `https://blue-api.morpho.org/graphql` (market state + all borrow positions, paginated)
- Robinhood RPC `https://robinhood-rpc.publicnode.com` (User-Agent `NetNetBondWatch/1.0`): LoopbackOracle `price()`, Morpho `market()` / share math, pair `getReserves()`, Treasury `backingPerToken()`, sNET `index()`, token balances
- Docs: [Lombard Credit Facility](https://docs.netnet.capital/lending), [Treasury & NAV](https://docs.netnet.capital/treasury), [Mechanism](https://docs.netnet.capital/mechanism), [Official Channels](https://docs.netnet.capital/official-channels)
- Morpho app: https://app.morpho.org/robinhood-chain/variable/0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589/usdg-wsnet

## 1. Book snapshot (62.5% LLTV)

| Metric | Value |
| --- | ---: |
| Total supply (USDG) | 700,552.62 |
| Total borrow (USDG) | 699,308.25 |
| Utilization | 99.82% |
| Cash liquidity (supply−borrow) | 1,244.38 |
| Collateral outstanding (wsNET) | 2,037.7347 |
| Collateral @ oracle credit | $2,428,488 |
| Collateral @ spot (unwrap→NET) | $2,592,381 |
| Borrow APY (Morpho API) | 157.3% |
| Supply APY (Morpho API) | 156.9% |
| Active borrowers (borrowShares≥1) | 192 |

## 2. Oracle vs market price

Credited value formula (docs):

```
credited = clamp(TWAP × 0.90, NAV, 5 × NAV) × dividend_index
```

| Component | Value |
| --- | ---: |
| Oracle credited (USDG / wsNET) | 1,191.7588 |
| NAV `backingPerToken` (USDG / NET) | 174.7450 |
| Dividend index (sNET) | 3.783477 |
| NET per 1 wsNET (sNET held / wsNET supply) | 3.783477 |
| Floor credit = NAV × index | 661.1437 |
| Cap credit = 5×NAV × index | 3,305.7184 |
| Base before index (= credited/index) | 314.9904 |
| Band | mid (NAV < TWAP×0.90 < 5×NAV) |
| Implied TWAP (= credited / (0.90×index)) | 349.9893 |
| Spot NET/USDG (pair) | 336.2483 |
| Spot / implied TWAP | 0.9607 |
| Divergence pause line (TWAP×0.85) | 297.4909 USDG/NET |
| Pool USDG depth | 236,145.48 |
| Pool NET depth | 702.2949 |

**Implication:** Credit is **not** pinned at the 5×NAV cap. Market/TWAP declines **do** reduce credited value (≈1:1 in % while mid-band holds), until the NAV×index floor (~$661/wsNET). A crash that drives spot below ~$297 (TWAP×0.85) **pauses** new borrows **and liquidations** until reconvergence.

## 3. Position ladder (health ascending)

Health = `(collateral_ws × credited × LLTV) / debt` with live oracle `1191.7588` and LLTV 62.5%.

| Bucket | # | Debt (USDG) | Collateral (wsNET) | ≈ NET if unwrapped |
| --- | ---: | ---: | ---: | ---: |
| Liquidatable now (HF<1.0) | 0 | 0.00 | 0.0000 | 0.00 |
| Near-liq HF<1.05 | 5 | 5,571.90 | 7.7289 | 29.24 |
| Near-liq HF<1.10 | 14 | 23,639.03 | 33.7694 | 127.77 |
| Near-liq HF<1.20 | 30 | 129,164.13 | 198.5463 | 751.20 |
| All borrowers | 192 | 699,308.25 | 1,605.0647 | 6,072.73 |

### Top 30 by health (lowest first)

| # | Borrower | HF | Debt $ | wsNET | LTV | Credited drop to liq | Implied TWAP liq | Days to HF=1 @ APY |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `0x505BD4496939C8763Ad84717305E71EB1fF9D472` | 1.0063 | 0.30 | 0.0004 | 62.11% | 0.62% | 347.8 | 1.5 |
| 2 | `0xffF15DB33ca3187dFEE2C9bDb7BCDAC89172Dae9` | 1.0068 | 1,051.08 | 1.4207 | 62.08% | 0.67% | 347.6 | 1.6 |
| 3 | `0x47852Fdb50952ea95E845b02366c2f7E728e4b4F` | 1.0341 | 2,363.66 | 3.2817 | 60.44% | 3.30% | 338.4 | 7.8 |
| 4 | `0x8cE1dE121ee39E6539B0e8F52373Fec4eBB1eCB9` | 1.0434 | 25.88 | 0.0363 | 59.90% | 4.16% | 335.4 | 9.8 |
| 5 | `0x3Fb50b14058BB5bffbf871eE973f7ccdDE7ff426` | 1.0451 | 2,130.98 | 2.9898 | 59.81% | 4.31% | 334.9 | 10.2 |
| 6 | `0x42b0A676617490466877B9F9239d8FF35bfaa9d1` | 1.0504 | 8.01 | 0.0113 | 59.50% | 4.80% | 333.2 | 11.4 |
| 7 | `0xCD2adEe11bF6b79a4a197D8f80e2b575d2412781` | 1.0618 | 8,263.08 | 11.7791 | 58.86% | 5.82% | 329.6 | 13.9 |
| 8 | `0xDd583ca50e583380E4746e5E740ed0E02fb25559` | 1.0662 | 170.86 | 0.2446 | 58.62% | 6.21% | 328.3 | 14.9 |
| 9 | `0xef14EBD0f14f1fECFBe3b1016718BF913A16a291` | 1.0674 | 1,347.59 | 1.9312 | 58.55% | 6.32% | 327.9 | 15.1 |
| 10 | `0x1A513863f9235b0D6ad7fAbbdd0f1062E9C0491c` | 1.0740 | 22.94 | 0.0331 | 58.19% | 6.89% | 325.9 | 16.6 |
| 11 | `0x31a16c9d3A30334CA002dA04F38ee9688EcFA40a` | 1.0850 | 210.32 | 0.3064 | 57.61% | 7.83% | 322.6 | 18.9 |
| 12 | `0xE690341E50dce63c764Ce7E0A6e923349d77ae2F` | 1.0853 | 3,028.63 | 4.4130 | 57.59% | 7.86% | 322.5 | 19.0 |
| 13 | `0x7F67C0bd79A988879Bd6cF9e02800741A657db3C` | 1.0860 | 475.01 | 0.6926 | 57.55% | 7.92% | 322.3 | 19.2 |
| 14 | `0x46d9F5add63A0603065Bd1284274Dd522E35C354` | 1.0875 | 4,540.69 | 6.6293 | 57.47% | 8.04% | 321.8 | 19.5 |
| 15 | `0xeb963cd99f451bB3573124b668FDE2D26076A137` | 1.1123 | 1,494.19 | 2.2313 | 56.19% | 10.10% | 314.7 | 24.7 |
| 16 | `0xf94b8f9eedeEf1B1e4c120906eeEABc089F4DDBD` | 1.1166 | 4,564.99 | 6.8433 | 55.97% | 10.44% | 313.4 | 25.6 |
| 17 | `0xb2aCB2f7ace4068CE7cb3B2F6dB08a8305D03705` | 1.1212 | 1,902.90 | 2.8643 | 55.74% | 10.81% | 312.2 | 26.5 |
| 18 | `0xd987fb324dbAff0080844B771A0eB7AC40E7aA63` | 1.1234 | 48.52 | 0.0732 | 55.63% | 10.99% | 311.5 | 27.0 |
| 19 | `0xb2Cd76921325064FA42a457A691eb2dB1F56Edaa` | 1.1283 | 110.29 | 0.1671 | 55.39% | 11.37% | 310.2 | 28.0 |
| 20 | `0xc4B2bC56a375BD39D6E0F8FA3aC6aA06abb6a9B8` | 1.1398 | 3,760.94 | 5.7550 | 54.84% | 12.26% | 307.1 | 30.4 |
| 21 | `0x95c5ba5eEC55259d59D06886609B280B9086291D` | 1.1398 | 2,729.25 | 4.1765 | 54.83% | 12.27% | 307.1 | 30.4 |
| 22 | `0x51bbfc1864A2C97D22A3c6A038aED5E90613188f` | 1.1505 | 20,438.05 | 31.5693 | 54.32% | 13.08% | 304.2 | 32.5 |
| 23 | `0x9f8aA6cCAa5E978f52B44928D0196079ef83DB97` | 1.1588 | 2,018.47 | 3.1403 | 53.93% | 13.70% | 302.0 | 34.2 |
| 24 | `0x74d09665900A5f29BaC25BEfd30C73a5962d44e7` | 1.1676 | 48,252.52 | 75.6390 | 53.53% | 14.35% | 299.8 | 36.0 |
| 25 | `0xa278D0d1B444d67246674B9EEDD66e731F327078` | 1.1710 | 1,464.96 | 2.3031 | 53.37% | 14.60% | 298.9 | 36.6 |
| 26 | `0xbAa1A10744773c83c04DB52a8Cc4443e8a68c6d2` | 1.1816 | 972.97 | 1.5435 | 52.89% | 15.37% | 296.2 | 38.7 |
| 27 | `0xE234fC2b831e40d06c2B78d2F9924250829B08bE` | 1.1896 | 4,338.78 | 6.9294 | 52.54% | 15.94% | 294.2 | 40.3 |
| 28 | `0x8ddB67c83b0213A7015B09c177626A96D93E7F34` | 1.1917 | 2,680.57 | 4.2887 | 52.45% | 16.09% | 293.7 | 40.7 |
| 29 | `0xeBB66a61DD35fac2B46DdE44Be266dFF7853F832` | 1.1940 | 38.03 | 0.0610 | 52.35% | 16.25% | 293.1 | 41.1 |
| 30 | `0x617cC76686F17E545Aff640D9927965cf8A60a06` | 1.1957 | 10,709.67 | 17.1923 | 52.27% | 16.37% | 292.7 | 41.5 |

## 4. Price-to-liquidation (oracle rules)

- While in the **mid-band**, a −X% move in TWAP ≈ −X% move in credited value (haircut and index fixed).
- Tightest open position needs only **~0.62%** credited decline (implied TWAP ≈ **347.8** vs ~350.0 now).
- NAV floor credit ≈ **$661.14/wsNET** (−44.5% from current). Positions with current LTV above `62.5% × floor/current` (= 34.7% LTV) would still be liquidatable even at the floor; others become safe from further *price* declines until NAV falls or interest accrues.
- Interest path: borrow APY ≈ **157%**. At current rates, HF≈1.05 → ~11 days to margin call if credit flat; HF≈1.20 → ~42 days.
- **Not** a pure spot-crash story: liquidations reference oracle credit, not pool spot. Spot can gap down while TWAP lags; the 15% divergence guard may pause liquidations during the gap.

## 5. Cascade / exit impact vs pool

Assumes liquidators seize **full** collateral of the tranche and sell unwrapped NET into the canonical NET/USDG pool. Fee scenarios: **5%** (docs: margin-call / Turbo fee to Treasury) and **0.3%** (vanilla Uni v2-style). Constant-product estimate; real path may be chunked or paused by the divergence guard.

| Tranche | Debt $ | NET sold | Impact @5% fee | USDG out @5% | Recovery vs debt | Shortfall @5% | Impact @0.3% |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Liquidatable now (HF<1.0) | 0 | 0.0 | 0.0% | 0 | 0.0% | 0 | 0.0% |
| Near-liq HF<1.05 | 5,572 | 29.2 | 7.7% | 8,986 | 161.3% | 0 | 7.8% |
| Near-liq HF<1.10 | 23,639 | 127.8 | 27.9% | 34,799 | 147.2% | 0 | 28.4% |
| Near-liq HF<1.20 | 129,164 | 751.2 | 76.0% | 119,018 | 92.1% | 10,146 | 76.6% |
| All borrowers | 699,308 | 6,072.7 | 98.9% | 210,518 | 30.1% | 488,790 | 98.9% |

Pool depth now: **236,145 USDG / 702.3 NET**. The HF<1.20 tranche alone (~751 NET) is on the order of the **entire** NET reserve — estimated **~76%** spot drawdown if dumped in one shot, with oracle marks still **above** achievable exit (illustrative shortfall ~**$10,146** under the 5% fee path for that tranche).

Oracle marks ≫ instantaneous exit for large tranches is the core facility risk in the docs (recovery bounded toward NAV floor in a collapse; buyback is rate-limited at 1% of liquid reserves / 8h epoch).

## 6. Facility guidance check

Docs: total borrows at or below **10% of exchange pool USDG depth** so a margin-call tranche can clear without loss — guidance, not a hard cap.

| | USDG |
| --- | ---: |
| Pool USDG depth | 236,145.48 |
| 10% guidance cap | 23,614.55 |
| Live total borrows | 699,308.25 |
| Borrows / pool depth | 296.1% |
| Borrows / guidance | **29.6×** |

**Live facility is ~30× the published guidance.** Expect slower, chunked liquidations and material price impact if the near-liq book is forced out.

## 7. Footnote — 38.5% LLTV twin

| Market | `0xf47c7a7a1ff6c7444e6fcfa20a71f439e4525f4f9640fe6ba5c080f6f2a9d33f` |
| --- | --- |
| Supply USDG | 1,602.11 |
| Borrow USDG | 171.11 |

Negligible vs the 62.5% book (~$0.17k borrow); not stress-tested further.

## Caveats

- Positions from Morpho API; debt recomputed on-chain via `borrowShares × totalBorrowAssets / totalBorrowShares` at snapshot block. Dust rounding possible.
- TWAP is **implied** from oracle credit and index (LoopbackOracle `price()` works; no public TWAP getter found in probed selectors); spot≠TWAP.
- Cascade math is a single-pool CPMM sketch; ignores buyback desk, multi-block pacing, divergence pause, and liquidator behavior.
- No trades were submitted; read-only analysis.
- Book can move quickly (near-100% utilization; APY ≫100% amplifies HF decay via interest).

---
*Generated 2026-09-28T18:02:43.748711+02:00*