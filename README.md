# NET Desk

A one-page NetNet desk from [Iroh's Tea Shop](https://iroh-tea-shop.up.railway.app). It reads NET on Robinhood Chain and answers six questions: can forced selling happen now, where does forced NET print, who goes first, who buys NetNet bonds, who trades NET on the DEX, and is the wsNET → USDG loop under stress.

The buy zone shows **where to bid NET** when Morpho Loopback liquidations force wsNET collateral into NET/USDG liquidity. Router quotes are the impact curve. The canonical Uniswap v2 pair is the floor, not the whole book.

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
npm start
```

`npm start` serves `dist/` on `PORT` (default `8080`), including `/health`. Build first.

Copy `.env.example` to `.env` if you want a different RPC or poll interval. Defaults work without a key.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | Oracle, treasury NAV, sNET index, Uniswap reserves, Morpho `market()` |
| `VITE_MORPHO_GRAPHQL` | `https://api.morpho.org/graphql` | Borrower list, collateral outstanding, borrow/supply APY |
| `VITE_POLL_SECONDS` | `45` | Refresh interval (15–300) |
| `ZEROX_API_KEY` | unset | Optional 0x / Matcha key. Inlined into the bundle. See below. |
| `NANSEN_API_KEY` | unset | Server-only. Feeds the holder and flow panel through `/api/nansen`. Never inlined. |
| `NANSEN_TTL_MINUTES` | `60` | How long the server keeps one Nansen read (10–720). Bond buyer labels use the same interval. |
| `BONDS_TTL_SECONDS` | `60` | Server-only. Minimum seconds between bond chain reads for `/api/bonds` (30–600). |
| `BONDS_CACHE_FILE` | `.cache/bonds.json` | Server-only. Where the bond index is saved. Without a saved index, the first read takes about 20 minutes. |

The first paint is the **18:02 Europe/Warsaw stress snapshot** in `seed/` (block 74,925,656): the 62.5% book, the mid-band oracle, the canonical pool, and the 30 weakest borrowers. The badge says **Snapshot** until a live poll replaces the whole book. Router quotes still load against the current aggregator while that snapshot is up. If the first poll fails, the snapshot stays and the banner says so. A later failed refresh keeps the last live book.

The snapshot ladder is those 30 names, not all 192. “Top 10 debt” on that paint is the largest of the 30. The attached note’s cascade assumed 100% collateral seizure and a 5% treasury fee into one pool. This desk still seizes about 70.4% at the health = 1 line, draws the canonical pair at 0.30%, and prefers a live router quote for the buy zone.

## How to read it

1. **Liquidations enabled?** The oracle strip is the gate. If spot is under TWAP × 0.85, or `price()` reverts, Morpho will not liquidate. The ladder is a forecast until the pool reconverges. The TWAP window is 30 minutes to 4 hours.
2. **Which regime?** Credited value is `clamp(TWAP × 0.90, NAV, 5 × NAV) × dividend index`, not the spot price.
   - **Haircut band** — credit tracks 90% of TWAP. A grind lower in spot can liquidate, as long as spot stays within 15% of TWAP.
   - **NAV floor** — the haircut is below NAV, so further spot weakness does not mark collateral down.
   - **5× NAV cap** — speculative premium is not lent against. A pure spot crash does not liquidate anyone. Health moves with NAV, the dividend index, and borrow interest.
3. **Ladder** — open borrows, weakest health first. Health and LTV are recomputed from `oracle.price()` and the 62.5% LLTV. “Price to liq” is the **TWAP in USDG per NET** that pulls credited value onto that line, or **NAV** when the position is spot-immune. Distance is how far credited value sits above that line.
4. **Cascade** — pick a bucket (already liquidatable, health &lt; 1.05 / 1.10 / 1.20, top 10 debts, or a custom USDG notional). The desk estimates seized wsNET and converts it to NET with `sNET.index()`. **Impact via router/aggregator (Matcha-style)** quotes that NET into USDG at several sizes. **Canonical Uniswap v2 only** is the dashed constant-product curve on pair `0x59F9…5B54`. The panel shows both USDG-out numbers.
5. **Buy spot** — plain-language band from the **router curve** when quotes loaded: small-clip price down to the tail of this size. If quotes fail, the band falls back to the canonical pool and a red banner says the dump is overstated. Quotes are today’s book. The trigger TWAP is when the sale becomes allowed; the curve moves if TWAP grinds there first.

Facility size is compared with the [NetNet lending guidance](https://docs.netnet.capital/lending): total borrows at or below about **10% of pool USDG depth**. Above that, expect smaller tranches, not one print of the whole bucket.

The 38.5% LLTV twin market is a footnote only. It is not in the ladder.

6. **Credit** — who funds the book. NetNet Credit (nnUSDG, Morpho Vault V2 `0x9934…3B57`) lends USDG into Loopback and six stock markets. The panel shows vault assets, what can leave now, depositor APY, the two largest depositors, and the largest borrower weighted by vault money. The table lists each market’s allocation, cap, free USDG, utilization, borrow APY, and the borrow APY in 7 days if utilization holds. Charts show 14 days of Loopback borrow APY, utilization, and supplied USDG. Risks are computed each refresh.
7. **Pendle** — the sNET index priced forward. Every wsNET’s credited value is multiplied by `sNET.index()`, so index growth is the looper’s income and the borrow rate is the cost. The panel converts Pendle’s implied and trailing APY to a daily rate, measures on-chain index drift from the seed snapshot, and projects when the adaptive curve pushes the Loopback borrow rate past the implied index growth. Past that point the loop has negative carry.
8. **Holders and flows** — Nansen on NET: holder count, 7-day DEX buy and sell volume, smart-money and public-figure net flow, the staking pool’s share, net buyers and sellers by label, and the smart-money tape. Loopback borrowers and large credit-vault borrowers are tagged. Nansen labels also show under ladder addresses.

9. **Bond buyers** — who buys NetNet bonds, epoch by epoch (8 hours each). The server reads every `BondCreated` log from the BondDepository and labels each buyer with Nansen. Pick 7d, 30d, or all time. The chart shows the sales of each epoch as a share of its cap (0.25% of NET supply), split by buyer group: smart money, public figures, Hyperliquid traders, other labelled, unlabelled, and not read yet. The tables show the share and average price of each group, and the top buyers with Loopback-borrower and DEX-seller tags. “Still holds” compares the NET, sNET, wsNET, and unvested bonds a wallet holds now with what its bonds would be worth if staked. A label does not prove who owns a wallet.

The Morpho vault and Pendle reads refresh every 5 minutes in the browser. Nansen runs on the server, one read per `NANSEN_TTL_MINUTES`, and only when someone opens the page.

## Assumptions that move the print

- At the health = 1 boundary, seized collateral is about **70.4%** of the position: LLTV 62.5% times Morpho’s incentive of about **12.7%** (`1 / (1 - 0.3 × (1 - LLTV))`, capped at 15%). Names already underwater can lose up to 100% of collateral, and may leave bad debt.
- **1 wsNET = index / 1e9 NET.** That is the multiplier `LoopbackOracle` applies on top of the clamped TWAP/NAV. It matches `sNET.index()` (9 decimals). If a liquidator does not unwrap, or sells in clips, the print is smaller.
- The canonical pair fee in the dashed curve is **0.30%**. Router quotes already include the fees on the route they chose. Docs also describe a **5% Treasury fee** on official margin-call sales. That fee is **not** applied on either number.
- Router quotes are indicative. A liquidator can split worse, wait, or not dump 100% at once.
- “Top 10 debt” is a hypothetical simultaneous close-out, not a claim those names margin-call together.
- Flat-credit “interest runway” assumes credited value does not move and the displayed borrow APY keeps compounding. It is a clock, not a price target.
- The adaptive-curve projection holds utilization constant and uses Morpho’s constants: 90% target, steepness 4, speed 50 a year, rate at target 0.1%–200%. Real rates move as soon as someone repays or supplies.
- Pendle yields are in NET per wsNET, not USD. New NET dilutes NAV per NET. Pendle only prices to the listed maturity; the desk uses that implied rate as the best read beyond it.
- Nansen “smart money” means labels with 🤓. Top-100 buyer and seller lists are Nansen’s ranking, not the full tape. The staking pool trades on the DEX, so treat its flow as protocol flow.
- Position sizes come from the Morpho API and can lag the chain by a few minutes. Supply, borrow, spot, TWAP, NAV, index, and `price()` are read from RPC on each refresh. Missing fields stay **unavailable**. Nothing here is a live P&L.

## Links

- [Morpho market](https://app.morpho.org/robinhood-chain/variable/0xaa586d26a6fe62d9c0f0948fede6e2130500ac7a655587447e2d4a37e6330589/usdg-wsnet)
- [NetNet app](https://app.netnet.capital/)
- [Lombard Credit Facility](https://docs.netnet.capital/lending)
- [Curated Credit Vault](https://docs.netnet.capital/credit)

## Where the quotes come from

Robinhood Chain (4663) does have aggregator coverage. What this desk actually calls:

| Source | Chain 4663 | Used for the curve |
| --- | --- | --- |
| [KyberSwap Aggregator](https://aggregator-api.kyberswap.com/robinhood/api/v1/routes) | Public `GET`, no key, browser CORS allows the dev origin | **Primary.** Live NET → USDG routes. A probe split size across Uniswap v4, Uniswap v3 (Up), Algebra (Alandale), and the canonical Uniswap v2 pair. |
| [0x Swap API](https://api.0x.org/swap/allowance-holder/price) / Matcha | Supported, **401 without `0x-api-key`** | Optional. Set `ZEROX_API_KEY` or `VITE_ZEROX_API_KEY`. Each size is quoted on both KyberSwap and 0x; the higher USDG out wins, and the route chips are from that winner. The key is compiled into the static JS. Use a referrer-restricted key and do not commit it. |
| [Rialto](https://rialto-trade-api.rialto.xyz/quote) | Quote API exists and needs a bearer key. The public token list’s `NET` is a stock token, not NetNet `0xCA9c…eDf` | Not used. NetNet NET is not in that token list. |
| 1inch | 401 without a key | Not used. |
| [LI.FI](https://li.quest/v1/quote) | Public quote (Nordstern on a probe) | Fallback only when KyberSwap and 0x both return nothing. One source chip, no pool split. |

Sizes quoted each refresh: 1, 5, 15, 40, 80, 150, 300, and 600 NET, plus the scenario size when it is not already on a rung. The mint line is **average fill** (USDG received / NET sold) for a sale of that size into the current book. The dashed line is the canonical pair’s **price after** the same sale. Those are different measures; both are labeled. Missing quotes stay missing. The desk does not invent depth.

## Layout

| Path | Role |
| --- | --- |
| `src/adapters/rpc.ts` | Robinhood Chain reads. Swap the URL via env. |
| `src/adapters/morpho.ts` | Morpho GraphQL. Swap the endpoint via env. |
| `src/adapters/loadDesk.ts` | Joins the two and refuses to invent holes. |
| `src/lib/oracleMath.ts` | Clamp, divergence, index, spot scale. |
| `src/lib/liquidation.ts` | Health, trigger price, seizure. |
| `src/lib/uniswap.ts` | Canonical-pair constant-product impact. |
| `src/lib/quoteBook.ts` | Router curve math and the aggregator-vs-pair comparison. |
| `src/adapters/quotes.ts` | KyberSwap, optional 0x, LI.FI fallback. |
| `src/adapters/credit.ts` | NetNet Credit vault, its markets, top borrowers, Loopback rate history (Morpho GraphQL). |
| `src/adapters/pendle.ts` | Pendle sNET maturities and daily implied/underlying history. |
| `src/lib/rates.ts` | Adaptive-curve projection and daily-rate conversions. |
| `src/lib/flows.ts` | Nansen label classes, net movers, smart-money tape, holder split. |
| `nansen.mjs` | Server-side Nansen reads with a TTL cache. Used by `server.mjs` and the Vite dev server. |
| `bonds.mjs` | Server-side bond index behind `/api/bonds`: BondDepository logs, NET supply, sNET index, holdings, Nansen labels. |
| `src/lib/bonds.ts` | Bond buyer groups, the per-epoch series, top buyers, the summary, and the plain-language lines. |
| `src/lib/model.ts` | Ladder rows and scenario buckets. |
| `src/seed/stressDesk.ts` | 18:02 Warsaw snapshot used for first paint. |
| `seed/` | The stress note and JSON that snapshot was taken from. |
| `src/mock/sampleDesk.ts` | Frozen illustration kept for tests. |
| `server.mjs` | Production server. Reads `PORT`, serves `dist/`, SPA fallback, `/health`, `/api/nansen`, `/api/bonds`. |
| `railway.toml` | Nixpacks build, start command, healthcheck. |
| `nixpacks.toml` | Installs devDependencies so `vite` and `tsc` exist when `NODE_ENV=production`. |

## Deploy on Railway

Service name: `netnet-liq-dashboard`.

The public defaults work with no secrets: Robinhood Chain RPC, Morpho GraphQL, and KyberSwap quotes. Optional variables are baked into the client at **build** time. Set them on the service before the deploy that should pick them up, then redeploy after any change. Railway’s runtime env does not rewrite the bundle.

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_RPC_URL` | no | Public Robinhood RPC if unset |
| `VITE_MORPHO_GRAPHQL` | no | `https://api.morpho.org/graphql` if unset |
| `VITE_POLL_SECONDS` | no | `45` if unset |
| `ZEROX_API_KEY` or `VITE_ZEROX_API_KEY` | no | Referrer-restricted 0x key. Inlined into the JS. Do not commit it. |
| `NANSEN_API_KEY` | no | Runtime only. Without it the flow panel says the key is missing and the rest works. |
| `NANSEN_TTL_MINUTES` | no | `60` if unset. Each read is 9 Nansen calls. |
| `BONDS_TTL_SECONDS` | no | `60` if unset. Bond chain reads use the public RPC. |
| `BONDS_CACHE_FILE` | no | Point it at a mounted volume. Without one, each deploy reads the bond history again (about 20 minutes). |
| `PORT` | set by Railway | `server.mjs` binds `0.0.0.0:$PORT`. Do not hardcode it. |

From the Railway dashboard, with this repo linked:

1. New project, empty service named `netnet-liq-dashboard`.
2. Connect the GitHub / Git remote and deploy `main`.
3. Builder is Nixpacks via `railway.toml`. Install uses `npm ci --include=dev`, then `npm run build`. Start command is `node server.mjs`.
4. Healthcheck path is `/health` (plain `ok`).
5. Generate a public domain on the service. Railway sends traffic to `PORT`.

CLI equivalent, from a machine that is already signed in (`railway login` or `RAILWAY_TOKEN`):

```bash
railway init --name netnet-liq-dashboard
railway up --service netnet-liq-dashboard --detach -m "Serve the Loopback buy-zone desk"
railway domain --service netnet-liq-dashboard
```

Local check of the same server:

```bash
npm run build
PORT=4391 node server.mjs
curl -fsS http://127.0.0.1:4391/health
```
