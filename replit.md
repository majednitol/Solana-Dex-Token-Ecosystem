# Cryptonite Swap Simulation

## Overview
Cryptonite Swap Simulation by Electtrium is a decentralized exchange style application built on Solana for token swapping simulation, liquidity, token data display, and admin-side management tools. The project focuses on a smooth trading-style user experience, wallet connectivity, market visualization, and modular backend services.

## User Preferences
- Prefer detailed explanations
- Prefer iterative development
- Ask before major architectural changes
- Do not modify `dist/`
- Do not modify `src/index.ts`

## System Architecture

### Frontend
The frontend is a React 19 application using Vite and React Router. It includes a dark-themed UI, animated background effects, token swap screens, markets, assets, docs, settings, support pages, and an admin panel. Wallet connectivity is part of the user flow.

### Icons
All UI icons use **lucide-react v0.468.0** (NOT v1.x — causes `useLucideContext` hook error). Emoji icons have been fully replaced with Lucide SVG components across Sidebar, MobileNav, Dashboard, Swap, BuyTokens, Settings, Api, GetListed, and all other pages. Only content-level emojis in Announcements awards data remain (intentional).

### Content View Page
A dedicated content reader at `/post/:id` (ContentView.jsx) that displays full blog posts and feed articles. Feed items and blog sidebar items in Announcements.jsx are clickable and navigate to this page. Supports article text with typography, hero images, quoted tweet embeds, YouTube video embeds (iframe), native video files (HTML5 video), external video links (fallback button), and a comments placeholder section. ID format: `feed-{id}` for feed posts, `blog-{tab}-{id}` for blog posts. Content data lives in `frontend/src/data/contentData.js` (FEED_POSTS, BLOG_POSTS, TAG_COLORS) — imported by both Announcements.jsx and ContentView.jsx. Blog posts include `fullContent` field with multi-paragraph long-form text.

