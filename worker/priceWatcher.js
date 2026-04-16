'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(process.cwd(), 'api/.env') });
if (!process.env.SOLANA_RPC_URL) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
}

const { Connection } = require('@solana/web3.js');
const { initDatabase, query: dbQuery, shutdown: dbShutdown } = require('../api/db/init');
const { CacheService } = require('../api/services/cache.service');
const { PriceService } = require('../api/services/price.service');
const { PoolService } = require('../api/services/pool.service');

const INTERVAL_MS = Number(process.env.PRICE_WATCH_INTERVAL_MS || 86400000);
const { getRpcUrl } = require('../api/utils/network');
const RPC_URL = getRpcUrl();
const COMMITMENT = process.env.SOLANA_COMMITMENT || 'confirmed';
const PRUNE_INTERVAL_CYCLES = 1440;

let running = true;
let timer = null;
let cache = null;
let priceService = null;
let poolService = null;
let cycleCount = 0;
let lastSwapSnapshotTime = null;

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
    console.warn('[PriceWatcher] Could not resolve vault from DB:', e.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, label, maxRetries = 3) {
  let delay = 4000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e.message || '';
      const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('rate limit');
      const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT');

      if ((is429 || isTimeout) && attempt < maxRetries) {
        const jitter = Math.random() * 1000;
        console.log(`[PriceWatcher] Retry ${attempt}/${maxRetries} for ${label} after ${Math.round(delay + jitter)}ms (${is429 ? '429' : 'timeout'})`);
        await sleep(delay + jitter);
        delay *= 2;
        continue;
      }
      throw e;
    }
  }
}

async function loadPoolsFromDb() {
  try {
    const result = await dbQuery('SELECT * FROM pools ORDER BY id');
    return result.rows || [];
  } catch (e) {
    console.warn('[PriceWatcher] Could not load pools from DB:', e.message);
    return [];
  }
}

async function snapshotSwapPrices() {
  try {
    const recentSwaps = await priceService.getRecentSwapPrices(50);
    let saved = 0;

    for (const swap of recentSwaps) {
      if (lastSwapSnapshotTime && new Date(swap.created_at) <= lastSwapSnapshotTime) {
        continue;
      }

      const amountIn = parseFloat(swap.amount_in);
      const amountOut = parseFloat(swap.amount_out);
      if (amountIn <= 0 || amountOut <= 0) continue;

      const swapPrice = amountOut / amountIn;
      if (swapPrice <= 0 || !isFinite(swapPrice)) continue;

      await priceService.savePrice({
        tokenSymbol: swap.token_a_symbol,
        tokenMint: swap.token_a_mint || '',
        pairSymbol: swap.token_b_symbol,
        pairMint: swap.token_b_mint || '',
        poolAddress: swap.pool_address || '',
        price: swapPrice,
        liquidity: '0',
        source: 'swap',
        volume: amountIn,
      });
      saved++;
    }

    if (recentSwaps.length > 0) {
      lastSwapSnapshotTime = new Date(recentSwaps[0].created_at);
    }

    return saved;
  } catch (e) {
    console.warn('[PriceWatcher] Swap snapshot error:', e.message);
    return 0;
  }
}

async function runCycle() {
  if (cache?.enabled) {
    try {
      const flag = await cache.get('fee_collector:pool_harvest');
      if (flag && flag.active) {
        console.log(`[PriceWatcher] Skipping cycle — Fee Collector is harvesting pool fees`);
        return;
      }
    } catch (_) {}
  }

  const cycleStart = Date.now();
  cycleCount++;
  console.log(`[PriceWatcher] === Price cycle #${cycleCount} at ${new Date().toISOString()} ===`);

  const pools = await loadPoolsFromDb();
  if (pools.length === 0) {
    console.log('[PriceWatcher] No pools configured — skipping pool prices');
  }

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    if (i > 0) await sleep(2000);
    try {
      const priceData = await retryWithBackoff(
        () => poolService.getPoolPrice(pool.pool_address, 5, 5),
        `pool ${pool.pool_address.slice(0, 8)}...`
      );

      if (!priceData || !priceData.ok || !priceData.price || priceData.price <= 0) {
        continue;
      }

      const volume = await priceService.get24hVolume(pool.token_a_symbol);

      await priceService.savePrice({
        tokenSymbol: pool.token_a_symbol,
        tokenMint: pool.token_a_mint || '',
        pairSymbol: pool.token_b_symbol,
        pairMint: pool.token_b_mint || '',
        poolAddress: pool.pool_address,
        price: priceData.price,
        liquidity: priceData.liquidity || '0',
        source: 'pool',
        volume: volume,
      });

      if (priceData.price > 0) {
        const inversePrice = 1 / priceData.price;
        const inverseVolume = await priceService.get24hVolume(pool.token_b_symbol);
        await priceService.savePrice({
          tokenSymbol: pool.token_b_symbol,
          tokenMint: pool.token_b_mint || '',
          pairSymbol: pool.token_a_symbol,
          pairMint: pool.token_a_mint || '',
          poolAddress: pool.pool_address,
          price: inversePrice,
          liquidity: priceData.liquidity || '0',
          source: 'pool',
          volume: inverseVolume,
        });
      }

      updated++;
    } catch (e) {
      errors++;
      console.warn(`[PriceWatcher] Error fetching price for pool ${pool.pool_address}:`, e.message);
    }
  }

  const swapsSaved = await snapshotSwapPrices();

  if (cycleCount % PRUNE_INTERVAL_CYCLES === 0) {
    try {
      const pruned = await priceService.pruneOldPrices(400);
      if (pruned > 0) console.log(`[PriceWatcher] Pruned ${pruned} old price records`);
    } catch (e) {
      console.warn('[PriceWatcher] Prune error:', e.message);
    }
  }

  const matchedOrders = await matchLimitOrders();

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
  console.log(`[PriceWatcher] Cycle #${cycleCount} done in ${elapsed}s: ${updated} pools updated, ${swapsSaved} swap prices saved, ${matchedOrders} limit orders matched, ${errors} errors`);
}

