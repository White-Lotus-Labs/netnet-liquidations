/** Tooltip copy for the desk. Text describes the rule the code uses; `doc` points to the page that explains it. */
export type GlossaryEntry = { term: string; text: string; doc?: { href: string; label: string } }

// Every anchor below was checked against the page's heading ids.
const DOC = {
  oracle: { href: 'https://docs.netnet.capital/mechanism#the-price-oracle-fail-closed-by-design', label: 'Oracle docs ↗' },
  staking: { href: 'https://docs.netnet.capital/mechanism#1-the-shareholder-dividend-program-staking', label: 'Staking docs ↗' },
  bonds: { href: 'https://docs.netnet.capital/mechanism#5-primary-offerings-bond-sales-never-below-nav', label: 'Bond docs ↗' },
  wsNet: { href: 'https://docs.netnet.capital/mechanism#6-rebase-accounting', label: 'Docs: wsNET ↗' },
  nav: { href: 'https://docs.netnet.capital/treasury#3-rfv-and-nav', label: 'Treasury docs: NAV ↗' },
  credited: { href: 'https://docs.netnet.capital/lending#the-advance-rate-and-why-credit-shrinks-in-euphoria', label: 'Lending docs: credited value ↗' },
  marginCalls: { href: 'https://docs.netnet.capital/lending#margin-calls', label: 'Lending docs: margin calls ↗' },
  poolGuide: { href: 'https://docs.netnet.capital/lending#what-credit-participants-are-risking', label: 'Lending docs: pool guide ↗' },
  lendingTerms: { href: 'https://docs.netnet.capital/lending#terms', label: 'Lending docs: terms ↗' },
  lending: { href: 'https://docs.netnet.capital/lending', label: 'Lending docs ↗' },
  credit: { href: 'https://docs.netnet.capital/credit#what-it-is', label: 'Credit docs ↗' },
  creditHealth: { href: 'https://docs.netnet.capital/credit#how-to-borrow', label: 'Credit docs: health ↗' },
  creditSupply: { href: 'https://docs.netnet.capital/credit#how-to-supply', label: 'Credit docs: withdrawals ↗' },
  creditMarkets: { href: 'https://docs.netnet.capital/credit#the-markets', label: 'Credit docs: markets ↗' },
  deskInventory: { href: 'https://docs.netnet.capital/rwa-desk#inventory', label: 'Bond desk docs: inventory ↗' },
  fee: { href: 'https://docs.netnet.capital/FEES.HTM#1-where-the-fee-applies', label: 'Fee docs ↗' },
  canonicalPool: { href: 'https://docs.netnet.capital/FEES.HTM#3-why-the-canonical-pool-must-be-uniswap-v2', label: 'Fee docs: canonical pool ↗' },
  thinLiquidity: { href: 'https://docs.netnet.capital/risks#1-thin-liquidity-by-choice', label: 'Risk docs: thin liquidity ↗' },
  morphoIncentive: { href: 'https://docs.morpho.org/learn/concepts/liquidation/#liquidation-incentive-factor-lif', label: 'Morpho: liquidation incentive ↗' },
  morphoBadDebt: { href: 'https://docs.morpho.org/learn/concepts/liquidation/#bad-debt-consideration', label: 'Morpho: bad debt ↗' },
  morphoCurve: { href: 'https://docs.morpho.org/learn/concepts/irm/#the-adaptivecurveirm', label: 'Morpho: adaptive curve ↗' },
  nansenSmart: { href: 'https://docs.nansen.ai/api/smart-money#smart-money-labels', label: 'Nansen: smart money labels ↗' },
  nansenFlows: { href: 'https://docs.nansen.ai/api/token-god-mode/flow-intelligence', label: 'Nansen: flow intelligence ↗' },
  nansenTrades: { href: 'https://docs.nansen.ai/api/token-god-mode/who-bought-sold', label: 'Nansen: who bought/sold ↗' },
  pendleImplied: { href: 'https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Glossary#implied-apy', label: 'Pendle: implied APY ↗' },
  pendleUnderlying: { href: 'https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Glossary#underlying-apy', label: 'Pendle: underlying APY ↗' },
  pendleMaturity: { href: 'https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Glossary#maturity', label: 'Pendle: maturity ↗' },
} satisfies Record<string, NonNullable<GlossaryEntry['doc']>>

