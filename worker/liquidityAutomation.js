'use strict';

const path = require('path');

require('dotenv').config({ path: path.resolve(process.cwd(), 'api/.env') });
if (!process.env.SOLANA_RPC_URL) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
}

const { Connection } = require('@solana/web3.js');
const { initDatabase, query: dbQuery, shutdown: dbShutdown } = require('../api/db/init');
const { CacheService } = require('../api/services/cache.service');
const { PoolService } = require('../api/services/pool.service');
const { TreasuryService } = require('../api/services/treasury.service');

const INTERVAL_MS = Number(process.env.LIQUIDITY_CHECK_INTERVAL_MS || 300000);
const { getRpcUrl } = require('../api/utils/network');
const RPC_URL = getRpcUrl();
const COMMITMENT = process.env.SOLANA_COMMITMENT || 'confirmed';
const PRICE_DEVIATION_THRESHOLD = Number(process.env.PRICE_DEVIATION_THRESHOLD || 5) / 100;
const IMBALANCE_THRESHOLD = Number(process.env.IMBALANCE_THRESHOLD || 20) / 100;
const SQUADS_VAULT_ADDRESS = process.env.SQUADS_VAULT_ADDRESS || null;

let running = true;
let timer = null;
let cache = null;
let poolService = null;
let treasuryService = null;

async function resolveVaultFromDb() {
  try {
    if (process.env.SQUADS_VAULT_ADDRESS) {
      return process.env.SQUADS_VAULT_ADDRESS;
    }
    const result = await dbQuery(
      `SELECT treasury_authority_pda, multisig_pda FROM multisig_config ORDER BY id DESC LIMIT 1`
    );
    if (result.rows.length > 0 && result.rows[0].treasury_authority_pda) {
      return result.rows[0].treasury_authority_pda;
    }
    return null;
  } catch (e) {
    console.warn('[LiquidityAutomation] Could not resolve vault from DB:', e.message);
    return null;
  }
}

async function getActivePools() {
  try {
    const { query } = require('../api/db/init');
    const result = await query(
      'SELECT token_a_symbol, token_b_symbol, token_a_mint, token_b_mint, pool_address FROM pools ORDER BY created_at DESC',
      [],
    );
    return result.rows || [];
  } catch (e) {
    console.warn('[LiquidityAutomation] Could not fetch pools from DB:', e.message);
    return [];
  }
}

function detectImbalance(reserves) {
  const amountA = Number(reserves.tokenA.uiAmount || 0);
  const amountB = Number(reserves.tokenB.uiAmount || 0);

  if (amountA === 0 && amountB === 0) return null;

  const total = amountA + amountB;
  if (total === 0) return null;

  const ratioA = amountA / total;
  const ratioB = amountB / total;
  const deviation = Math.abs(ratioA - ratioB);

  if (deviation > IMBALANCE_THRESHOLD) {
    return {
      type: 'liquidity_imbalance',
      ratioA: (ratioA * 100).toFixed(2),
      ratioB: (ratioB * 100).toFixed(2),
      deviation: (deviation * 100).toFixed(2),
      threshold: (IMBALANCE_THRESHOLD * 100).toFixed(2),
      amountA,
      amountB,
    };
  }

  return null;
}

function detectPriceDeviation(currentPrice, expectedPrice) {
  if (!expectedPrice || expectedPrice === 0 || !currentPrice) return null;

  const deviation = Math.abs(currentPrice - expectedPrice) / expectedPrice;

  if (deviation > PRICE_DEVIATION_THRESHOLD) {
    return {
      type: 'price_deviation',
      currentPrice,
      expectedPrice,
      deviation: (deviation * 100).toFixed(2),
      threshold: (PRICE_DEVIATION_THRESHOLD * 100).toFixed(2),
    };
  }

  return null;
}