async function matchLimitOrders() {
  let matched = 0;
  try {
    const openOrders = await dbQuery("SELECT * FROM limit_orders WHERE status = 'open' ORDER BY created_at ASC LIMIT 100");
    if (!openOrders.rows || openOrders.rows.length === 0) return 0;

    for (const order of openOrders.rows) {
      try {
        const currentPrice = await getCurrentPrice(order.sell_token, order.buy_token);
        if (!currentPrice || currentPrice <= 0) continue;

        let shouldFill = false;
        if (order.side === 'buy') {
          shouldFill = currentPrice <= order.target_price;
        } else {
          shouldFill = currentPrice >= order.target_price;
        }

        if (shouldFill) {
          const updateResult = await dbQuery(
            "UPDATE limit_orders SET status = 'filled', updated_at = NOW() WHERE id = $1 AND status = 'open' RETURNING id",
            [order.id]
          );
          if (!updateResult.rows || updateResult.rows.length === 0) continue;
          matched++;
          console.log(`[PriceWatcher] Limit order #${order.id} filled: ${order.side} ${order.amount} ${order.sell_token}→${order.buy_token} @ ${order.target_price} (current: ${currentPrice.toFixed(6)})`);

          if (cache?.enabled) {
            try {
              cache.publish('trades:all', {
                eventType: 'limit_order_filled',
                orderId: order.id,
                wallet: order.wallet,
                sellToken: order.sell_token,
                buyToken: order.buy_token,
                amount: order.amount,
                targetPrice: order.target_price,
                side: order.side,
              });
            } catch (_) {}
          }
        }
      } catch (e) {
        console.warn(`[PriceWatcher] Error matching order #${order.id}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('[PriceWatcher] Limit order matching error:', e.message);
  }
  return matched;
}

async function getCurrentPrice(tokenA, tokenB) {
  try {
    const result = await dbQuery(
      "SELECT price FROM token_prices WHERE token_symbol = $1 AND pair_symbol = $2 ORDER BY created_at DESC LIMIT 1",
      [tokenA, tokenB]
    );
    if (result.rows && result.rows.length > 0) {
      return parseFloat(result.rows[0].price);
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('[PriceWatcher] Starting price watcher worker...');
  console.log(`[PriceWatcher] Interval: ${INTERVAL_MS}ms (${(INTERVAL_MS / 1000).toFixed(0)}s)`);
  console.log(`[PriceWatcher] RPC: ${RPC_URL}`);

  const dbOk = await initDatabase();
  if (!dbOk) {
    console.error('[PriceWatcher] Database init failed — exiting');
    process.exit(1);
  }

  cache = new CacheService();
  await cache.init();

  const connection = new Connection(RPC_URL, COMMITMENT);

  const vaultAddress = await resolveVaultFromDb();

  priceService = new PriceService({
    cacheService: cache,
    minVolumeThreshold: Number(process.env.ORACLE_MIN_VOLUME || 1),
  });

  let tokensService = null;
  try {
    const { TokensService } = require('../api/services/tokens.service');
    tokensService = new TokensService({
      connection,
      treasuryPubkey: vaultAddress || 'unknown',
    });
    if (tokensService.loadFromDatabase) {
      await tokensService.loadFromDatabase();
    }
    console.log(`[PriceWatcher] Tokens loaded: ${tokensService.listTokens().length}`);
  } catch (e) {
    console.warn('[PriceWatcher] Could not load TokensService:', e.message);
  }

  poolService = new PoolService({ connection, tokensService });

  await runCycle();

  if (running) {
    timer = setInterval(async () => {
      if (!running) return;
      try {
        await runCycle();
      } catch (e) {
        console.error('[PriceWatcher] Cycle error:', e.message);
      }
    }, INTERVAL_MS);
  }
}

async function shutdown(signal) {
  console.log(`\n[PriceWatcher] Received ${signal} — shutting down gracefully...`);
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (cache) {
    await cache.shutdown();
  }
  await dbShutdown();
  console.log('[PriceWatcher] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((e) => {
  console.error('[PriceWatcher] Fatal error:', e.stack || e.message);
  process.exit(1);
});
