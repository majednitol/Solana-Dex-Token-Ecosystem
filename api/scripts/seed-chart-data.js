'use strict';

const db = require('../db/init');

const CLEAN = process.argv.includes('--clean');

const SEED_WALLET = 'seed-chart-data';

const TOKENS = [
  { symbol: 'ntc', minPrice: 0.01, maxPrice: 0.05, trend: 0.00002 },
  { symbol: 'dmc', minPrice: 0.001, maxPrice: 0.01, trend: 0.000005 },
  { symbol: 'asdc', minPrice: 0.005, maxPrice: 0.02, trend: 0.000008 },
];

const INTERVALS = [
  { key: '1m',  durationMs: 60 * 1000,                  lookbackMs: 2 * 3600 * 1000 },
  { key: '5m',  durationMs: 5 * 60 * 1000,              lookbackMs: 24 * 3600 * 1000 },
  { key: '15m', durationMs: 15 * 60 * 1000,             lookbackMs: 3 * 24 * 3600 * 1000 },
  { key: '1h',  durationMs: 3600 * 1000,                lookbackMs: 7 * 24 * 3600 * 1000 },
  { key: '4h',  durationMs: 4 * 3600 * 1000,            lookbackMs: 30 * 24 * 3600 * 1000 },
  { key: '1d',  durationMs: 24 * 3600 * 1000,           lookbackMs: 365 * 24 * 3600 * 1000 },
  { key: '1w',  durationMs: 7 * 24 * 3600 * 1000,       lookbackMs: 52 * 7 * 24 * 3600 * 1000 },
];

const TRADE_LOOKBACK_MS = 365 * 24 * 3600 * 1000;
const TRADES_PER_DAY = 48;
const TOTAL_DAYS = 365;

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randomWalk(rand, startPrice, minPrice, maxPrice, count, trend) {
  const prices = [];
  let price = startPrice;
  const volatility = (maxPrice - minPrice) * 0.015;
  for (let i = 0; i < count; i++) {
    const noise = (rand() - 0.5) * 2 * volatility;
    price = price + noise + trend;
    price = Math.max(minPrice * 0.8, Math.min(maxPrice * 1.2, price));
    prices.push(price);
  }
  return prices;
}

function buildCandles(closePrices, rand, minPrice, maxPrice) {
  return closePrices.map((close, i) => {
    const prev = i > 0 ? closePrices[i - 1] : close;
    const open = prev;
    const spread = Math.abs(close - open);
    const wick = spread * (0.5 + rand() * 1.5);
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    const volume = (minPrice + rand() * (maxPrice - minPrice)) * (50 + rand() * 950);
    const tradeCount = Math.floor(1 + rand() * 20);
    return { open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume, tradeCount };
  });
}

function bucketTs(nowMs, intervalMs, i) {
  const start = nowMs - intervalMs * i;
  return Math.floor(start / intervalMs) * intervalMs;
}

async function cleanSeedData() {
  console.log('[Seed] Cleaning existing seeded chart data...');
  const symbols = TOKENS.map(t => `'${t.symbol}'`).join(',');
  await db.query(`DELETE FROM chart_candles WHERE token_symbol IN (${symbols})`);
  await db.query(`DELETE FROM trade_events WHERE wallet = $1`, [SEED_WALLET]);
  await db.query(`DELETE FROM token_stats_cache WHERE token_symbol IN (${symbols})`);
  console.log('[Seed] Clean complete.');
}

async function seedCandles(token, rand) {
  console.log(`[Seed] Seeding candles for ${token.symbol}...`);
  const nowMs = Date.now();

  for (const interval of INTERVALS) {
    const count = Math.ceil(interval.lookbackMs / interval.durationMs);
    const startPrice = token.minPrice + rand() * (token.maxPrice - token.minPrice);
    const closePrices = randomWalk(rand, startPrice, token.minPrice, token.maxPrice, count, token.trend);
    const candles = buildCandles(closePrices, rand, token.minPrice, token.maxPrice);

    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < candles.length; i += CHUNK) {
      const chunk = candles.slice(i, i + CHUNK);
      const placeholders = [];
      const values = [];
      let idx = 1;

      for (let j = 0; j < chunk.length; j++) {
        const c = chunk[j];
        const candleIdx = i + j;
        const ts = bucketTs(nowMs, interval.durationMs, candles.length - 1 - candleIdx);
        const isoTs = new Date(ts).toISOString();
        placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        values.push(token.symbol, interval.key, isoTs, c.open, c.high, c.low, c.close, c.volume, c.tradeCount);
      }

      await db.query(
        `INSERT INTO chart_candles (token_symbol, interval_key, bucket, open, high, low, close, volume, trade_count)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (token_symbol, interval_key, bucket) DO UPDATE
           SET open = EXCLUDED.open,
               high = EXCLUDED.high,
               low  = EXCLUDED.low,
               close = EXCLUDED.close,
               volume = EXCLUDED.volume,
               trade_count = EXCLUDED.trade_count,
               updated_at = NOW()`,
        values
      );
      inserted += chunk.length;
    }
    console.log(`[Seed]   ${token.symbol} ${interval.key}: ${inserted} candles`);
  }
}