### Exchange Chart
The exchange page chart (`ExchangeChart` component in `Swap.jsx`) is a custom SVG chart with TradingView-style rendering:
- Candlestick mode with proper green (#22c55e) / red (#ef4444) candle bodies and wicks
- Area chart mode with gradient fill
- Volume bars beneath the price chart area
- Grid lines with price axis labels (right side) and time axis labels (bottom)
- Crosshair hover with highlighted price label
- 380px minimum chart height, 700x415 SVG viewBox with `xMidYMid meet` aspect ratio

### Limit Orders
The Limit tab and all related limit-order UI have been removed from the exchange page. The exchange now shows only three tabs: Swap, Buy, and Sell. The open orders display panel (table below the chart with cancel buttons) has also been removed. The backend limit order API endpoints (POST/GET/DELETE `/limit-orders`) remain in place for potential future use or cleanup.

### Performance Optimizations
- **Route-level code splitting**: All page components use `React.lazy()` + `Suspense` in `App.jsx` — pages load on demand, not all upfront. Admin.jsx (4200+ lines) only loads when navigating to `/admin`.
- **Memoized components**: `SparklineChart`, `MarketRow`, `DashAssetRow`, `DashBarChart`, `DashAreaChart`, `DashLineChart` are wrapped in `React.memo` to prevent unnecessary SVG/chart re-renders.
- **Stable prop identities**: `useTokenApi` returns `useCallback`-wrapped `getApiName`/`getApiImage`; Dashboard uses stable fallback constants (`EMPTY_STATS`, `EMPTY_SUPPLY`, `EMPTY_SPARK`) and `useCallback` for `formatVolumeWithUnits`.
- **Memoized derived data**: `stakingData` and `realChartData` in Dashboard use `useMemo` to avoid recomputation.
- **Vite build optimization**: `manualChunks` splits vendor bundles (react, solana, wallet-adapter, tanstack-query) for better caching. Build target is `esnext` with `esbuild` minification.

### Chart Data Pipeline Optimization
- **Pre-computed candles**: `chart_candles` table stores OHLCV candles at 1m/5m/15m/1h/4h/1d intervals. Upserted on each trade via `recordTrade()`. Background rollup job (every 5 min) aggregates fine-grained into coarser buckets.
- **Pre-computed stats**: `token_stats_cache` table stores latest_price, price_24h_ago, price_7d_ago, earliest_price, volume_24h, trades_24h. Updated incrementally on each trade and fully refreshed every 60s by background job.
- **Sparkline descriptors**: Backend returns a fixed 20-point LTTB-downsampled array with pre-computed min/max/start/end/trend. Response size is constant regardless of lookback period.
- **Max candle cap**: Candle responses capped at 200 points. If exceeded, auto-steps to coarser interval or applies LTTB downsampling.
- **Extended cache TTLs**: Historical candle buckets cached for 5 minutes, current bucket 30s. Stats cached for 60s in memcache. Route-level stats cache extended to 60s.
- **Frontend SVG path rendering**: SparklineChart uses a single SVG `<path>` instead of 168+ individual `<rect>` elements. All `Math.max(...spread)` calls on large arrays replaced with for-loop min/max.

### State Management (Zustand + TanStack Query)
Frontend state management uses **Zustand** stores for client-only state and **TanStack Query** for all server data fetching/caching. 

**Zustand stores** (`frontend/src/stores/`):
- `useThemeStore.js` — dark/light theme with localStorage persistence
- `useLanguageStore.js` — i18n language selection with localStorage persistence
- `useCurrencyStore.js` — display currency (USD/EUR/etc) with localStorage persistence
- `useWatchlistStore.js` — saved token watchlist with localStorage persistence
- `useAdminStore.js` — admin wallet list (synced from query)
- `useTokenPriceStore.js` — token prices (synced from query)
- `useTokenListStore.js` — token registry (synced from query)

**TanStack Query hooks** (`frontend/src/hooks/queries/`):
- `useTokenListQuery.js` — `/api/tokens` with SSE invalidation
- `usePoolPricesQuery.js` — `/api/admin/pools` + on-chain pool data
- `useAdminOwnersQuery.js` — `/api/admin/multisig-owners`
- `useTokenSupplyQuery.js` — `/api/admin/tokens` (supply/decimals)
- `useAdminPoolsQuery.js` — `/api/admin/pools` (pool list)
- `useSetupStatusQuery.js` — `/api/admin/setup/status`
- `useTreasuryDataQuery.js` — batch: squads state, vault balances, fee history, owners, wallets, proposals
- `useSwapLimitsQuery.js` — `/api/swap/limits` + admin swap limits/proposals
- `useReferralQuery.js` — referral code/stats/config + admin referral config/proposals
- `useTokenPricesQuery.js` — admin token buy prices + proposals (`/api/admin/token-prices`)
- `usePoolReservesQuery.js` — `/api/pools?tokenA=X&tokenB=Y` (pool reserves with retry)
- `useSwapQuoteQuery.js` — `/api/quote?mintIn=X&mintOut=Y&amountIn=Z` (swap quotes)
- `useGlobalMarketQuery.js` — CoinGecko market data
- `useApiMutation.js` — generic POST/PATCH mutation + `useSendTransaction`

**Integration layer**:
- `useAdminHook.js` (`frontend/src/hooks/`) — pure computation: bridges Zustand admin store with `useWallet()` for `isAdmin`/`adminRole`
- `StoreInitializer.jsx` (`frontend/src/components/`) — renders null, bootstraps query→Zustand sync and centralizes all SSE invalidation via `queryClient.invalidateQueries()`

### Price Data
`useTokenPriceStore` is the main source of token pricing in the frontend. It loads pool pairs from the DB (`/api/admin/pools`) and only queries on-chain data for pools that actually exist, with 429 retry logic. Refreshes every 60 seconds.

### Volume & Market Cap
- **Volume:** `trade_events.amount_in` stores human-readable amounts (e.g., `1000000` = 1M tokens). SQL queries use `SUM(amount_in)` directly — no decimal division.
- **Market Cap:** Computed on frontend as `price × (supply / 10^decimals)`. Supply data fetched from `GET /api/admin/tokens` (from `tokens` table).
- **Trade Price:** Computed as `amountOut / amountIn` from the swap quote at execution time, not from static token prices.

### Pool Data Caching
`PoolService` uses a 30-second in-memory cache keyed by sorted mint pair. This prevents Solana RPC rate-limiting (429) when multiple frontend components query the same pool data simultaneously.

### Backend Library
A TypeScript library running on Node.js 20 handles Solana-related integration logic, transaction preparation, and supporting blockchain utilities.

### Backend API
A Node.js 20 REST API built on **Fastify** mediates blockchain-related operations and application data. It includes modular services for tokens, swaps, pools, liquidity, referral logic, and treasury-related management. The backend is designed so user authorization and transaction approval remain on the client side when required. Key Fastify plugins: `@fastify/cors`, `@fastify/compress`, `@fastify/static` (for `/uploads/`), `@fastify/multipart` (for token logo uploads).

### Solana Error Decoder
`api/utils/solana-error-decoder.js` maps raw Solana error codes to user-friendly messages. Covers Orca Whirlpool program errors (0x1770–0x1798), SPL Token program errors, System Program errors, and pattern-based matching for common failures (insufficient funds, expired blockhash, network errors). Used in `/api/pools/build` and `/api/send` catch blocks. Returns `null` for wallet rejections (already handled by frontend). Unknown codes get a clean fallback like "Transaction failed (error code: 0x...)".

### API Performance Optimizations
- **Gzip/deflate compression**: JSON responses >1KB are compressed via `@fastify/compress` plugin (gzip preferred, deflate fallback; typically 50% size reduction)
- **Batched Solana RPC**: `getMultipleAccountsInfo` (chunked at 100 accounts) replaces sequential `getTokenAccountBalance` loops in `getOwnerBalances`, `getBalances`, `getSquadsVaultBalances`, `ensureVaultAtas`, and `loadFromRegistry`
- **Route-level TTL cache**: `RouteCache` (Map-based) in `index.js` for `/health` (10s), `/tokens` (30s), `/chart/stats` (15s)
- **In-memory TTL cache**: `MemCache` (Map-based, 15s TTL) in `trade.service.js` for token stats, layered on top of Redis cache
- **Single-query stats**: `getAllTokenStats` uses one CTE-based SQL query instead of N per-token subqueries
- **Treasury balance TTL**: 60s; cache warming after fee collection events (fire-and-forget `getSquadsVaultBalances()`)
- **Request body limit**: 5MB max via Fastify `bodyLimit`; multipart uploads up to 2MB via `@fastify/multipart`
- **Parallel processing**: `withdrawAllTransferFees` uses `Promise.allSettled` with concurrency=2; `loadFromRegistry` fetches Metaplex metadata in parallel via `Promise.allSettled`

### Swap Limits
Per-wallet swap limits enforced server-side at `POST /swap`, `POST /swap/build`, `GET /swap/limits`:
- **Default daily limit**: 100 tokens (rolling 24 hours)
- **Default monthly limit**: 500 tokens (rolling 30 days)
- Limits are now stored in the `swap_limit_config` DB table; defaults used as fallback if no config exists
- `TradeService.getSwapLimits()` reads from DB with 60s memcache TTL
- `TradeService.checkSwapLimits(usage, amount, limits)` accepts dynamic limits parameter
- Admin can propose limit changes via Squads multisig (`POST /admin/squads/propose-limit-change`)
- Proposals tracked in `swap_limit_proposals` DB table with approve/execute flow
- On execution, new limits are written to `swap_limit_config` and cache is invalidated
- Admin panel shows Swap Limits section in Treasury tab with current limits, propose form, and proposal history
- SSE channel `swap_limits_update` broadcasts limit changes to connected admin clients
- `GET /admin/swap-limits` returns current limits config
- `GET /admin/swap-limits/proposals` returns proposal history
- `POST /admin/swap-limits/proposals/update-status` handles approve/execute actions
- Frontend (`Swap.jsx`) shows "Daily: X/limit | Monthly: Y/limit" when wallet connected
- Swap button disabled and shows "Swap Limit Reached" when limits exceeded

### MoonPay Buy & Sell Crypto Integration
MoonPay integration allows users to buy crypto via fiat and sell crypto for fiat through MoonPay's hosted widget, with on-chain token movement.
- **Frontend hook**: `frontend/src/hooks/useMoonPay.js` — manages buy (`openWidget`) and sell (`openSellWidget`) widget lifecycle, transaction creation/update, transaction history polling, and on-chain token swap/transfer. Separate SDK refs (`sdkRef` for buy, `sellSdkRef` for sell).
- **On-chain flows**: Buy flow calls `executeBuySwap()` (POST `/api/buy/build` — requires verified MoonPay tx record (moonpayTxId+updateToken), server computes token amount from fiat via pool price oracle, builds Token-2022 transfer from server wallet ATA to buyer, server partial-signs, buyer's Phantom wallet signs as fee payer, then POST `/api/send`) after MoonPay `onTransactionCompleted`. Sell flow calls `executeSellTransfer()` (client-signed transfer/build to treasury vault + sign + send) before opening MoonPay widget. Both store `tx_signature` via PATCH.
- **API endpoints**: `POST /moonpay/transaction` (create), `PATCH /moonpay/transaction/:id` (update status + txSignature), `GET /moonpay/transactions/:wallet` (list history), `GET /moonpay/treasury-vault` (vault address), `POST /moonpay/transfer/build` (build Token-2022 transfer to vault)
- **DB table**: `moonpay_transactions` with UUID primary key, wallet address, fiat/crypto amounts, status tracking, MoonPay transaction ID, `type` (`'buy'`|`'sell'`), `token_price`, `tx_signature`
- **Widget**: Opens MoonPay sandbox overlay; separate SDK instances for buy flow (`flow: 'buy'`) and sell flow (`flow: 'sell'`)
- **UI indicators**: `onchainStep` state shows building/signing/sending progress in BuyTokens.jsx and Swap.jsx. Transaction history table includes Tx column linking to Solana Explorer.
- **Env var**: `VITE_MOONPAY_API_KEY` in `frontend/.env` — Vite-prefixed for client-side access
- **Integrated in**: `BuyTokens.jsx` (Buy/Sell tabs on dedicated page) and `Swap.jsx` (Swap/Buy/Sell tabs)
- **Transaction history**: Shown in BuyTokens.jsx info panel with Type column (Buy/Sell) color-coded

### NOWPayments Crypto Payment Integration
NOWPayments integration allows users to buy any platform token (NTC, ASDC, etc.) by paying with 100+ supported cryptocurrencies (BTC, ETH, USDT, etc.). Server holds token reserves and auto-transfers the selected token on confirmed payment.
- **Service**: `api/services/nowpayments.service.js` — wraps NOWPayments REST API (currencies, estimates, payments, IPN verification)
- **Multi-token support**: Frontend token selector lets users choose which token to receive (NTC, ASDC, etc.). `tokenSymbol` param flows through estimate, create-payment, and DB storage. All delivery paths (poll, IPN, sandbox) read `token_symbol` from DB and call `sendTokenToUser()` which resolves the correct SPL mint via `getTokenMint(symbol)`. `getNtcPriceUsd(tokenSymbol)` accepts any platform token symbol.
- **Flow**: User specifies dollar amount (USD) → selects receive token → backend calculates token amount from pool price → user picks payment currency → NOWPayments payment created → user sends crypto to generated pay address → NOWPayments confirms payment via IPN/polling → server auto-transfers selected token to buyer's wallet. Legacy `ntcAmount` param still supported for backwards compat.
- **API endpoints**: `GET /buy/currencies` (supported coins), `GET /buy/estimate` (price estimate, accepts `dollarAmount` or `ntcAmount` + `tokenSymbol`), `POST /buy/create-payment` (create payment, accepts `dollarAmount` or `ntcAmount` + `tokenSymbol`), `GET /buy/payment-status/:id` (poll status), `POST /buy/ipn` (IPN webhook), `GET /buy/purchases/:wallet` (user history), `GET /admin/purchases` (admin view)
- **DB table**: `token_purchases` with UUID primary key, wallet, NTC amount, USD price, pay currency/amount, NOWPayments ID/status, payment address, status (pending/confirming/confirmed/sending/completed/failed/send_failed/underpaid), NTC tx signature, `pay_tx_hash`, `confirmed_at`, `sent_at`, `token_symbol` (default 'NTC')
- **Payment verification**: NowPayments handles all on-chain payment verification internally. Payment confirmation is received via IPN webhook (HMAC-verified) or status polling. No custom on-chain EVM verification is needed — NowPayments monitors pay addresses and reports payment status directly.
- **Token transfer**: `sendTokenToUser(conn, wallet, recipient, amount, tokenSymbol)` in `api/index.js` — resolves SPL mint via `getTokenMint(symbol)`, builds Token-2022 transfer from server wallet ATA to buyer ATA, server signs and sends. Includes server ATA existence check, balance check, and 3-retry loop with exponential backoff. Failure reasons persisted to DB. `sendNtcToUser()` is a backwards-compatible wrapper that calls `sendTokenToUser` with 'NTC'.
- **Frontend**: `BuyTokens.jsx` and `Swap.jsx` Buy tab both have "Pay with Crypto" with currency picker, payment address display, copy button, and status polling
- **Unified Wallet Payment (Reown AppKit)**: `frontend/src/hooks/useCryptoWallet.js` — unified hook for direct wallet payment across EVM, SOL, and manual currencies. Main entry point is `connectAndSend(currency, recipientAddress, amount)` which routes by currency type. SOL uses Phantom browser wallet directly via `connectAndSendSol` (no WalletConnect). EVM uses `connectAndSendEvm` which calls `resetAppKit()` first to clear stale sessions, then opens AppKit Connect modal; on connection, `detectConnection` event handler fires `sendEvmPaymentDirect`. BTC/LTC/DOGE/TRX etc. show manual copy-address only (no wallet buttons). `getPhantomProvider()` prefers `window.phantom.solana` over `window.solana`. `getEvmWalletProvider()` tries AppKit's eip155 provider first, then injected `window.ethereum`. AppKit config in `frontend/src/config/appkit.js` with `initAppKit()` and `resetAppKit()` exports. `getCurrencyType()` returns 'evm', 'solana', or 'wallet'. State resets on currency change and payment reset. `isPhantomInstalled()` exported for UI detection.
- **IPN Callback URL**: NOWPayments IPN webhook URL uses `APP_URL` or `PUBLIC_DOMAIN` env var (e.g., `https://cryptoniteswap.xyz`) with fallback to Replit-specific env vars. The IPN URL format is `{APP_URL}/api/buy/ipn` matching the NGINX proxy path. A startup warning is logged if no public domain is configured.
- **Admin**: `Admin.jsx` Purchases tab shows all NOWPayments purchases with wallet, NTC amount, USD, paid amount, statuses, tx links
- **Env vars**: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET` — must be set in environment for payment creation and IPN verification

### Treasury Management
Treasury management is handled exclusively through Squads Protocol v4. The old custom Anchor-based treasury multisig code (IDL loading, custom PDAs, propose/approve/execute via custom program) has been fully removed. The `treasury.service.js` now only handles fee collection, balance tracking, and Squads vault integration.

### Squads Protocol Integration
Squads Protocol v4 (`api/services/squads.service.js`) is the sole multisig/treasury layer. Key features:
- Create multisig (2-of-3 threshold with 3 hardware wallet owners)
- Vault transaction creation, proposal, approval, and execution via Squads SDK
- Vault ATA management for all supported tokens
- Treasury service integration: `setSquadsVault()` redirects fee deposits to Squads vault ATAs
- Admin API routes at `/admin/squads/*` for all Squads operations
- **Token minting**: Tokens are minted directly to the Squads vault ATAs (not the admin wallet). The `token-creation.service.js` resolves the vault PDA from `multisig_config` and mints supply to the vault's associated token account.
- **Treasury address resolution**: On startup, `index.js` reads the Squads vault PDA from `multisig_config.treasury_authority_pda` in the database (falls back to derived PDA if not available).

### Fee Collection to Treasury
Two fee types are collected to the Squads treasury vault:
- **Orca pool swap fee (0.3%)**: Built into each Whirlpool pool (feeRate=3000 on mainnet = 0.30%, tickSpacing=64, FeeTier address `HT55NVGVTjWmWLjV7BrSMPVZ7ppU8T2xE5nCAZ6YaGad`). Accrues to LP positions. Collected via `/fees/collect/build` (harvest position) or `/treasury/fees/collect`. Since the treasury vault owns the LP positions, harvested fees go to the vault.
- **Token-2022 transfer fee (0.05%)**: Enforced by the Token-2022 program on every transfer. Fees accrue on destination ATAs, are harvested to mint, then withdrawn to treasury vault via `/treasury/fees/withdraw`.
- Both fee types ultimately land in the Squads vault ATAs for each token.

### Internal Price Oracle
The platform includes an internal price oracle system that tracks on-chain pool prices and swap execution prices, with VWAP calculations using a 30% rolling-median spike filter:
- **Price Watcher Worker** (`worker/priceWatcher.js`) — Runs every 60s (configurable via `PRICE_WATCH_INTERVAL_MS`), iterates all pools from DB, fetches on-chain prices via `PoolService.getPoolPrice()`, stores both directions (A→B and B→A) to `token_prices` table. Also snapshots recent swap prices from `trade_events` (computing true execution price as `amountOut/amountIn`). Auto-prunes records older than 400 days every 1440 cycles. Includes 429 retry with exponential backoff for RPC errors.
- **Price Service** (`api/services/price.service.js`) — Core oracle logic: `savePrice()`, `getLatestPrice()`, `getLatestPrices()`, `getHistoricalPrices(token, days)`, `getHistoricalPricesFiltered({tokenSymbol, pairSymbol, from, to, limit, offset})`, `get365DayAveragePrice(token)` (365-day VWAP), `getVwap({tokenSymbol, pairSymbol, days})` (VWAP with rolling-median 30% spike filter + configurable `minVolumeThreshold` for low-volume exclusion), `get24hVolume()`, `getRecentSwapPrices()`, `pruneOldPrices()`.
- **Oracle API Endpoints** (all accept `token` query param, `symbol` also accepted for backward compat):
  - `GET /oracle/price?token=NTC&pair=ASDC` — Latest price for a token (15s cache)
  - `GET /oracle/prices` — All latest prices (15s cache)
  - `GET /oracle/history?token=NTC&pair=ASDC&from=...&to=...&limit=500` — Historical price records (60s cache)
  - `GET /oracle/vwap?token=NTC&pair=ASDC&days=365` — VWAP with 30% rolling-median spike filter (60s cache)
  - `GET /oracle/valuation` — Treasury vault total valuation using 365-day average prices (30s cache)
- **New Oracle API** (`api/controllers/oracle.controller.js`, `api/routes/oracle.routes.js`) — Structured endpoint layer with `{ success: true, data: ... }` response format:
  - `GET /oracle/price/latest?token=NTC` — Latest price for a token (15s cache)
  - `GET /oracle/price/feed?token=NTC` — Chainlink-style price feed (roundId, answer, decimals)
  - `GET /oracle/price/history?token=NTC&limit=50` — Historical price records
  - `GET /oracle/price/average?token=NTC` — 365-day average price with filter stats
  - `GET /oracle/price/vwap?token=NTC&days=365` — VWAP with spike filter stats
  - `GET /oracle/price/status?token=NTC` — Price validity status (stale/deviated check)
  - `GET /oracle/treasury/value` — Treasury vault valuation
  - `GET /oracle/performance` — System performance metrics (uptime, response times, cache, memory, oracle feed health)
- **Oracle Frontend Page** (`frontend/src/pages/Oracle.jsx`) — Two tabs: **Price Oracle** (token selector with all tokens dynamically loaded, latest price, price status indicator, feed view, 365-day average, VWAP, treasury valuation, price history table, API reference) and **Performance** (system uptime, request throughput, cache hit rate, memory usage, oracle feed health, slowest/busiest endpoints, recent errors). Auto-refresh every 30s. Route: `/oracle`.
- **Metrics Service** (`api/services/metrics.service.js`) — Tracks API response times (avg/min/max/P95), cache hit/miss rates, HTTP status codes, memory usage, error log. Integrated via Fastify `onRequest`/`onResponse` hooks and `RouteCache` hit/miss tracking.
- **Monitor Integration**: Orca swap monitor `onSwap` callback computes true swap execution price from pre/post token balance diffs and feeds to price service in real-time.
- **Treasury Integration**: `TreasuryService.getVaultValuation(priceService)` computes total vault value using 365-day average prices. `TreasuryService.shouldBuy(tokenSymbol, priceService)` recommends buying when current price is below 365-day average.
- **DB Table**: `token_prices` — columns: `token_symbol`, `token_mint`, `pair_symbol`, `pair_mint`, `pool_address`, `price`, `liquidity`, `source` (pool/swap), `volume`, `created_at`. Indexed on `(token_symbol, created_at)`, `(token_mint, created_at)`, `(token_symbol, pair_symbol, created_at)`. Low-volume filtering controlled by `ORACLE_MIN_VOLUME` env var (default: 1).

### Automation Workers
Background workers in `worker/` handle automated treasury operations:
- `feeCollector.js` — **Primary fee collector** running as "Fee Collector" workflow. Every 10 minutes (configurable via `FEE_COLLECT_INTERVAL_MS`), collects both pool swap fees (Orca LP harvest) and Token-2022 transfer fees to the treasury vault. Auto-resolves vault address from `multisig_config` DB table. Pool harvest uses `WALLET_KEY` env var (base58 private key) for the server wallet. Sets Redis `fee_collector:pool_harvest` flag (300s TTL) to pause Price Watcher during harvest.
- `tradeBotCron.js` — **Auto trade bot** running as "Trade Bot" workflow. Executes 10,000 bidirectional swaps over 2 hours across NTC/ASDC, NTC/EDC, NTC/RDC pairs. Checks wallet balance before each swap to calculate safe trade size (1-50 tokens, max 1% of balance). Uses `WALLET_KEY` env var (base58 private key). Records all trades to `trade_events` for chart display. Alternates directions (NTC→ASDC then ASDC→NTC) to simulate real trading. Includes 429 retry with exponential backoff.
- `priceWatcher.js` — **Price oracle worker** running as "Price Watcher" workflow. Every 60 seconds, fetches on-chain prices for all DB pools and stores to `token_prices` table. See "Internal Price Oracle" section above.
- `tokenFeeWithdraw.js` — Standalone Token-2022 transfer fee withdrawal worker (optional, redundant with feeCollector)
- `liquidityAutomation.js` — Monitors pool liquidity balance, detects imbalances and price deviations (default 5min)
All workers support optional `SQUADS_VAULT_ADDRESS` env var to override vault address.

### Transfer Proposals
Transfer proposals are stored in the `transfer_proposals` table in the database. When a vault transfer is proposed via Squads, the proposal details (token, amount, destination, transaction index, threshold) are saved to DB. The Treasury tab displays all proposals in a list with:
- Status badges: PENDING APPROVAL (purple), READY TO EXECUTE (yellow), EXECUTED (green)
- Per-row Approve and Execute buttons
- Approval count tracking (approvals/threshold)
- Execute signature display after execution
API endpoints: `GET /admin/squads/proposals` (list), `POST /admin/squads/proposals/update-status` (update status/approvals after approve/execute)

### Admin Panel
The admin panel contains sections for treasury visibility, balances, proposal history, fee history, and operational controls intended for authorized project administrators.

### Admin Setup Panel (Web-Based)
The setup flow previously handled by `setup-all.sh` is now available as a web UI in the Admin Panel's "Setup" tab. Each step builds unsigned transactions on the backend, which the admin signs with their wallet in the browser.

**Setup Steps (UI):**
| Step | Endpoint | What it does |
|------|----------|-------------|
| 0 | `POST /admin/programs/register` | Save program IDs to PostgreSQL |
| 1 | `POST /tokens/create/build` + `POST /admin/token/init/confirm` | Mint tokens with wallet signing, save to DB |
| 2 | `POST /admin/vault/init/build` + `POST /admin/vault/init/confirm` | Init 2-of-3 multisig vault, save to DB |
| 3 | `POST /admin/treasury/create-atas/build` + confirm | Create treasury ATAs for all tokens |
| 4 | `POST /admin/policy/init/build` + confirm | Create spending policy proposal |
| 5-6 | Pools + Liquidity tabs | Already existed in UI |

**Database Tables (admin setup):**
- `program_config` — stores program IDs (token_core, referral)
- `tokens` — stores minted token details (replaces minted.tokens.json)
- `multisig_config` — stores vault config (Squads v4)
- `treasury_wallets` — stores treasury ATAs per token
- `pools` — stores created pool pairs (token pair, pool address, fee tier, tick spacing)

**Service:** `api/services/admin-setup.service.js` — encapsulates all setup logic

**Token loading priority:** Database tokens are loaded as a merge/fallback alongside the on-chain registry via `TokensService.loadFromDatabase()`.

**Admin wallet resolution:** on-chain multisig → DB multisig_config → cached result → vault.config.json → empty array

### Network Configuration (Devnet / Mainnet)
A single `SOLANA_NETWORK` env var (default: `mainnet`) controls whether the entire app runs on devnet or mainnet. Centralized in `api/utils/network.js` which exports `isMainnet()`, `isDevnet()`, `getOrcaWhirlpoolsConfig()` (`solanaDevnet`/`solanaMainnet`), `getRpcUrl()` (fails loudly on mainnet if `SOLANA_RPC_URL` not set), `wrapRpcUrl()` and `createNetworkRpc()` (wraps `@solana/kit` devnet()/mainnet()). Frontend uses `VITE_SOLANA_NETWORK` (default: `mainnet`) and optional `VITE_SOLANA_RPC_URL` in `WalletProvider.jsx`. MoonPay environment is driven by `VITE_MOONPAY_ENV` (default: `production`). NOWPayments sandbox mode is driven by `NOWPAYMENTS_SANDBOX` / `VITE_NOWPAYMENTS_SANDBOX` (default: `false`). NTC mint address is fetched from the `tokens` table in the database (looked up by symbol `NTC`). The mainnet readiness check script is at `scripts/check-mainnet-ready.sh`. `contract/Anchor.toml` has `[programs.mainnet]` section with placeholder program IDs.

### Token Creation Flow
`contract/scripts/init-tokens.js` is the single entry point for creating tokens. It handles everything in one script:
- Initializes the on-chain registry PDA if it doesn't exist yet (one-time)
- Uploads logo and metadata to Irys/Arweave
- Creates Token-2022 mints with 0.05% TransferFeeConfig
- Registers each new mint in the on-chain registry
- Skips tokens already in `minted.tokens.json` (safe to re-run)
- To add a new token: add it to the TOKENS array, place logo in `assets/`, and run the script
- To re-mint everything from scratch: delete `minted.tokens.json` and run again

### Predefined Tokens (12 total)
The platform has 12 predefined tokens defined across multiple files:
1. NTC (Nite Treasury Currency) — 120T supply, base token
2. ASDC (America States Digital Currency) — 5T supply
3. EDC (Euro Digital Currency) — 5T supply
4. RDC (Brazil Digital Currency) — 5T supply
5. YDC (Yuan Digital Currency) — 5T supply
6. SDC (Swiss Digital Currency) — 5T supply
7. CDC (Canadian Digital Currency) — 5T supply
8. ADC (Australian Digital Currency) — 5T supply
9. SGDC (Singapore Digital Currency) — 5T supply
10. DMC (Dome Coin) — 5T supply
11. BDC (British Digital Currency) — 5T supply

Token lists are defined in: `api/services/admin-setup.service.js` (PREDEFINED_TOKENS), `frontend/src/pages/Admin.jsx` (Step 3 UI), `frontend/src/data/tokens.js` (TOKENS), `contract/scripts/init-tokens.js` (TOKENS), `contract/scripts/init-pools.ts` (PAIRS), `api/services/overview.service.js` (ALLOWED_TOKENS), `api/services/admin.service.js` (ALLOWED_TOKENS), `api/db/seed-analytics.js` (ALL_TOKENS), `frontend/src/translations/index.js` (all 9 languages).

### RPC Rate Limit Optimizations
To reduce 429 rate limit errors on Solana RPC (QuickNode/Alchemy):
- **Orca Monitor disabled by default** (`ENABLE_MONITOR=false`) — the `onLogs` WebSocket subscription consumes constant RPC quota
- **Price Watcher** interval set to 1 day (86400000ms) by default (configurable via `PRICE_WATCH_INTERVAL_MS`), with 2s delays between pool queries
- **Fee Collector** interval set to 1 day (86400000ms) by default (configurable via `FEE_COLLECT_INTERVAL_MS`)
- **Swap quotes are fully real-time** — no caching or DB storage; every quote call hits the Orca pool on-chain via Helius RPC (~0.5s per call)
- **DB pool lookup first** — swap quotes use pool addresses from the `pools` DB table directly, skipping the heavy `getProgramAccounts` RPC call; falls back to Orca SDK scan only if DB lookup fails
- **429 retry with backoff** on `/quote` and `/pools` endpoints (3 attempts, 2s/4s delays)

## Real-Time SSE Infrastructure
The app uses Server-Sent Events (SSE) for real-time updates across all pages.

**Backend flow:** Mutations (token registration, pool creation, treasury actions, admin config) call `cacheService.publishXxxUpdate()` which publishes to Redis pub/sub channels. The SSE broadcaster in `api/index.js` subscribes to all channels and pushes events to connected browser clients.

**Channels:** `trades:all`, `fees:collected`, `treasury:update`, `tokens:update`, `pools:update`, `admin:update`, `balances:update`, `prices:update`

**Frontend flow:** Shared `EventSource` singleton in `useChartData.js` (`_sharedES`). `useTradeStream` provides raw event listener. `useSSEEvent(channel, cb)` filters by channel. `useSSERefresh(channel, refreshFn, debounceMs)` auto-calls a refresh function with debounce on SSE events.

**`/send` endpoint base channels:** Every confirmed transaction through `/api/send` automatically publishes `balances:update` and `prices:update` SSE events, plus any additional channels specified in `updateChannels`. This ensures all pages refresh after any user action (swap, liquidity, pool creation, etc.).

**Auto-refreshing stores/pages:**
- `useTokenListStore` → refreshes on `tokens:update`
- `useTokenPriceStore` → refreshes on `prices:update` and `pools:update`
- `useAdminStore` → refreshes owner list on `admin:update`
- `Admin.jsx` → refreshes setup status, treasury data, and full pool data (loadFullPoolData) on relevant channels; also calls loadFullPoolData directly after pool mutations; sends `tradeMeta` for all actions (pool_created, add_liquidity, remove_liquidity, fee_collection) so `trades:all` fires
- `Swap.jsx` → passes `updateChannels` to `/send`; subscribes to `balances:update` for SOL balance refresh; subscribes to `pools:update` for pool reserves auto-refresh
- `Assets.jsx` → subscribes to `balances:update` for SOL + token balance refresh
- `Markets/Dashboard/Saved` → auto-refresh prices via `useTokenPriceStore`; auto-refresh stats (volume, changes) via `useTokenStats` listening to `trades:all` trade stream

**SSE heartbeat:** `:heartbeat` comment frames every 15 seconds. Frontend reconnects after 3 seconds on error.

## Technical Notes
- Frontend: React, Vite, React Router, Recharts
- Solana integration libraries are used for blockchain interaction
- Backend exposes build-style endpoints for preparing unsigned transactions
- PostgreSQL stores event history
- Redis is used for cache and event streaming

## External Dependencies

### Frontend
- react
- react-dom
- react-router-dom
- recharts
- zustand
- @tanstack/react-query
- Solana wallet adapter packages
- @solana/web3.js

### Backend
- fastify (with @fastify/cors, @fastify/compress, @fastify/static, @fastify/multipart)
- @solana/web3.js
- @solana/spl-token
- @solana/spl-token-metadata
- @coral-xyz/anchor
- @orca-so/whirlpools
- @sqds/multisig
- postgres
- ioredis
- dotenv

## Data Stores
- PostgreSQL (Neon hosted) for application event history and admin config
  - Connection via `NEON_DATABASE_URL` in `api/.env`
  - Priority: `NEON_DATABASE_URL` > `SUPABASE_DATABASE_URL` > `DATABASE_URL`
- Redis (local, redis://127.0.0.1:6379) for caching and pub/sub

## Deployed Contracts (Devnet)
- Token Core: `Caj7KuQbjBddCSZiRX838PJL5rnEMThNFWB2cdXL2DS2`
  - 11 Token-2022 mints with 0.05% TransferFeeConfig
  - Tokens: NTC, ASDC, EDC, RDC, YDC, SDC, CDC, ADC, SGDC, DMC, BDC
- Treasury Multisig: `2ZAsE4P1c8hifGbkn3NjfGj3ZiPfmPGZ6AZzrFLigUxT`
- Referral Program: `7jL7DgmigNMLjTjqmKG2wRSFqFtNs7QUGybepdcUQcN7`

### DB-First Config System
All program IDs, mints, and config are managed from the Admin Panel UI and stored in PostgreSQL. The `.env` file only contains infrastructure secrets.

**`api/.env` (5 vars only):**
- `SOLANA_RPC_URL` — Solana RPC endpoint
- `WALLET_KEY` — server wallet private key (base58 encoded, set in api/.env)
- `TOKEN_REGISTRY_SEED` — on-chain registry seed
- `REDIS_URL` — Redis connection string (local: redis://127.0.0.1:6379)
- `NEON_DATABASE_URL` — PostgreSQL connection string (Neon hosted)

**Frontend mint addresses:** Fetched at runtime from `GET /api/tokens` (blockchain on-chain registry). No `VITE_*_MINT` env vars needed. The `frontend/src/data/mints.js` module calls `initMints()` on app startup with retry logic, and `getMint(tokenId)` returns cached mint addresses synchronously.

**Single source of truth (PostgreSQL):**
- Program IDs → `program_config` table (set via Admin Panel Step 0)
- Multisig owners → `multisig_owners` table (set via Admin Panel Step 1)
- Vault config → `multisig_config` table (saved on multisig creation, Step 2)
- Mint addresses + Treasury ATAs → `tokens` + `treasury_wallets` tables (set via Admin Panel Step 3, token init also saves treasury ATA)
- Pools → `pools` table (saved on pool creation via Admin Panel)

**Boot sequence:** Backend loads program IDs from `program_config` table at startup. Treasury vault PDA is read from `multisig_config` (Squads v4) and used as `treasuryPubkey` for all token ATA derivation and balance lookups. The wallet keypair is only used for signing transactions, not as the treasury owner. If IDs are missing (fresh DB), services start in degraded mode and get initialized when admin saves config via the Setup panel.

**Live updates:** When program IDs are saved via Admin Panel, the running `TreasuryService` is re-initialized with the new ID via `updateProgramId()`.

- Admin/owner wallets (backend) → read from on-chain multisig state via `getAdminWallets()`, cached 5 min
- Admin/owner wallets (frontend) → fetched from `GET /treasury/multisig` endpoint via `useAdminStore.js` (Zustand)

**After deploying new programs:** Clear all DB tables, then use Admin Panel Setup tab to configure program IDs, set multisig owners, create Squads multisig, initialize tokens (mints to vault + saves treasury ATAs), and set spending policies.

### Setup Flow (Ordered)
All setup scripts are in `contract/scripts/`. Run them in order. Each is idempotent (safe to re-run).

**Master script:** `contract/scripts/setup-all.sh`
- Runs all steps in order with endpoint verification after each step
- Auto-syncs `api/.env` after steps 1, 2, and 4 via `sync-env.js`
- Flags: `--skip-tokens`, `--skip-atas`, `--skip-pools`, `--skip-liquidity`, `--verify-only`
- Usage: `cd contract && bash scripts/setup-all.sh`

| Step | Script | What it does | Depends on | Verify endpoint |
|------|--------|-------------|------------|-----------------|
| 1 | `init-tokens.js` | Creates registry PDA, mints Token-2022 tokens, registers in registry | Deployed token-core contract | `GET /tokens` |
| 2 | `create-treasury-atas.js` | Creates a token wallet (ATA) per digital currency under the treasury | Step 1 + Squads vault | `GET /treasury/balances` |
| 3 | `init-pools.ts` | Creates Orca Whirlpool liquidity pools | Step 1 (tokens must exist) | `GET /pools` |
| 4 | `init-liquidity.js` | Adds initial liquidity to pools | Step 3 (pools must exist) | `GET /treasury/balances` |

### IDL Files
- `contract/target/idl/token_core_contracts.json` — Token Core program IDL (2 instructions: initialize_registry, register_mint)

### Treasury Multisig (Squads v4)
- All multisig operations use Squads Protocol v4 (`SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu`)
- Owners: configured via Admin Panel Step 2, Threshold: 2-of-3
- Config saved to: `multisig_config` DB table

## Known Constraints
- The Referral Program IDL file is not present in the workspace. The referral service starts in disabled mode and logs a warning at boot. To enable, run `anchor build` for the referral program and copy its IDL.
- CoinGecko API calls are proxied through the backend at `/coingecko/...` to avoid CORS issues. CoinGecko free tier has aggressive rate limiting (429 errors are expected under load).
- The token-core contract only exposes two instructions: `initialize_registry` and `register_mint`. All other instructions were removed as dead code. Dependencies `mpl-token-metadata` and `common-contracts` were also removed from token-core.
- `init-registry.js` and `register-mints.js` were removed — `init-tokens.js` handles registry init and mint registration internally.

## Mobile Responsive Design
The frontend is fully responsive across all device sizes with three breakpoint tiers:
- **1024px**: Grid columns reduce (3→2)
- **900px**: Mobile navigation activates — hamburger menu, sidebar drawer overlay, bottom tab navigation bar, nav-links hidden
- **768px**: Mobile layout — single-column layouts, horizontal-scroll tables, full-screen modals, 44px touch targets
- **480px**: Extra-small adjustments — single-column stats grids, smaller fonts, full-screen modals

**Key mobile components:**
- `MobileNav.jsx` — Fixed bottom tab bar (Dashboard, Exchange, Markets, Assets, Settings) visible at ≤900px
- `TopNav.jsx` — Hamburger button toggles sidebar drawer on mobile
- `Sidebar.jsx` — Converts to slide-out drawer with dark overlay at ≤900px (both mobile and tablet)

**CSS architecture:** All mobile responsive styles are appended at the end of `styles.css` after the comment `/* MOBILE RESPONSIVE */`. The existing 900px breakpoint handles tablet layout. The 768px breakpoint handles mobile navigation and layout. The 480px breakpoint handles extra-small screens.

## Production Deployment
- **Build**: `cd frontend && npm install && npm run build` — builds the React frontend to `frontend/dist/`
- **Run**: `bash scripts/start-production.sh` — starts the backend API (port from `$PORT` env, default 5000), Fee Collector worker, and Price Watcher worker in parallel
- **Static serving**: In production (when `frontend/dist/` exists), the backend serves built frontend assets at `/` and provides SPA fallback (serves `index.html` for non-API GET requests)
- **URL rewriting**: The backend's `rewriteUrl` option strips the `/api/` prefix for routes that don't natively use it (legacy routes like `/tokens`, `/pools`, `/swap/build`, etc.), while preserving routes that natively start with `/api/` (`/api/reposts`, `/api/feed`, `/api/search`). This mirrors what the Vite dev proxy does in development
- **Deployment target**: `autoscale` via Replit deployment
- **Port mapping**: In production, the backend serves everything (API + static frontend) on a single port

### Community/Networks Feature
The Community page (`frontend/src/pages/Community.jsx`) is a fully functional social hub:
- **Create Profile**: When a wallet is connected but no profile exists, a banner prompts the user to create one. Profile creation includes GDPR consent notice.
- **Create Post**: Users with profiles see a "Create Post" button that opens a modal to publish blog or video posts. New posts are prepended to the feed immediately.
- **Feed**: Auto-refreshes every 60 seconds with manual refresh button. Supports sorting (New, Top, Hot), voting, sharing/reposting.
- **GDPR Compliance**: Consent notice before profile creation. Data export endpoint (`GET /api/profiles/:username/export`) returns all user data as JSON. Data deletion endpoint (`DELETE /api/profiles/:username/data`) removes all user content. Privacy & Data section on profile page for owners.
- **Profile page** (`frontend/src/pages/Profile.jsx`): Includes Privacy & Data section for profile owners with export and delete functionality.
- **API endpoints**: `GET /api/profiles/me` (lookup profile by wallet), `GET /api/profiles/:username/export` (wallet signature via x-wallet-signature header), `DELETE /api/profiles/:username/data` (wallet signature in request body)

## Development Guidance
- Keep changes modular
- Preserve current architecture unless asked
- Prefer minimal, reversible edits
- Ask before changing critical project behavior