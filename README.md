# Solana DEX & Token Ecosystem (`solana-swap`)

An end-to-end, high-performance **Solana Decentralized Exchange (DEX), Token Launchpad, Squads v4 Governance, and Automated Liquidity System**.

This repository contains the complete full-stack infrastructure including on-chain Anchor Rust smart contracts, a TypeScript Swap SDK, a Fastify microservice API with PostgreSQL and Redis, background automation workers, and a React frontend.

---

##  Architecture & Core Components

```
                ┌─────────────────────────────────────────┐
                │          Frontend (React + Vite)        │
                └────────────────────┬────────────────────┘
                                     │
                                     ▼
                ┌─────────────────────────────────────────┐
                │     Fastify REST API (api/index.js)     │
                ├────────────────────┬────────────────────┤
                │ PostgreSQL (DB)    │ Redis (Cache)      │
                └────────────────────┼────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  Solana Swap SDK │       │ Anchor Contract  │       │ Background Cron  │
│    (src/index.ts)│       │ (contract/)      │       │ Workers (worker/)│
└────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
         │                          │                          │
         └──────────────────────────┼──────────────────────────┘
                                    ▼
                         Solana Blockchain Cluster
```

### 1. **Core SDK (`src/`)**
* **TypeScript SDK (`SolanaTracker`)**: Constructs versioned transactions (`v0`) using Address Lookup Tables (ALTs).
* **Network & RPC Layer**: Configurable priority fees (`min`, `low`, `medium`, `high`, `veryHigh`, `unsafeMax`), custom RPC send endpoints, and WebSocket signature confirmation waiters ([`src/lib/sender.ts`](file:///Users/majedurrahman/solana/src/lib/sender.ts)).
* **MEV & Bundles**: Support for Jito bundle submission ([`src/lib/jito.ts`](file:///Users/majedurrahman/solana/src/lib/jito.ts)).

### 2. **Fastify Backend API (`api/`)**
* **Server**: High-throughput REST API server ([`api/index.js`](file:///Users/majedurrahman/solana/api/index.js)) built on Fastify.
* **Services (`api/services/`)**:
  * `swap.service.js`: Swap quotes, routing optimization, and `minimumAmountOut` calculations.
  * `token-creation.service.js`: SPL Token & Token-2022 mint creation, metadata pointers, and logo uploads via Irys / Arweave.
  * `squads.service.js`: Multi-signature treasury governance, proposal creation, and execution using `@sqds/multisig` (Squads v4).
  * `pool.service.js` & `liquidity.service.js`: Interacts with Orca Whirlpools and Raydium liquidity pools.
  * `price.service.js` & `metrics.service.js`: DEX token price feeds and real-time system metrics.
  * `referral-db.service.js`: Multi-tier referral tracking and automated reward disbursements.
  * `nowpayments.service.js`: On-ramp crypto purchase processor.
* **Database (`api/db/`)**: PostgreSQL schema ([`api/db/schema.sql`](file:///Users/majedurrahman/solana/api/db/schema.sql)) managing trade events, OHLCV candles, token registry, pools, multisig configs, referral program, and user wallets.

### 3. **Solana Smart Contracts (`contract/`)**
* **Anchor Program (`contract/programs/token-core-contracts`)**: On-chain Rust program (`GdWoikJDEhSmFMSPLZZAjnPFr67XtRni5KcyP3BCg5DV`) initializing and managing the `TokenRegistry` PDA (`[b"token_registry"]`).
* **Common Crate (`contract/crates/common-contracts`)**: Shared Rust modules for checked math arithmetic, program constraints, and error handling.
* **Security & Lints**: Enforces strict `#![deny(clippy::unwrap_used)]` and `#![deny(unsafe_code)]` directives.

### 4. **Background Workers (`worker/`)**
* `priceWatcher.js`: Monitors real-time DEX transactions and updates PostgreSQL `chart_candles` (OHLCV metrics: 1m, 5m, 1h, 1d).
* `feeCollector.js`: Tracks accumulated protocol and swap fees across mints.
* `tokenFeeWithdraw.js`: Sweeps harvested fee tokens to the designated protocol Treasury ATA.
* `liquidityAutomation.js`: Automated liquidity rebalancing across Orca tick ranges.
* `tradeBotCron.js`: Executes scheduled programmatic trading routines.

### 5. **Frontend Application (`frontend/`)**
* **Tech Stack**: React 18, Vite, Tailwind CSS, Reown AppKit (`@reown/appkit-adapter-solana`).
* **Features**: Swap terminal, token launchpad, DEX market charts, Squads v4 multisig dashboard, token purchase flow, and admin governance portal.

---

##  Repository Directory Structure

```
.
├── api/                    # Fastify REST API backend, routes, services, and DB schema
│   ├── controllers/        # API controllers
│   ├── db/                 # PostgreSQL schema.sql, init.js, seed files
│   ├── routes/             # Network posts & oracle route definitions
│   ├── services/           # 18+ backend services (swap, trade, squads, tokens, etc.)
│   └── index.js            # Main Fastify server entry point
├── contract/               # Solana Anchor Rust Smart Contracts
│   ├── crates/             # Shared Rust helper crates (common-contracts)
│   └── programs/           # Main Anchor programs (token-core-contracts)
├── deploy/                 # Production deployment manifests and Docker assets
├── frontend/               # React SPA built with Vite and Reown AppKit
├── nginx/                  # Nginx reverse proxy configuration
├── scripts/                # Build and deployment shell scripts
├── src/                    # Core TypeScript Solana Tracker Swap SDK
│   ├── lib/                # Jito bundle and RPC transaction sender modules
│   └── index.ts            # SolanaTracker main SDK class
├── worker/                 # Asynchronous background cron workers
│   ├── feeCollector.js     # Protocol fee collector
│   ├── liquidityAutomation.js # Automated liquidity pool manager
│   ├── priceWatcher.js     # OHLCV candle aggregator worker
│   ├── tokenFeeWithdraw.js # Treasury fee sweep worker
│   └── tradeBotCron.js     # Algorithmic trade bot worker
├── docker-compose.yml      # Development Docker Compose file
├── docker-compose.prod.yml # Production Docker Compose overrides
├── Dockerfile.backend      # Backend API container definition
└── package.json            # Main workspace dependencies and npm scripts
```

---

##  Getting Started

### Prerequisites
- **Node.js**: `v18+` or `v20+`
- **Docker & Docker Compose**: For PostgreSQL and Redis services
- **Rust & Anchor CLI**: (Optional, for smart contract compilation)

### 1. Environment Setup
Copy the example environment configuration in `api/`:
```bash
cp api/.env.example api/.env
```

Key environment variables:
- `SOLANA_RPC_URL`: Mainnet/Devnet Solana RPC endpoint
- `DATABASE_URL`: PostgreSQL connection string (`postgresql://postgres:postgres@localhost:5432/solana_dex`)
- `REDIS_URL`: Redis connection string (`redis://localhost:6379`)
- `ADMIN_WALLET_KEY`: Base58 private key for admin operations

### 2. Run with Docker (Recommended)
Start database, cache, backend API, and worker services:
```bash
# Start development stack
npm run docker:dev

# Stop stack
npm run docker:stop
```

### 3. Local Development (Step-by-Step)

```bash
# Install root dependencies
npm install

# Build the SDK
npm run build

# Start the Fastify API server
npm run start:dev

# Start background price watcher / fee collector workers (separate terminal)
npm run start:worker

# Build and run the Frontend
npm run build:frontend
```

---

## ⚡ Available NPM Scripts

| Command | Description |
|---|---|
| `npm run build` | Builds the TypeScript SDK (`dist/cjs`, `dist/esm`, `dist/umd`, `dist/types`) |
| `npm run start:dev` | Runs Fastify API server with nodemon |
| `npm run start:api` | Runs Fastify API server in production mode |
| `npm run start:worker` | Launches background fee collector worker |
| `npm run build:frontend` | Installs frontend dependencies and builds Vite web app |
| `npm run docker:dev` | Spins up Docker Compose development container stack |
| `npm run docker:prod` | Launches production Docker Compose stack |
| `npm run docker:stop` | Shuts down Docker Compose containers |

---

##  Security & Governance

- **Squads v4 Multisig**: All administrative functions (swap limits, buy token pricing, referral reward rates, treasury sweeps) are controlled via 2-of-3 multi-signature proposals.
- **On-Chain Rust Safety**: Smart contracts enforce strict memory safety with `#![deny(clippy::unwrap_used)]`, `#![deny(unsafe_code)]`, and checked math functions (`checked_add`/`checked_sub`).

---

##  License
ISC License.