async function seedTradeEventsBatch(token, rand) {
  console.log(`[Seed] Seeding trade_events for ${token.symbol}...`);
  const totalTrades = TRADES_PER_DAY * TOTAL_DAYS;

  const startPrice = token.minPrice + rand() * (token.maxPrice - token.minPrice);
  const closePrices = randomWalk(rand, startPrice, token.minPrice, token.maxPrice, totalTrades, token.trend);

  const CHUNK = 500;
  let inserted = 0;

  for (let i = 0; i < totalTrades; i += CHUNK) {
    const chunkEnd = Math.min(i + CHUNK, totalTrades);
    const placeholders = [];
    const values = [];
    let idx = 1;

    for (let j = i; j < chunkEnd; j++) {
      const price = closePrices[j];
      const secondsAgo = Math.floor((totalTrades - 1 - j) * (TRADE_LOOKBACK_MS / totalTrades / 1000));
      const amountIn = (0.5 + rand() * 9.5) * price * 1000;
      const amountOut = amountIn / price;
      placeholders.push(`('swap', 'usdc', $${idx++}, '', '', $${idx++}, $${idx++}, $${idx++}, '', '', $${idx++}, NOW() - (${secondsAgo} * INTERVAL '1 second'))`);
      values.push(token.symbol, price, amountIn, amountOut, SEED_WALLET);
    }

    await db.query(
      `INSERT INTO trade_events
         (event_type, token_a_symbol, token_b_symbol, token_a_mint, token_b_mint, price, amount_in, amount_out, pool_address, tx_signature, wallet, created_at)
       VALUES ${placeholders.join(',')}`,
      values
    );
    inserted += chunkEnd - i;
  }
  console.log(`[Seed]   ${token.symbol}: ${inserted} trade events`);
}

async function seedTokenStats() {
  console.log('[Seed] Upserting token_stats_cache (scoped to seeded trades)...');

  for (const token of TOKENS) {
    const latestRow = await db.query(
      `SELECT price FROM trade_events WHERE token_b_symbol = $1 AND event_type = 'swap' AND wallet = $2 ORDER BY created_at DESC LIMIT 1`,
      [token.symbol, SEED_WALLET]
    );
    const price24hRow = await db.query(
      `SELECT price FROM trade_events WHERE token_b_symbol = $1 AND event_type = 'swap' AND wallet = $2 AND created_at <= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1`,
      [token.symbol, SEED_WALLET]
    );
    const price7dRow = await db.query(
      `SELECT price FROM trade_events WHERE token_b_symbol = $1 AND event_type = 'swap' AND wallet = $2 AND created_at <= NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 1`,
      [token.symbol, SEED_WALLET]
    );
    const earliestRow = await db.query(
      `SELECT price FROM trade_events WHERE token_b_symbol = $1 AND event_type = 'swap' AND wallet = $2 ORDER BY created_at ASC LIMIT 1`,
      [token.symbol, SEED_WALLET]
    );
    const vol24hRow = await db.query(
      `SELECT COALESCE(SUM(amount_in), 0) AS vol, COUNT(*) AS cnt
         FROM trade_events WHERE token_b_symbol = $1 AND event_type = 'swap' AND wallet = $2 AND created_at >= NOW() - INTERVAL '24 hours'`,
      [token.symbol, SEED_WALLET]
    );

    const latestPrice = latestRow.rows[0]?.price ?? token.minPrice;
    const price24hAgo = price24hRow.rows[0]?.price ?? latestPrice;
    const price7dAgo = price7dRow.rows[0]?.price ?? latestPrice;
    const earliestPrice = earliestRow.rows[0]?.price ?? latestPrice;
    const volume24h = parseFloat(vol24hRow.rows[0]?.vol ?? 0);
    const trades24h = parseInt(vol24hRow.rows[0]?.cnt ?? 0, 10);

    await db.query(
      `INSERT INTO token_stats_cache (token_symbol, latest_price, price_24h_ago, price_7d_ago, earliest_price, volume_24h, trades_24h, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (token_symbol) DO UPDATE
         SET latest_price = EXCLUDED.latest_price,
             price_24h_ago = EXCLUDED.price_24h_ago,
             price_7d_ago = EXCLUDED.price_7d_ago,
             earliest_price = EXCLUDED.earliest_price,
             volume_24h = EXCLUDED.volume_24h,
             trades_24h = EXCLUDED.trades_24h,
             updated_at = NOW()`,
      [token.symbol, latestPrice, price24hAgo, price7dAgo, earliestPrice, volume24h, trades24h]
    );
    console.log(`[Seed]   ${token.symbol}: price=${latestPrice.toFixed(6)}, 24h_vol=${volume24h.toFixed(2)}, trades_24h=${trades24h}`);
  }
}

async function main() {
  console.log('[Seed] Starting chart data seed...');
  console.log('[Seed] WARNING: Run only against a test/staging database. --clean removes all chart_candles and token_stats_cache rows for NTC/DMC/ASDC.');
  console.log('[Seed] Options: --clean=' + CLEAN);

  const { initDatabase } = require('../db/init');
  await initDatabase();

  if (CLEAN) {
    await cleanSeedData();
  }

  for (let t = 0; t < TOKENS.length; t++) {
    const token = TOKENS[t];
    const rand = seededRandom(42 + t * 1000);
    await seedCandles(token, rand);
    const rand2 = seededRandom(99 + t * 777);
    await seedTradeEventsBatch(token, rand2);
  }

  await seedTokenStats();

  console.log('[Seed] Chart data seed complete!');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(e => {
      console.error('[Seed] Fatal error:', e.message, e.stack);
      process.exit(1);
    });
}

module.exports = { main };