async function runCycle() {
  const cycleStart = Date.now();
  console.log(`\n[LiquidityAutomation] === Monitor cycle started at ${new Date().toISOString()} ===`);
  console.log(`[LiquidityAutomation] Price deviation threshold: ${(PRICE_DEVIATION_THRESHOLD * 100).toFixed(1)}%`);
  console.log(`[LiquidityAutomation] Imbalance threshold: ${(IMBALANCE_THRESHOLD * 100).toFixed(1)}%`);

  if (SQUADS_VAULT_ADDRESS) {
    console.log(`[LiquidityAutomation] Squads vault configured: ${SQUADS_VAULT_ADDRESS}`);
  }

  const pools = await getActivePools();
  if (pools.length === 0) {
    console.log('[LiquidityAutomation] No active pools found — skipping cycle');
    return;
  }

  console.log(`[LiquidityAutomation] Checking ${pools.length} pool(s)...`);

  let imbalancesDetected = 0;
  let priceDeviationsDetected = 0;
  let errorsCount = 0;

  for (const pool of pools) {
    const pairLabel = `${pool.token_a_symbol}/${pool.token_b_symbol}`;
    try {
      let poolData;
      if (pool.pool_address && poolService.getPoolByAddress) {
        poolData = await poolService.getPoolByAddress(pool.pool_address);
      } else {
        poolData = await poolService.getPool({
          tokenA: pool.token_a_mint || pool.token_a_symbol,
          tokenB: pool.token_b_mint || pool.token_b_symbol,
        });
      }

      if (!poolData.ok) {
        console.warn(`[LiquidityAutomation] Pool ${pairLabel} (${pool.pool_address || 'searching'}): ${poolData.error}`);
        errorsCount++;
        continue;
      }

      const imbalance = detectImbalance(poolData.reserves);
      if (imbalance) {
        imbalancesDetected++;
        console.warn(`[LiquidityAutomation] IMBALANCE DETECTED in ${pairLabel}:`);
        console.warn(`  Token A ratio: ${imbalance.ratioA}%, Token B ratio: ${imbalance.ratioB}%`);
        console.warn(`  Deviation: ${imbalance.deviation}% (threshold: ${imbalance.threshold}%)`);
        console.warn(`  Amounts: A=${imbalance.amountA}, B=${imbalance.amountB}`);
      }

      const priceDeviation = detectPriceDeviation(poolData.price, 1.0);
      if (priceDeviation) {
        priceDeviationsDetected++;
        console.warn(`[LiquidityAutomation] PRICE DEVIATION in ${pairLabel}:`);
        console.warn(`  Current: ${priceDeviation.currentPrice}, Expected: ${priceDeviation.expectedPrice}`);
        console.warn(`  Deviation: ${priceDeviation.deviation}% (threshold: ${priceDeviation.threshold}%)`);
      }

      if (!imbalance && !priceDeviation) {
        console.log(`[LiquidityAutomation] Pool ${pairLabel}: OK (price=${poolData.price?.toFixed(6) || 'N/A'})`);
      }
    } catch (e) {
      console.error(`[LiquidityAutomation] Error checking pool ${pairLabel}:`, e.message);
      errorsCount++;
    }
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
  console.log(`[LiquidityAutomation] === Cycle complete in ${elapsed}s ===`);
  console.log(`[LiquidityAutomation]   Pools checked: ${pools.length}`);
  console.log(`[LiquidityAutomation]   Imbalances: ${imbalancesDetected}`);
  console.log(`[LiquidityAutomation]   Price deviations: ${priceDeviationsDetected}`);
  console.log(`[LiquidityAutomation]   Errors: ${errorsCount}`);
}

async function main() {
  console.log('[LiquidityAutomation] Starting liquidity automation worker...');
  console.log(`[LiquidityAutomation] Interval: ${INTERVAL_MS}ms (${(INTERVAL_MS / 60000).toFixed(1)} min)`);
  console.log(`[LiquidityAutomation] RPC: ${RPC_URL}`);

  const dbOk = await initDatabase();
  if (!dbOk) {
    console.error('[LiquidityAutomation] Database init failed — exiting');
    process.exit(1);
  }

  cache = new CacheService();
  await cache.init();

  const connection = new Connection(RPC_URL, COMMITMENT);

  const vaultAddress = await resolveVaultFromDb();

  let tokensService = null;
  try {
    const { TokensService } = require('../api/services/tokens.service');
    tokensService = new TokensService({
      connection,
      treasuryPubkey: vaultAddress || 'unknown',
    });
    if (tokensService.loadFromDatabase) {
      await tokensService.loadFromDatabase();
    } else if (tokensService.loadFromRegistry) {
      await tokensService.loadFromRegistry();
    }
    console.log(`[LiquidityAutomation] Tokens loaded: ${tokensService.listTokens().length}`);
  } catch (e) {
    console.warn('[LiquidityAutomation] Could not load TokensService:', e.message);
  }

  poolService = new PoolService({ connection, tokensService });

  treasuryService = new TreasuryService({
    connection,
    cacheService: cache,
    tokensService,
  });

  if (vaultAddress && treasuryService.setSquadsVault) {
    treasuryService.setSquadsVault(vaultAddress);
    console.log(`[LiquidityAutomation] Treasury using vault from DB/Env: ${vaultAddress}`);
  } else {
    console.warn('[LiquidityAutomation] No vault address found — some features may be limited');
  }

  await runCycle();

  if (running) {
    timer = setInterval(async () => {
      if (!running) return;
      try {
        await runCycle();
      } catch (e) {
        console.error('[LiquidityAutomation] Cycle error:', e.message);
      }
    }, INTERVAL_MS);
  }
}

async function shutdown(signal) {
  console.log(`\n[LiquidityAutomation] Received ${signal} — shutting down gracefully...`);
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (cache) {
    await cache.shutdown();
  }
  await dbShutdown();
  console.log('[LiquidityAutomation] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((e) => {
  console.error('[LiquidityAutomation] Fatal error:', e.stack || e.message);
  process.exit(1);
});
