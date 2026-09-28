# Loopback buy zones

A single-page desk for deciding **where to bid NET** when Morpho Loopback liquidations force wsNET collateral into the canonical NET/USDG pool.

It is a decision tool. It does not connect a wallet and it does not send transactions.

Chain: Robinhood Chain, id **4663**. Market: Morpho Blue wsNET/USDG at 62.5% LLTV.

`0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589`

## Run

```bash
npm install
npm run dev
```

Dev server: [http://127.0.0.1:4317](http://127.0.0.1:4317)

```bash
npm test
npm run build
npm run preview
```

Copy `.env.example` to `.env` if you want a different RPC or poll interval. Defaults work without a key.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | Oracle, treasury NAV, sNET index, Uniswap reserves, Morpho `market()` |
| `VITE_MORPHO_GRAPHQL` | `https://api.morpho.org/graphql` | Borrower list, collateral outstanding, borrow/supply APY |
| `VITE_POLL_SECONDS` | `45` | Refresh interval (15–300) |

The public Robinhood RPC is rate-limited. If the first paint cannot reach both the RPC and Morpho, the page shows a **SAMPLE** banner and a frozen illustration. It does not silently mix sample rows into a live book. A later failed refresh keeps the last live book and says so.

## How to read it

1. **Liquidations enabled?** The oracle strip is the gate. If spot is under TWAP × 0.85, or `price()` reverts, Morpho will not liquidate. The ladder is a forecast until the pool reconverges. The TWAP window is 30 minutes to 4 hours.
2. **Which regime?** Credited value is `clamp(TWAP × 0.90, NAV, 5 × NAV) × dividend index`, not the spot price.
   - **Haircut band** — credit tracks 90% of TWAP. A grind lower in spot can liquidate, as long as spot stays within 15% of TWAP.
   - **NAV floor** — the haircut is below NAV, so further spot weakness does not mark collateral down.
   - **5× NAV cap** — speculative premium is not lent against. A pure spot crash does not liquidate anyone. Health moves with NAV, the dividend index, and borrow interest.
3. **Ladder** — open borrows, weakest health first. Health and LTV are recomputed from `oracle.price()` and the 62.5% LLTV. “Price to liq” is the **TWAP in USDG per NET** that pulls credited value onto that line, or **NAV** when the position is spot-immune. Distance is how far credited value sits above that line.
4. **Cascade** — pick a bucket (already liquidatable, health &lt; 1.05 / 1.10 / 1.20, top 10 debts, or a custom USDG notional). The desk estimates seized wsNET, converts it to NET with `sNET.index()`, and runs a constant-product sale into the canonical pair.
5. **Buy spot** — plain-language band. For names that are not liquidatable yet, the band assumes the pool has **reconverged to the first trigger TWAP** before the sale, because the divergence guard blocks a crash-dump. The blue chart is the sale into **today’s** reserves. Those are different questions; both are labeled.

Facility size is compared with the [NetNet lending guidance](https://docs.netnet.capital/lending): total borrows at or below about **10% of pool USDG depth**. Above that, expect smaller tranches, not one print of the whole bucket.

The 38.5% LLTV twin market is a footnote only. It is not in the ladder.

## Assumptions that move the print

- At the health = 1 boundary, seized collateral is about **70.4%** of the position: LLTV 62.5% times Morpho’s incentive of about **12.7%** (`1 / (1 - 0.3 × (1 - LLTV))`, capped at 15%). Names already underwater can lose up to 100% of collateral, and may leave bad debt.
- **1 wsNET = index / 1e9 NET.** That is the multiplier `LoopbackOracle` applies on top of the clamped TWAP/NAV. It matches `sNET.index()` (9 decimals). If a liquidator does not unwrap, or sells in clips, the print is smaller.
- The pair fee in the curve is **0.30%** (the canonical pair’s `×1000 − 3` constant). Docs also describe a **5% Treasury fee** on official margin-call sales. That fee is **not** applied here. If the seller must pay it, they receive less USDG than the curve shows.
- “Top 10 debt” is a hypothetical simultaneous close-out, not a claim those names margin-call together.
- Flat-credit “interest runway” assumes credited value does not move and the displayed borrow APY keeps compounding. It is a clock, not a price target.
- Position sizes come from the Morpho API and can lag the chain by a few minutes. Supply, borrow, spot, TWAP, NAV, index, and `price()` are read from RPC on each refresh. Missing fields stay **unavailable**. Nothing here is a live P&L.

## Links

- [Morpho market](https://app.morpho.org/robinhood-chain/variable/0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589/usdg-wsnet)
- [NetNet app](https://app.netnet.capital/)
- [Lombard Credit Facility](https://docs.netnet.capital/lending)
- [Curated Credit Vault](https://docs.netnet.capital/credit)

## Layout

| Path | Role |
| --- | --- |
| `src/adapters/rpc.ts` | Robinhood Chain reads. Swap the URL via env. |
| `src/adapters/morpho.ts` | Morpho GraphQL. Swap the endpoint via env. |
| `src/adapters/loadDesk.ts` | Joins the two and refuses to invent holes. |
| `src/lib/oracleMath.ts` | Clamp, divergence, index, spot scale. |
| `src/lib/liquidation.ts` | Health, trigger price, seizure. |
| `src/lib/uniswap.ts` | Constant-product impact. |
| `src/lib/model.ts` | Ladder rows and scenario buckets. |
| `src/mock/sampleDesk.ts` | Frozen illustration if live fetch fails. |