const ENTRIES = {
  // Header and status strip
  modeBadge: {
    term: 'Live / Snapshot / Sample',
    text: 'Live: read from the chain. If a later refresh fails, the desk keeps the last live read and shows a notice. Snapshot: the saved stress read from 28 Sep 2026, 18:02 Warsaw time, shown until the first live read lands. Sample: built-in test data.',
  },
  liquidationsOn: {
    term: 'Liquidations are on',
    text: 'The oracle prices wsNET now, so anyone can liquidate a borrower whose health falls under 1.',
    doc: DOC.marginCalls,
  },
  liquidationsPaused: {
    term: 'Liquidations are paused',
    text: 'The oracle refuses to price when spot falls more than 15% under TWAP or when the TWAP is stale. Then nobody can borrow or liquidate. Pricing comes back when spot returns to within 15% of TWAP, or 30 minutes after a new checkpoint.',
    doc: DOC.credited,
  },
  creditedValue: {
    term: 'Credited value',
    text: 'The value the Loopback oracle gives wsNET collateral: clamp(TWAP × 0.90, NAV, 5 × NAV) per NET, times the sNET index. Spot price is not in the formula.',
    doc: DOC.credited,
  },
  regimeHaircut: {
    term: 'Haircut band',
    text: 'TWAP × 0.90 sits between NAV and 5 × NAV, so credit follows TWAP. A TWAP fall lowers the health of every borrower, as long as spot stays within 15% of TWAP.',
    doc: DOC.credited,
  },
  regimeNavFloor: {
    term: 'NAV floor',
    text: 'TWAP × 0.90 is under NAV, so credit stays at NAV. A further price fall does not lower health. NAV, the sNET index and interest still move it.',
    doc: DOC.credited,
  },
  regimeCap: {
    term: '5× NAV cap',
    text: 'TWAP × 0.90 is at or above 5 × NAV, so credit stays at 5 × NAV. A spot crash liquidates nobody until TWAP × 0.90 falls under 5 × NAV.',
    doc: DOC.credited,
  },
  spot: {
    term: 'Spot',
    text: 'USDG per NET in the canonical pool right now, from its reserves. The oracle uses spot only for the 15% pause check.',
    doc: DOC.lendingTerms,
  },
  twap: {
    term: 'TWAP',
    text: 'Time-weighted average price of the canonical pool, from cumulative prices stored at checkpoints. A read is valid only over a window of 30 minutes to 4 hours. Credit and bond prices use TWAP, not spot.',
    doc: DOC.oracle,
  },
  checkpoint: {
    term: 'Checkpoint',
    text: 'Time since the last TWAP checkpoint. Anyone can call checkpoint(), with at least 30 minutes between calls. After 4 hours with no checkpoint, the TWAP is stale and the oracle stops pricing.',
    doc: DOC.oracle,
  },
  nav: {
    term: 'NAV',
    text: "Backing per NET: the Treasury's risk-free value divided by NET supply. Treasury-owned NET counts at 1 USDG, never at market price. Bonds never sell under NAV.",
    doc: DOC.nav,
  },
  pauseBelow: {
    term: 'Pause below',
    text: 'Spot price under which liquidations pause: TWAP × 0.85. Spot exactly on the line still prices.',
    doc: DOC.lendingTerms,
  },
  pauseCushion: {
    term: 'Spot above the pause',
    text: 'How far spot can fall before liquidations pause, as a share of spot: (spot − pause line) ÷ spot. The tile turns amber under 5%.',
    doc: DOC.lendingTerms,
  },

  // Buy zone
  buyZone: {
    term: 'Buy zone',
    text: "Price range where this bucket's forced NET would sell. With router quotes: from the price of the first NET down to the price of the last. Without quotes: the canonical pool, from the trigger TWAP down to the price after the full sale. For borrowers already under 1, it starts at spot.",
    doc: DOC.marginCalls,
  },
  forcedSelling: {
    term: 'Forced selling',
    text: 'NET that liquidators sell after they take wsNET collateral. The desk assumes they unwrap it all and sell it at once into NET/USDG. A liquidator who sells in smaller parts, or keeps the NET, moves the price less.',
    doc: DOC.marginCalls,
  },
  bucket: {
    term: 'Health bucket',
    text: 'A group of borrowers to model as one forced sale. Each button shows the bucket, its borrower count and its debt. The desk opens on the weakest bucket that has borrowers.',
  },
  bucketHealth: {
    term: 'Health < 1.05 / 1.10 / 1.20',
    text: 'Every borrower with health under that number, so each bucket includes the weaker ones. Health 1.10 means credited value can fall about 9% before liquidation.',
    doc: DOC.creditHealth,
  },
  bucketTop10: {
    term: 'Top 10 debt',
    text: 'The ten largest borrows, modeled as if all were liquidated at once. It is a stress case. Their trigger prices can differ.',
  },
  bucketCustom: {
    term: 'Custom notional',
    text: 'Enter a USDG amount. The desk fills it with the weakest borrowers first, until their debt reaches that amount.',
  },
  debtInBucket: {
    term: 'Debt in bucket',
    text: 'USDG the borrowers in this bucket owe. For a custom amount, it counts their debt only up to that amount.',
  },
  netSold: {
    term: 'NET sold',
    text: 'NET liquidators would sell for this bucket. At the health 1 line they take about 70.4% of the wsNET collateral (62.5% LLTV × 1.127 incentive) and unwrap it at the sNET index. Borrowers that only a NAV fall can reach are left out.',
    doc: DOC.marginCalls,
  },
  twapTrigger: {
    term: 'TWAP trigger',
    text: 'TWAP range at which the borrowers in this bucket reach health 1, first to last. Spot must also stay within 15% of TWAP, or the oracle pauses. "Already through" means they are under 1 now.',
    doc: DOC.credited,
  },
  navTrigger: {
    term: 'NAV trigger',
    text: 'The liquidation line of these borrowers is under NAV, and credit never goes under NAV. No price fall can reach them. A NAV fall to this level can, and so can interest as their debt grows.',
    doc: DOC.credited,
  },
  triggerSpan: {
    term: 'Triggers span',
    text: 'The first and last borrowers in this bucket reach health 1 at TWAPs more than 8% apart. As TWAP falls they liquidate one after another, in several sales.',
  },
  routerTouchAvg: {
    term: 'Router touch → avg',
    text: 'Touch: the router price for the smallest quoted sale (1 NET). Avg: USDG out ÷ NET in for the whole sale of this bucket. "Live quote" means the router quoted this exact size. "Interpolated" means a line between two quoted sizes.',
  },
  poolBeforeAfter: {
    term: 'Pool before → after',
    text: "Canonical pool price now, then after this bucket's NET sells into it at the 0.30% pair fee. The hint is the move. The desk shows this when router quotes are missing.",
    doc: DOC.thinLiquidity,
  },
  priceSource: {
    term: 'Price source',
    text: 'Where the band comes from. A router name means live aggregator quotes that split the sale across NET pools. "Canonical Uniswap v2 only" means no usable router quote covers this sale. One pool alone overstates the drop.',
  },
  canonicalPool: {
    term: 'Canonical pool',
    text: "NetNet's NET/USDG Uniswap v2 pair. Spot and TWAP come from it. The desk models it as x × y = k with the 0.30% pair fee.",
    doc: DOC.canonicalPool,
  },
  poolDepth: {
    term: 'Canonical pool depth',
    text: 'USDG reserve of the canonical pool. A deeper pool moves less per NET sold. NetNet guides total Loopback borrows to 10% of this number.',
    doc: DOC.poolGuide,
  },
  routerLine: {
    term: 'Router line',
    text: 'Average USDG per NET the router quotes for a sale of each size on the x axis. The quote is after the pool fees on its route.',
  },
  canonicalLine: {
    term: 'Canonical Uniswap v2 only',
    text: 'Price left in the canonical pool after a sale of each size, at the 0.30% pair fee. It shows the last price of the sale. The average fill of the same sale is higher.',
    doc: DOC.thinLiquidity,
  },
  routeSplit: {
    term: 'Route',
    text: "How the router splits the sale across pools, as a share of NET. It is the route for this size, or for the next quoted size up. \"Canonical pair\" marks NetNet's Uniswap v2 pool.",
  },
  incentive: {
    term: 'Liquidation incentive',
    text: "A liquidator repays debt and takes collateral worth about 12.7% more at the oracle's marks. Morpho sets it from the LLTV: 1 ÷ (1 − 0.3 × (1 − 0.625)), capped at 15%.",
    doc: DOC.morphoIncentive,
  },
  treasuryFee: {
    term: 'Treasury fee',
    text: 'NET carries a 5% trading fee on mapped pools, and the lending docs say margin-call sales pay it. The buy zone leaves this fee out.',
    doc: DOC.fee,
  },
  poolGuide: {
    term: '10% pool guide',
    text: "NetNet guidance: total Loopback borrows at or below 10% of the canonical pool's USDG. It is not a cap. Above it, the lending docs expect margin calls in smaller tranches and slower unwinds.",
    doc: DOC.poolGuide,
  },
  runway: {
    term: 'Interest runway',
    text: 'If credited value stays flat, interest alone pushes health down to 1. Days = ln(health) ÷ ln(1 + borrow APY) × 365.25, for the weakest borrower still above 1.',
    doc: DOC.marginCalls,
  },
  badDebt: {
    term: 'Bad debt',
    text: "Debt that seized collateral cannot cover. A liquidator repays at most the collateral value ÷ the incentive. Morpho books the rest as a loss to the market's lenders.",
    doc: DOC.morphoBadDebt,
  },

  // Next to liquidate
  nearLiquidation: {
    term: 'Within 20% of liquidation',
    text: 'Credited value would need to fall less than 20% to bring these borrowers to health 1. Borrows under 1 USDG are left out.',
  },
  health: {
    term: 'Health',
    text: 'Credited collateral value × 62.5% LLTV ÷ debt. Under 1, anyone can liquidate the position. Red under 1.05, amber under 1.10.',
    doc: DOC.creditHealth,
  },
  healthIndexed: {
    term: 'idx',
    text: 'Health from the Morpho API, because the oracle price is missing. It can lag the chain.',
  },
  priceToLiq: {
    term: 'Price to liq',
    text: 'TWAP, in USDG per NET, that brings this borrower to health 1. The percent is the fall in credited value it takes. "NAV" rows liquidate only if NAV falls that far. "Now" rows are under 1 already.',
    doc: DOC.creditHealth,
  },
  netToMarket: {
    term: 'NET to market',
    text: 'NET a liquidator would sell from this borrower, counted at the sNET index. At the health 1 line it is about 70.4% of the wsNET collateral. A borrower already under 1 can lose all of it.',
    doc: DOC.marginCalls,
  },
  dust: {
    term: 'Dust',
    text: 'Borrows under 1 USDG. They cannot move the price, so the list hides them unless you tick this box.',
  },
  creditVaultBorrower: {
    term: 'Credit-vault borrower',
    text: "One of the five largest borrowers of NetNet Credit vault money. Its borrow is more than 5% of the USDG the vault has put into markets. Each market counts by the vault's share of its supply.",
    doc: DOC.credit,
  },
  loopbackBorrower: {
    term: 'Loopback borrower',
    text: 'This wallet has an open USDG borrow against wsNET in the Loopback market.',
    doc: DOC.lending,
  },
  protocolTag: {
    term: 'Protocol',
    text: "Address from NetNet's own contract registry. Its registry name replaces any Nansen label.",
  },

  // Bond buyers
  labelsThrough: {
    term: 'Labels through',
    text: 'Nansen labels come from NET paid out by the bond contracts up to this day, and from DEX sells. A wallet with no Nansen row shows as "Not read yet".',
  },
  epoch: {
    term: 'Epoch',
    text: "One 8-hour bond period, counted from the bond depository's start time. Each epoch has its own depository cap.",
    doc: DOC.bonds,
  },
  epochCap: {
    term: 'Depository cap',
    text: "Most NET the bond depository sells in one epoch: 0.25% of NET supply before the epoch's first bond. For the open epoch, the desk uses supply now. Bond desks sell outside this cap.",
    doc: DOC.bonds,
  },
  soldOut: {
    term: 'Sold out',
    text: 'The depository sold 99.5% of the epoch cap or more. Bond mints raise supply, and the cap with it, so the desk counts 99.5% as sold out.',
    doc: DOC.bonds,
  },
  sellOutTime: {
    term: 'Sell-out time',
    text: "Time from the epoch's open to the bond that filled 99.5% of its cap. The chart line gives the median over the sold-out epochs in the window.",
  },
  firstMinuteShare: {
    term: 'First-minute share',
    text: "Share of an epoch's depository NET bought within 60 seconds of the open. The dynamics list shows the median epoch's share when it is 25% or more.",
  },
  bondPrice: {
    term: 'Bond price',
    text: 'USDG per NET the depository charges now: TWAP minus the bond discount, never under NAV. The percent compares it with TWAP.',
    doc: DOC.bonds,
  },
  bonded: {
    term: 'Bonded',
    text: 'NET sold in bonds from every source in the window, the USDG paid, and the wallets that bought. A first-time wallet made its first bond ever in the window.',
  },
  mintedVsDeskStock: {
    term: 'Minted vs desk stock',
    text: 'Minted: NET the bond depository creates at bond time. Desk stock: NET the bond desks sell from NET deposited into them earlier. Desk sales do not count against the depository cap.',
    doc: DOC.bonds,
  },
  depository: {
    term: 'Bond depository',
    text: "NetNet's main bond contract. It mints new NET for each bond and sells at max(TWAP × (1 − discount), NAV). The NET vests over 2 days.",
    doc: DOC.bonds,
  },
  bondDesks: {
    term: 'Bond desks',
    text: 'RWA desk v1, RWA desk v2, the asset desk and the v3 sleeve desk. Each sells NET deposited into it earlier, outside the depository cap. Desk bonds vest in the desk.',
    doc: DOC.deskInventory,
  },
  v3Desk: {
    term: 'v3 sleeve desk',
    text: 'Sells NET that the manager sleeve bought back on the DEX, so its bonds mint nothing. It opened on 30 Sep 2026. The red dashed line on the chart marks it.',
    doc: DOC.deskInventory,
  },
  sleeveBuyback: {
    term: 'Sleeve buyback',
    text: 'NET the manager sleeve (a NetNet team Safe) bought on the DEX in the window, and the USDG it paid. A buy counts when NET came in and the sleeve paid USDG in the same transaction.',
    doc: DOC.deskInventory,
  },
  outcome: {
    term: 'What buyers did with the NET',
    text: "Where the window's bonded NET sits now. Each wallet counts up to its expected NET: each payout grown by the sNET index since that bond. NET the wallet bought elsewhere does not count.",
  },
  outcomeVesting: {
    term: 'Vesting',
    text: 'Bond NET the wallet has not claimed yet, at the depository or a desk. Vested but unclaimed NET counts here too.',
  },
  outcomeStaked: {
    term: 'Staked',
    text: "Held as sNET (staked NET). Each 8-hour rebase adds that epoch's dividend to the balance.",
    doc: DOC.staking,
  },
  outcomeWrapped: {
    term: 'Wrapped',
    text: 'Held as wsNET in the wallet, counted in NET at the sNET index.',
    doc: DOC.wsNet,
  },
  outcomeLooped: {
    term: 'Looped',
    text: 'wsNET posted as collateral in Loopback or its 38.5% LLTV twin market, counted in NET at the sNET index.',
    doc: DOC.lending,
  },
  outcomeLiquid: {
    term: 'Liquid',
    text: 'Plain NET in the wallet.',
  },
  outcomeSold: {
    term: 'Sold on DEX',
    text: 'NET the wallet sold on a DEX since launch, from Nansen trades, capped at what left the wallet. DEX buys do not offset these sells.',
    doc: DOC.nansenTrades,
  },
  outcomeMoved: {
    term: 'Moved out',
    text: 'NET that left the wallet another way: transfers, other contracts, or exchanges. It is what left the wallet minus DEX sells.',
  },
  outcomeLeft: {
    term: 'Left the wallet',
    text: 'NET no longer in the wallet. DEX sells are not read yet, so sold and moved show as one part.',
  },
  outcomeUnread: {
    term: 'Not read yet',
    text: 'Bonded NET of wallets whose holdings the desk has not read yet.',
  },
  buyerGroup: {
    term: 'Buyer group',
    text: 'One group per wallet, from all-time behavior: what it holds now and its Nansen DEX sells. Shares are of expected NET: each payout grown by the sNET index since that bond. The desk checks the rules in a fixed order, and the first match wins.',
  },
  groupProtocol: {
    term: 'Protocol wallets',
    text: "NetNet's own contracts and team wallets, from its contract registry.",
  },
  groupNew: {
    term: 'New buyers',
    text: 'First bond in the last 48 hours, with half or more of their bonded NET still vesting.',
  },
  groupArbitrageur: {
    term: 'Arbitrageurs',
    text: 'Bonded in 3 or more epochs and sold 80% or more of their bonded NET on the DEX.',
  },
  groupWeak: {
    term: 'Weak hands',
    text: 'Sold half or more of their bonded NET on the DEX, for less USDG than those NET cost in bonds.',
  },
  groupMercenary: {
    term: 'Mercenaries',
    text: 'Sold half or more of their bonded NET on the DEX, for at least what those NET cost in bonds.',
  },
  groupMover: {
    term: 'Movers',
    text: 'Half or more of their bonded NET left the wallet without a DEX sale.',
  },
  groupLeft: {
    term: 'Left the wallet',
    text: 'Half or more of their bonded NET left the wallet. DEX sells are not read yet, so sold and moved are one group.',
  },
  groupLooper: {
    term: 'Loopers',
    text: 'Still hold half or more of their bonded NET. Half or more of what they hold is wsNET posted in Loopback or its twin market.',
  },
  groupStrong: {
    term: 'Strong hands',
    text: 'Still hold 80% or more of their bonded NET and sold under 10% on the DEX.',
  },
  groupTrimmer: {
    term: 'Trimmers',
    text: 'Still hold half or more of their bonded NET, but miss the Loopers and Strong hands rules.',
  },
  groupMixed: {
    term: 'Mixed',
    text: 'Hold under half, sold under half and moved under half. No other rule fits.',
  },
  groupUnknown: {
    term: 'Not read yet',
    text: "The desk has not read this wallet's holdings yet.",
  },
  avgPrice: {
    term: 'Avg price',
    text: 'USDG per NET the group paid for bonds in the window. Bonds with no USDG value are left out.',
  },
  groupSold: {
    term: 'Sold',
    text: "Share of the group's bonded NET sold on the DEX since launch, from Nansen. Only wallets with a holdings read count.",
    doc: DOC.nansenTrades,
  },
  stillHeld: {
    term: 'Still held',
    text: "Share of the group's bonded NET still in the wallet: vesting, staked, wrapped, looped, or liquid.",
  },
  realizedPnl: {
    term: 'Realized PnL',
    text: 'All-time USD from DEX sells minus what those NET cost in bonds. Sells of NET the wallet bought on the DEX count too.',
  },
  smartMoney: {
    term: 'Smart money',
    text: 'Wallets whose Nansen label has the smart money mark (🤓) or names Smart Trader, 30D/90D/180D Smart Trader, Smart HL Perps Trader or Fund. Nansen dropped Fund from its own list in September 2026. Former Smart Trader does not count.',
    doc: DOC.nansenSmart,
  },
  cohortPublic: {
    term: 'Public figures',
    text: 'Wallets Nansen marks as a public figure (👤) and not as smart money.',
  },
  cohortHl: {
    term: 'Hyperliquid traders',
    text: 'Wallets with a Nansen Hyperliquid label: HL Perps, HL Referral, or HL Vault.',
  },
  cohortLabelled: {
    term: 'Other labelled',
    text: 'Wallets with any other label: bots, former smart traders, protocol contracts, or named wallets.',
  },
  cohortUnlabelled: {
    term: 'Unlabelled',
    text: 'Nansen has a row for this wallet, but its label is only the address.',
  },
  cohortUnread: {
    term: 'Not read yet',
    text: 'Nansen has no row for this wallet yet. Labels come with a bond payout or a DEX sell. A wallet that has not claimed or sold since the last read has none.',
  },
  firstBond: {
    term: 'First bond',
    text: "Time since the wallet's first bond ever, from any source.",
  },
  nowBar: {
    term: 'Now',
    text: "Where the wallet's bonded NET is now, all time, as shares of its expected NET. Hover the bar for the split.",
  },
  dexSold: {
    term: 'DEX sold',
    text: 'NET the wallet sold on the DEX in the window, from Nansen. A dash means the DEX read has not run yet.',
    doc: DOC.nansenTrades,
  },
  tagTop10: {
    term: 'Top 10',
    text: 'One of the 10 wallets that bonded the most NET in this window.',
  },
  tagFirstBond: {
    term: 'First bond in window',
    text: "The wallet's first bond ever falls inside this window.",
  },
  tagSoldOnDex: {
    term: 'Sold on DEX',
    text: "The wallet sold NET on the DEX in this window, from Nansen. Before the bond DEX read lands, the tag uses Nansen's top 100 sellers of the last 7 days.",
    doc: DOC.nansenTrades,
  },
  bondChart: {
    term: 'Bonded NET per epoch',
    text: 'Each column is one epoch: NET bonded from every source, colored by buyer group or by source. The black tick is the depository cap. The dashed box is the open epoch.',
  },
  chartMarkers: {
    term: 'Desk markers',
    text: "A grey dashed line marks a desk's first bond. The red dashed line marks the v3 desk launch. After it, desk bonds can sell bought-back NET with no mint.",
  },
  priceOverlay: {
    term: 'Price',
    text: 'Adds the NET/USDG close of each 4-hour candle on a right axis, from GeckoTerminal.',
  },
  fillPrice: {
    term: 'Bond fill price',
    text: 'The average USDG per NET that bonds paid in that epoch. A dot under the price line means bonds paid less than the market close.',
  },

  // DEX flows
  smartMoneyNet: {
    term: 'Smart money net · 7d',
    text: 'USD of NET that flowed into Nansen smart money wallets minus what flowed out over 7 days, from Nansen flow intelligence. Transfers count, not only DEX trades. The hint adds the wallet count, the 1-day figure and the 7-day change in their NET holdings.',
    doc: DOC.nansenFlows,
  },
  dexNet: {
    term: 'DEX net · 7d',
    text: "USD of NET bought minus USD sold over 7 days, from Nansen's spot trading volume for NET. Below zero, more NET was sold than bought.",
  },
  loopbackBorrowersNet: {
    term: 'Loopback borrowers · 7d',
    text: "USD of NET that Loopback borrowers bought minus sold on DEXs over 7 days. Only borrowers in Nansen's top 100 buyers or top 100 sellers count.",
    doc: DOC.nansenTrades,
  },
  smartAddingCutting: {
    term: 'Smart money adding / cutting',
    text: 'Smart money wallets with the largest net buys (adding) or net sells (cutting) of NET. The list comes from up to 200 smart money DEX trades that Nansen returns for the last 7 days.',
    doc: DOC.nansenSmart,
  },
  topWalletsByLabel: {
    term: 'Top 100 wallets by label',
    text: "Nansen's top 100 DEX buyers and top 100 DEX sellers of NET over 7 days, joined by wallet and grouped by label. Smart money is not in this table. The first tile has it.",
    doc: DOC.nansenTrades,
  },
  protocolWallets: {
    term: 'Protocol',
    text: "Contracts and wallets from NetNet's registry, plus Uniswap, Pendle and Morpho contracts, liquidity pools and token contracts.",
  },
  stakingPoolLabel: {
    term: 'NET staking pool',
    text: "The NET staking contract. It shows up in DEX flows. Read its buys and sells as protocol flow.",
    doc: DOC.staking,
  },
  formerSmart: {
    term: 'Former smart',
    text: 'Wallets that Nansen once labelled smart money and later dropped (🔧 Former Smart Trader). The desk does not count them as smart money.',
    doc: DOC.nansenSmart,
  },
  stakingShare: {
    term: 'Staking pool',
    text: 'Share of NET supply held in the staking contract, and its change in NET over 7 days.',
    doc: DOC.staking,
  },
  freeFloat: {
    term: 'Free float',
    text: 'NET supply minus the NET in the staking pool.',
  },
  top10Float: {
    term: 'Top 10 of float',
    text: 'Share of free float held by the 10 largest holders, without the staking pool and protocol contracts. The hint counts holders that grew or shrank by more than 0.01 NET in 7 days.',
  },

  // Loop stress
  looperCarry: {
    term: 'Looper carry',
    text: 'Daily index growth against daily borrow cost for a wsNET → USDG loop: (1 + implied index) ÷ (1 + borrow) − 1. Below zero, interest grows faster than the collateral.',
    doc: DOC.marginCalls,
  },
  borrowRate: {
    term: 'Borrow',
    text: 'Loopback borrow cost per day, compounded from the APY. Above 90% utilization the hint also shows the rate in 7 days if utilization holds.',
    doc: DOC.morphoCurve,
  },
  borrowPassesIndex: {
    term: 'Borrow passes index',
    text: 'Days until the Loopback borrow rate passes the Pendle implied index, if utilization holds. After that, carry is negative. The tile shows within 30 days and turns amber under 14.',
    doc: DOC.morphoCurve,
  },
  impliedIndex: {
    term: 'Pendle implied index',
    text: "Pendle's implied APY for sNET as a daily rate: the market price for sNET index growth up to the maturity. It is in NET, not USD.",
    doc: DOC.pendleImplied,
  },
  trailingIndex: {
    term: 'Trailing index',
    text: "Pendle's underlying APY for sNET as a daily rate: the 7-day moving average of actual index growth.",
    doc: DOC.pendleUnderlying,
  },
  sNetIndex: {
    term: 'sNET index',
    text: 'NET per wsNET. It started at 1.0 at launch and rises with each 8-hour rebase that pays a dividend. Credited value and seized NET both scale with it.',
    doc: DOC.staking,
  },
  utilization: {
    term: 'Utilization',
    text: "Borrowed USDG ÷ supplied USDG in the Loopback market. Morpho's adaptive curve targets 90%: above it the borrow rate climbs each day, below it the rate falls. Amber over 98%.",
    doc: DOC.morphoCurve,
  },
  adaptiveCurve: {
    term: 'Adaptive curve',
    text: "Morpho's interest model. At 100% utilization the rate is 4 × the rate at the 90% target. While utilization stays above 90%, the target rate itself rises day by day, up to 200% a year.",
    doc: DOC.morphoCurve,
  },
  borrowedVsGuide: {
    term: 'Borrowed vs pool guide',
    text: 'Total Loopback borrow ÷ 10% of canonical pool USDG. 1.0× is at the guide. Above 1.0× the tile turns amber, and the lending docs expect smaller margin-call tranches.',
    doc: DOC.poolGuide,
  },
  pinnedMarkets: {
    term: 'Pinned markets',
    text: 'A vault market counts as pinned above 98% utilization. When every funded market is pinned, the vault has no idle USDG to move into Loopback, so nothing cools its rate.',
    doc: DOC.credit,
  },
  exitLiquidity: {
    term: 'Withdrawable now',
    text: 'USDG depositors can take out of the credit vault right now: unlent USDG in the Loopback market. The rest waits for repayments or for USDG moved back from other markets. The desk flags it under 5% of assets.',
    doc: DOC.creditSupply,
  },
  vaultInCap: {
    term: 'Vault in / cap',
    text: 'USDG the credit vault has lent into this market, against the most the curator allows there.',
    doc: DOC.creditMarkets,
  },
  lltv: {
    term: 'LLTV',
    text: 'Liquidation loan-to-value: the debt share of collateral value at which Morpho can liquidate. 62.5% for Loopback and five stock markets, 38.5% for COIN.',
    doc: DOC.creditMarkets,
  },
  largestBorrower: {
    term: 'Largest borrower',
    text: "The top borrower's share of all USDG the vault has put into markets. Each market counts by the vault's share of that market's supply.",
    doc: DOC.credit,
  },
  activeMaturity: {
    term: 'Active maturity',
    text: 'Expiry of the Pendle sNET market that trades now. Pendle prices index growth only up to this date. The desk uses that rate past it too.',
    doc: DOC.pendleMaturity,
  },
} satisfies Record<string, GlossaryEntry>

export type GlossaryId = keyof typeof ENTRIES

export const GLOSSARY: Record<GlossaryId, GlossaryEntry> = ENTRIES
