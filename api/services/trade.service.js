'use strict';

const db = require('../db/init');

const DEFAULT_DAILY_SWAP_LIMIT = 100;
const DEFAULT_MONTHLY_SWAP_LIMIT = 500;
const MAX_CANDLE_POINTS = 200;

const INTERVAL_SECONDS = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

const INTERVAL_PG = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  '1d': '1 day',
  '1w': '1 week',
};

const COARSER_INTERVAL = {
  '1m': '5m',
  '5m': '15m',
  '15m': '1h',
  '30m': '1h',
  '1h': '4h',
  '4h': '1d',
  '1d': '1w',
};

class MemCache {
  constructor() {
    this._store = new Map();
    this._refreshing = new Set();
  }

  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) {
      this._store.delete(key);
      return null;
    }
    return entry.data;
  }

  getStale(key) {
    const entry = this._store.get(key);
    if (!entry) return { data: null, stale: false };
    const now = Date.now();
    if (now > entry.exp) {
      if (entry.staleExp && now <= entry.staleExp) {
        return { data: entry.data, stale: true };
      }
      this._store.delete(key);
      return { data: null, stale: false };
    }
    return { data: entry.data, stale: false };
  }

  setSWR(key, data, freshTtlSec, staleTtlSec) {
    const now = Date.now();
    this._store.set(key, {
      data,
      exp: now + freshTtlSec * 1000,
      staleExp: now + (freshTtlSec + staleTtlSec) * 1000,
    });
  }

  isRefreshing(key) {
    return this._refreshing.has(key);
  }

  markRefreshing(key) {
    this._refreshing.add(key);
  }

  clearRefreshing(key) {
    this._refreshing.delete(key);
  }

  set(key, data, ttlSec) {
    this._store.set(key, { data, exp: Date.now() + ttlSec * 1000 });
  }

  del(key) {
    this._store.delete(key);
  }

  deleteByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key);
    }
  }
}

const memCache = new MemCache();

function bucketTimestamp(date, intervalSec) {
  const epoch = Math.floor(date.getTime() / 1000);
  const aligned = epoch - (epoch % intervalSec);
  return new Date(aligned * 1000);
}

function lttbDownsample(data, threshold) {
  if (data.length <= threshold) return data;
  const sampled = [data[0]];
  const every = (data.length - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0, avgY = 0, avgRangeStart = Math.floor((i + 1) * every) + 1;
    let avgRangeEnd = Math.floor((i + 2) * every) + 1;
    if (avgRangeEnd > data.length) avgRangeEnd = data.length;
    const avgRangeLength = avgRangeEnd - avgRangeStart;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += j;
      avgY += data[j].close;
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;
    const rangeStart = Math.floor(i * every) + 1;
    const rangeEnd = Math.floor((i + 1) * every) + 1;
    const pointAX = a;
    const pointAY = data[a].close;
    let maxArea = -1, nextA = rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs((pointAX - avgX) * (data[j].close - pointAY) - (pointAX - j) * (avgY - pointAY));
      if (area > maxArea) { maxArea = area; nextA = j; }
    }
    sampled.push(data[nextA]);
    a = nextA;
  }
  sampled.push(data[data.length - 1]);
  return sampled;
}

function lttbDownsamplePrices(prices, threshold) {
  if (prices.length <= threshold) return prices;
  const data = prices.map((p, i) => ({ close: p, idx: i }));
  const sampled = lttbDownsample(data, threshold);
  return sampled.map(d => d.close);
}

class TradeService {
  constructor({ cacheService }) {
    this.cache = cacheService;
    this._statsRefreshTimer = null;
    this._candleRollupTimer = null;
  }

  startBackgroundJobs() {
    this._statsRunning = false;
    this._rollupRunning = false;
    this._backfillRunning = false;
    this._statsRefreshTimer = setInterval(() => {
      if (this._statsRunning) return;
      this._statsRunning = true;
      this._refreshAllStats().catch(() => {}).finally(() => { this._statsRunning = false; });
    }, 60000);
    this._candleRollupTimer = setInterval(() => {
      if (this._rollupRunning) return;
      this._rollupRunning = true;
      this._rollupCandles().catch(() => {}).finally(() => { this._rollupRunning = false; });
    }, 300000);
    setTimeout(() => this._refreshAllStats().catch(() => {}), 5000);
    setTimeout(() => this._rollupCandles().catch(() => {}), 10000);
    setTimeout(() => {
      if (this._backfillRunning) return;
      this._backfillRunning = true;
      this._backfillCandles().catch(() => {}).finally(() => { this._backfillRunning = false; });
    }, 3000);
  }

  stopBackgroundJobs() {
    if (this._statsRefreshTimer) clearInterval(this._statsRefreshTimer);
    if (this._candleRollupTimer) clearInterval(this._candleRollupTimer);
  }

  _normalizeSparkData(cached) {
    if (Array.isArray(cached)) {
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < cached.length; i++) {
        if (cached[i] < min) min = cached[i];
        if (cached[i] > max) max = cached[i];
      }
      if (!isFinite(min)) min = 0;
      if (!isFinite(max)) max = 0;
      return {
        prices: cached,
        min,
        max,
        start: cached[0] || 0,
        end: cached[cached.length - 1] || 0,
        trend: cached.length >= 2 ? (cached[cached.length - 1] >= cached[0] ? 'up' : 'down') : 'flat',
      };
    }
    if (cached && cached.prices) return cached;
    return { prices: [], min: 0, max: 0, start: 0, end: 0, trend: 'flat' };
  }

  async getSwapLimits() {
    const cacheKey = 'swap_limits_config';
    const cached = memCache.get(cacheKey);
    if (cached) return cached;

    try {
      const result = await db.query(
        `SELECT daily_limit, monthly_limit FROM swap_limit_config ORDER BY updated_at DESC LIMIT 1`
      );
      if (result.rows.length > 0) {
        const limits = {
          daily: parseFloat(result.rows[0].daily_limit) || DEFAULT_DAILY_SWAP_LIMIT,
          monthly: parseFloat(result.rows[0].monthly_limit) || DEFAULT_MONTHLY_SWAP_LIMIT,
        };
        memCache.set(cacheKey, limits, 60);
        return limits;
      }
    } catch (e) {
      console.warn('[Trade] Failed to read swap limits from DB, using defaults:', e.message);
    }

    const defaults = { daily: DEFAULT_DAILY_SWAP_LIMIT, monthly: DEFAULT_MONTHLY_SWAP_LIMIT };
    memCache.set(cacheKey, defaults, 60);
    return defaults;
  }

  invalidateSwapLimitsCache() {
    memCache.del('swap_limits_config');
  }

  async recordTrade({ eventType, tokenA, tokenB, amountIn, amountOut, price, poolAddress, txSignature, wallet, tokenAMint, tokenBMint }) {
    try {
      await db.query(
        `INSERT INTO trade_events 
          (event_type, token_a_symbol, token_b_symbol, token_a_mint, token_b_mint, amount_in, amount_out, price, pool_address, tx_signature, wallet)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [eventType, tokenA, tokenB, tokenAMint || '', tokenBMint || '', amountIn || 0, amountOut || 0, price || 0, poolAddress || '', txSignature || '', wallet || '']
      );

      const tradeEvent = {
        eventType, tokenA, tokenB, amountIn, amountOut, price, poolAddress, txSignature, wallet, timestamp: Date.now(),
      };

      if (wallet) memCache.del(`swap_usage:${wallet}`);

      const tokenBLower = tokenB.toLowerCase();
      this._upsertCandle(tokenB, price || 0, amountIn || 0, new Date()).catch(() => {});

      this._updateStatsIncremental(tokenB, price || 0, amountIn || 0).catch(() => {});

      memCache.deleteByPrefix(`candles:${tokenBLower}`);
      memCache.deleteByPrefix(`sparkline:${tokenBLower}`);
      memCache.deleteByPrefix(`stats:`);
      memCache.deleteByPrefix(`allStats:`);

      if (this.cache) {
        await this.cache.invalidateCandles(tokenB.toLowerCase());
        await this.cache.invalidateCandles(tokenA.toLowerCase());
        await this.cache.publish('trades:all', tradeEvent);
        await this.cache.publish(`trades:${tokenB.toLowerCase()}`, tradeEvent);
      }

      return tradeEvent;
    } catch (e) {
      console.error('[Trade] Record failed:', e.message);
      throw e;
    }
  }

  async _upsertCandle(tokenSymbol, price, volume, tradeTime) {
    const symbol = tokenSymbol.toLowerCase();
    const intervals = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
    for (const ivl of intervals) {
      const sec = INTERVAL_SECONDS[ivl];
      const bucket = bucketTimestamp(tradeTime, sec);
      try {
        await db.query(
          `INSERT INTO chart_candles (token_symbol, interval_key, bucket, open, high, low, close, volume, trade_count, updated_at)
           VALUES ($1, $2, $3, $4, $4, $4, $4, $5, 1, NOW())
           ON CONFLICT (token_symbol, interval_key, bucket)
           DO UPDATE SET
             high = GREATEST(chart_candles.high, $4),
             low = LEAST(chart_candles.low, $4),
             close = $4,
             volume = chart_candles.volume + $5,
             trade_count = chart_candles.trade_count + 1,
             updated_at = NOW()`,
          [symbol, ivl, bucket.toISOString(), price, volume]
        );
      } catch (e) {
        console.warn(`[Trade] Candle upsert failed (${ivl}):`, e.message.substring(0, 80));
      }
    }
  }

  async _updateStatsIncremental(tokenSymbol, price, volume) {
    const symbol = tokenSymbol.toLowerCase();
    try {
      await db.query(
        `INSERT INTO token_stats_cache (token_symbol, latest_price, price_24h_ago, price_7d_ago, earliest_price, volume_24h, trades_24h, updated_at)
         VALUES ($1, $2, $2, $2, $2, $3, 1, NOW())
         ON CONFLICT (token_symbol)
         DO UPDATE SET
           latest_price = $2,
           volume_24h = token_stats_cache.volume_24h + $3,
           trades_24h = token_stats_cache.trades_24h + 1,
           updated_at = NOW()`,
        [symbol, price, volume]
      );
    } catch (e) {
      console.warn('[Trade] Stats cache update failed:', e.message.substring(0, 80));
    }
  }

  async _refreshAllStats() {
    try {
      const tokens = await db.query(
        `SELECT DISTINCT lower(token_b_symbol) AS tid FROM trade_events WHERE event_type IN ('swap','buy')`
      );
      for (const row of tokens.rows) {
        const tid = row.tid;
        try {
          const result = await db.query(
            `SELECT
              (SELECT price FROM trade_events WHERE lower(token_b_symbol) = $1 AND event_type IN ('swap','buy') ORDER BY created_at DESC LIMIT 1) AS latest_price,
              (SELECT price FROM trade_events WHERE lower(token_b_symbol) = $1 AND event_type IN ('swap','buy') AND created_at <= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1) AS price_24h_ago,
              (SELECT price FROM trade_events WHERE lower(token_b_symbol) = $1 AND event_type IN ('swap','buy') AND created_at <= NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 1) AS price_7d_ago,
              (SELECT price FROM trade_events WHERE lower(token_b_symbol) = $1 AND event_type IN ('swap','buy') ORDER BY created_at ASC LIMIT 1) AS earliest_price,
              (SELECT COALESCE(SUM(amount_in), 0) FROM trade_events WHERE lower(token_b_symbol) = $1 AND event_type IN ('swap','buy') AND created_at >= NOW() - INTERVAL '24 hours') AS volume_24h,
              (SELECT COUNT(*) FROM trade_events WHERE lower(token_b_symbol) = $1 AND event_type IN ('swap','buy') AND created_at >= NOW() - INTERVAL '24 hours') AS trades_24h`,
            [tid]
          );
          const r = result.rows[0] || {};
          await db.query(
            `INSERT INTO token_stats_cache (token_symbol, latest_price, price_24h_ago, price_7d_ago, earliest_price, volume_24h, trades_24h, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (token_symbol)
             DO UPDATE SET
               latest_price = $2, price_24h_ago = $3, price_7d_ago = $4, earliest_price = $5,
               volume_24h = $6, trades_24h = $7, updated_at = NOW()`,
            [tid, parseFloat(r.latest_price) || 0, parseFloat(r.price_24h_ago) || 0, parseFloat(r.price_7d_ago) || 0,
             parseFloat(r.earliest_price) || 0, parseFloat(r.volume_24h) || 0, parseInt(r.trades_24h) || 0]
          );
        } catch (e) {
          console.warn(`[Trade] Stats refresh failed for ${tid}:`, e.message.substring(0, 80));
        }
      }
      memCache.deleteByPrefix('stats:');
      memCache.deleteByPrefix('allStats:');
    } catch (e) {
      console.warn('[Trade] Stats refresh job failed:', e.message.substring(0, 80));
    }
  }

  async _rollupCandles() {
    try {
      const rollups = [
        { from: '1m', to: '5m' },
        { from: '5m', to: '15m' },
        { from: '15m', to: '1h' },
        { from: '1h', to: '4h' },
        { from: '4h', to: '1d' },
        { from: '1d', to: '1w' },
      ];
      for (const { from, to } of rollups) {
        const toSec = INTERVAL_SECONDS[to];
        try {
          await db.query(
            `INSERT INTO chart_candles (token_symbol, interval_key, bucket, open, high, low, close, volume, trade_count, updated_at)
             SELECT
               token_symbol,
               $1 AS interval_key,
               to_timestamp(floor(extract(epoch from bucket) / $2) * $2) AS aligned_bucket,
               (ARRAY_AGG(open ORDER BY bucket ASC))[1] AS open,
               MAX(high) AS high,
               MIN(low) AS low,
               (ARRAY_AGG(close ORDER BY bucket DESC))[1] AS close,
               SUM(volume) AS volume,
               SUM(trade_count) AS trade_count,
               NOW()
             FROM chart_candles
             WHERE interval_key = $3
               AND bucket >= NOW() - INTERVAL '7 days'
             GROUP BY token_symbol, aligned_bucket
             ON CONFLICT (token_symbol, interval_key, bucket)
             DO UPDATE SET
               high = GREATEST(chart_candles.high, EXCLUDED.high),
               low = LEAST(chart_candles.low, EXCLUDED.low),
               close = EXCLUDED.close,
               volume = EXCLUDED.volume,
               trade_count = EXCLUDED.trade_count,
               updated_at = NOW()`,
            [to, toSec, from]
          );
        } catch (e) {
          console.warn(`[Trade] Candle rollup ${from}->${to} failed:`, e.message.substring(0, 80));
        }
      }
    } catch (e) {
      console.warn('[Trade] Candle rollup job failed:', e.message.substring(0, 80));
    }
  }

  async _backfillCandles() {
    try {
      console.log('[Trade] Backfilling chart_candles from trade_events (idempotent)...');
      const intervals = [
        { key: '1m', pg: '1 minute', sec: 60 },
        { key: '5m', pg: '5 minutes', sec: 300 },
        { key: '15m', pg: '15 minutes', sec: 900 },
        { key: '1h', pg: '1 hour', sec: 3600 },
        { key: '4h', pg: '4 hours', sec: 14400 },
        { key: '1d', pg: '1 day', sec: 86400 },
        { key: '1w', pg: '1 week', sec: 604800 },
      ];

      for (const ivl of intervals) {
        try {
          await db.query(
            `INSERT INTO chart_candles (token_symbol, interval_key, bucket, open, high, low, close, volume, trade_count, updated_at)
             SELECT
               lower(token_b_symbol) AS token_symbol,
               $1 AS interval_key,
               to_timestamp(floor(extract(epoch from created_at) / $2) * $2) AS bucket,
               (ARRAY_AGG(price ORDER BY created_at ASC))[1] AS open,
               MAX(price) AS high,
               MIN(price) AS low,
               (ARRAY_AGG(price ORDER BY created_at DESC))[1] AS close,
               SUM(amount_in) AS volume,
               COUNT(*) AS trade_count,
               NOW()
             FROM trade_events
             WHERE event_type IN ('swap', 'buy')
               AND price > 0
             GROUP BY lower(token_b_symbol), bucket
             ON CONFLICT (token_symbol, interval_key, bucket) DO NOTHING`,
            [ivl.key, ivl.sec]
          );
          console.log(`[Trade] Backfilled ${ivl.key} candles`);
        } catch (e) {
          console.warn(`[Trade] Backfill ${ivl.key} failed:`, e.message.substring(0, 80));
        }
      }
      console.log('[Trade] Candle backfill complete');
    } catch (e) {
      console.warn('[Trade] Backfill job failed:', e.message.substring(0, 80));
    }
  }

  async getWalletSwapUsage(wallet) {
    if (!wallet) return { daily: 0, monthly: 0 };
    const cacheKey = `swap_usage:${wallet}`;
    const cached = memCache.get(cacheKey);
    if (cached) return cached;

    const result = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN amount_in ELSE 0 END), 0) AS daily,
        COALESCE(SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN amount_in ELSE 0 END), 0) AS monthly
      FROM trade_events
      WHERE wallet = $1
        AND event_type IN ('swap', 'buy')
        AND created_at >= NOW() - INTERVAL '30 days'`,
      [wallet]
    );
    const row = result.rows[0] || {};
    const usage = {
      daily: parseFloat(row.daily) || 0,
      monthly: parseFloat(row.monthly) || 0,
    };
    memCache.set(cacheKey, usage, 30);
    return usage;
  }

  checkSwapLimits(usage, proposedAmount, limits) {
    const dailyLimit = limits?.daily ?? DEFAULT_DAILY_SWAP_LIMIT;
    const monthlyLimit = limits?.monthly ?? DEFAULT_MONTHLY_SWAP_LIMIT;
    const dailyRemaining = Math.max(0, dailyLimit - usage.daily);
    const monthlyRemaining = Math.max(0, monthlyLimit - usage.monthly);
    const effectiveRemaining = Math.min(dailyRemaining, monthlyRemaining);
    const allowed = proposedAmount <= effectiveRemaining;
    let reason = null;
    if (!allowed) {
      if (dailyRemaining <= 0) reason = 'daily';
      else if (monthlyRemaining <= 0) reason = 'monthly';
      else reason = proposedAmount > dailyRemaining ? 'daily' : 'monthly';
    }
    return {
      allowed,
      reason,
      daily: { used: usage.daily, limit: dailyLimit, remaining: dailyRemaining },
      monthly: { used: usage.monthly, limit: monthlyLimit, remaining: monthlyRemaining },
    };
  }

  async getCandles({ tokenId, interval = '1h', from, to, pairTokenId }) {
    const ckPair = pairTokenId ? pairTokenId.toLowerCase() : '';
    const tid = tokenId.toLowerCase();
    const cacheKey = `candles:${tid}:${ckPair}:${interval}:${from || ''}:${to || ''}`;

    const { data: swrData, stale } = memCache.getStale(cacheKey);
    if (swrData && !stale) return swrData;

    if (swrData && stale) {
      if (!memCache.isRefreshing(cacheKey)) {
        memCache.markRefreshing(cacheKey);
        this._fetchAndCacheCandles(tokenId, interval, from, to, pairTokenId, cacheKey)
          .catch(() => {})
          .finally(() => memCache.clearRefreshing(cacheKey));
      }
      return swrData;
    }

    if (this.cache) {
      const cached = await this.cache.getCachedCandles(tokenId, cacheKey);
      if (cached) {
        memCache.setSWR(cacheKey, cached, 30, 120);
        return cached;
      }
    }

    return this._fetchAndCacheCandles(tokenId, interval, from, to, pairTokenId, cacheKey);
  }

  async _fetchAndCacheCandles(tokenId, interval, from, to, pairTokenId, cacheKey) {
    let candles;

    if (!pairTokenId) {
      candles = await this._getCandlesFromSummary(tokenId, interval, from, to);
    }

    if (!candles || candles.length === 0) {
      candles = await this._getCandlesFromRaw(tokenId, interval, from, to, pairTokenId);
    }

    if (candles.length > MAX_CANDLE_POINTS) {
      const coarser = COARSER_INTERVAL[interval];
      if (coarser && !pairTokenId) {
        const coarserCandles = await this._getCandlesFromSummary(tokenId, coarser, from, to);
        if (coarserCandles.length > 0 && coarserCandles.length <= MAX_CANDLE_POINTS) {
          candles = coarserCandles;
        } else {
          candles = lttbDownsample(candles, MAX_CANDLE_POINTS);
        }
      } else {
        candles = lttbDownsample(candles, MAX_CANDLE_POINTS);
      }
    }

    const isCurrentBucket = !to || (Date.now() - Number(to)) < (INTERVAL_SECONDS[interval] || 3600) * 1000;
    const freshTtl = isCurrentBucket ? 30 : 300;
    const staleTtl = 120;

    memCache.setSWR(cacheKey, candles, freshTtl, staleTtl);
    if (this.cache) {
      await this.cache.cacheCandles(tokenId, cacheKey, candles, freshTtl + staleTtl);
    }

    return candles;
  }

  async _getCandlesFromSummary(tokenId, interval, from, to) {
    try {
      let sql = `SELECT bucket, open, high, low, close, volume, trade_count
                 FROM chart_candles
                 WHERE token_symbol = $1 AND interval_key = $2`;
      const params = [tokenId.toLowerCase(), interval];
      let idx = 3;

      if (from) {
        sql += ` AND bucket >= $${idx}::timestamptz`;
        params.push(new Date(Number(from)).toISOString());
        idx++;
      }
      if (to) {
        sql += ` AND bucket <= $${idx}::timestamptz`;
        params.push(new Date(Number(to)).toISOString());
        idx++;
      }

      sql += ` ORDER BY bucket ASC`;

      const result = await db.query(sql, params);
      return result.rows.map(r => ({
        time: new Date(r.bucket).getTime(),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
        volume: parseFloat(r.volume),
        tradeCount: parseInt(r.trade_count),
      }));
    } catch {
      return [];
    }
  }

  async _getCandlesFromRaw(tokenId, interval, from, to, pairTokenId) {
    const bucketInterval = INTERVAL_PG[interval] || '1 hour';
    let sql;
    const params = [bucketInterval, tokenId];
    let idx = 3;

    if (pairTokenId) {
      sql = `
      SELECT
        date_trunc('minute', created_at) - 
          (EXTRACT(EPOCH FROM date_trunc('minute', created_at))::bigint % EXTRACT(EPOCH FROM $1::interval)::bigint) * INTERVAL '1 second'
          AS bucket,
        (ARRAY_AGG(price ORDER BY created_at ASC))[1] AS open,
        MAX(price) AS high,
        MIN(price) AS low,
        (ARRAY_AGG(price ORDER BY created_at DESC))[1] AS close,
        SUM(amount_in) AS volume,
        COUNT(*) AS trade_count
      FROM trade_events
      WHERE event_type IN ('swap', 'buy')
        AND (
          (lower(token_b_symbol) = lower($2) AND lower(token_a_symbol) = lower($${idx}))
          OR (lower(token_a_symbol) = lower($2) AND lower(token_b_symbol) = lower($${idx}))
        )
      `;
      params.push(pairTokenId);
      idx++;
    } else {
      sql = `
      SELECT
        date_trunc('minute', created_at) - 
          (EXTRACT(EPOCH FROM date_trunc('minute', created_at))::bigint % EXTRACT(EPOCH FROM $1::interval)::bigint) * INTERVAL '1 second'
          AS bucket,
        (ARRAY_AGG(price ORDER BY created_at ASC))[1] AS open,
        MAX(price) AS high,
        MIN(price) AS low,
        (ARRAY_AGG(price ORDER BY created_at DESC))[1] AS close,
        SUM(amount_in) AS volume,
        COUNT(*) AS trade_count
      FROM trade_events
      WHERE lower(token_b_symbol) = lower($2)
        AND event_type IN ('swap', 'buy')
      `;
    }

    if (from) {
      sql += ` AND created_at >= $${idx}::timestamptz`;
      params.push(new Date(Number(from)).toISOString());
      idx++;
    }
    if (to) {
      sql += ` AND created_at <= $${idx}::timestamptz`;
      params.push(new Date(Number(to)).toISOString());
      idx++;
    }

    sql += ` GROUP BY bucket ORDER BY bucket ASC`;

    const result = await db.query(sql, params);
    return result.rows.map(r => ({
      time: new Date(r.bucket).getTime(),
      open: parseFloat(r.open),
      high: parseFloat(r.high),
      low: parseFloat(r.low),
      close: parseFloat(r.close),
      volume: parseFloat(r.volume),
      tradeCount: parseInt(r.trade_count),
    }));
  }

  async getRecentTrades({ tokenId, limit = 50, pairTokenId, wallet }) {
    let sql = `SELECT event_type, token_a_symbol, token_b_symbol, amount_in, amount_out, price, pool_address, tx_signature, wallet, created_at
       FROM trade_events
       WHERE (lower(token_a_symbol) = lower($1) OR lower(token_b_symbol) = lower($1))`;
    const params = [tokenId, limit];

    if (pairTokenId) {
      sql += ` AND (lower(token_a_symbol) = lower($${params.length + 1}) OR lower(token_b_symbol) = lower($${params.length + 1}))`;
      params.push(pairTokenId);
    }

    if (wallet) {
      sql += ` AND lower(wallet) = lower($${params.length + 1})`;
      params.push(wallet);
    }

    sql += ` ORDER BY created_at DESC LIMIT $2`;

    const result = await db.query(sql, params);
    return result.rows.map(r => ({
      eventType: r.event_type,
      tokenA: r.token_a_symbol,
      tokenB: r.token_b_symbol,
      amountIn: parseFloat(r.amount_in),
      amountOut: parseFloat(r.amount_out),
      price: parseFloat(r.price),
      poolAddress: r.pool_address,
      txSignature: r.tx_signature,
      wallet: r.wallet,
      createdAt: new Date(r.created_at).getTime(),
    }));
  }

  async getSparkline({ tokenId, hours = 168, pairTokenId }) {
    const ckPair = pairTokenId ? pairTokenId.toLowerCase() : '';
    const tid = tokenId.toLowerCase();
    const sparkKey = `sparkline:${tid}:${ckPair}:${hours}`;

    const memCached = memCache.get(sparkKey);
    if (memCached) return memCached;

    if (this.cache) {
      const cached = await this.cache.getCachedSparkline(`${tokenId}:${ckPair}`, hours);
      if (cached) {
        const normalized = this._normalizeSparkData(cached);
        memCache.set(sparkKey, normalized, 120);
        return normalized;
      }
    }

    let rawPrices;

    if (!pairTokenId) {
      try {
        const result = await db.query(
          `SELECT close FROM chart_candles
           WHERE token_symbol = $1 AND interval_key = '1h'
             AND bucket >= NOW() - ($2 || ' hours')::interval
           ORDER BY bucket ASC`,
          [tokenId.toLowerCase(), String(hours)]
        );
        if (result.rows.length > 0) {
          rawPrices = result.rows.map(r => parseFloat(r.close));
        }
      } catch {}
    }

    if (!rawPrices || rawPrices.length === 0) {
      let sql;
      const params = [tokenId, String(hours)];

      if (pairTokenId) {
        sql = `SELECT
          date_trunc('hour', created_at) AS bucket,
          (ARRAY_AGG(price ORDER BY created_at DESC))[1] AS close
         FROM trade_events
         WHERE event_type IN ('swap', 'buy')
           AND created_at >= NOW() - ($2 || ' hours')::interval
           AND (
             (lower(token_b_symbol) = lower($1) AND lower(token_a_symbol) = lower($3))
             OR (lower(token_a_symbol) = lower($1) AND lower(token_b_symbol) = lower($3))
           )`;
        params.push(pairTokenId);
      } else {
        sql = `SELECT
          date_trunc('hour', created_at) AS bucket,
          (ARRAY_AGG(price ORDER BY created_at DESC))[1] AS close
         FROM trade_events
         WHERE lower(token_b_symbol) = lower($1)
           AND event_type IN ('swap', 'buy')
           AND created_at >= NOW() - ($2 || ' hours')::interval`;
      }

      sql += ` GROUP BY bucket ORDER BY bucket ASC`;
      const result = await db.query(sql, params);
      rawPrices = result.rows.map(r => parseFloat(r.close));
    }

    const SPARKLINE_POINTS = 20;
    const downsampled = lttbDownsamplePrices(rawPrices, SPARKLINE_POINTS);

    let min = Infinity, max = -Infinity;
    for (let i = 0; i < downsampled.length; i++) {
      if (downsampled[i] < min) min = downsampled[i];
      if (downsampled[i] > max) max = downsampled[i];
    }
    if (!isFinite(min)) min = 0;
    if (!isFinite(max)) max = 0;

    const sparkData = {
      prices: downsampled,
      min,
      max,
      start: downsampled[0] || 0,
      end: downsampled[downsampled.length - 1] || 0,
      trend: downsampled.length >= 2 ? (downsampled[downsampled.length - 1] >= downsampled[0] ? 'up' : 'down') : 'flat',
    };

    memCache.set(sparkKey, sparkData, 120);
    if (this.cache && downsampled.length > 0) {
      await this.cache.cacheSparkline(`${tokenId}:${ckPair}`, hours, sparkData, 120);
    }

    return sparkData;
  }

  async getTokenStats({ tokenId }) {
    const cacheKey = `stats:${tokenId.toLowerCase()}`;

    const { data: swrData, stale } = memCache.getStale(cacheKey);
    if (swrData && !stale) return swrData;

    if (swrData && stale) {
      if (!memCache.isRefreshing(cacheKey)) {
        memCache.markRefreshing(cacheKey);
        this._fetchAndCacheStats(tokenId, cacheKey)
          .catch(() => {})
          .finally(() => memCache.clearRefreshing(cacheKey));
      }
      return swrData;
    }

    return this._fetchAndCacheStats(tokenId, cacheKey);
  }

  async _fetchAndCacheStats(tokenId, cacheKey) {
    try {
      const result = await db.query(
        `SELECT * FROM token_stats_cache WHERE token_symbol = $1`,
        [tokenId.toLowerCase()]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        const latest = parseFloat(row.latest_price) || 0;
        const earliest = parseFloat(row.earliest_price) || 0;
        const price24h = parseFloat(row.price_24h_ago) || earliest;
        const price7d = parseFloat(row.price_7d_ago) || earliest;
        const stats = {
          latestPrice: latest,
          change24h: price24h > 0 ? ((latest - price24h) / price24h) * 100 : 0,
          change7d: price7d > 0 ? ((latest - price7d) / price7d) * 100 : 0,
          volume24h: parseFloat(row.volume_24h) || 0,
          trades24h: parseInt(row.trades_24h) || 0,
          hasData: latest > 0,
        };
        memCache.setSWR(cacheKey, stats, 60, 120);
        return stats;
      }
    } catch {}

    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        memCache.setSWR(cacheKey, cached, 60, 120);
        return cached;
      }
    }

    const result = await db.query(
      `SELECT
        (SELECT price FROM trade_events WHERE lower(token_b_symbol) = lower($1) AND event_type IN ('swap','buy') ORDER BY created_at DESC LIMIT 1) AS latest_price,
        (SELECT price FROM trade_events WHERE lower(token_b_symbol) = lower($1) AND event_type IN ('swap','buy') AND created_at <= NOW() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 1) AS price_24h_ago,
        (SELECT price FROM trade_events WHERE lower(token_b_symbol) = lower($1) AND event_type IN ('swap','buy') AND created_at <= NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 1) AS price_7d_ago,
        (SELECT price FROM trade_events WHERE lower(token_b_symbol) = lower($1) AND event_type IN ('swap','buy') ORDER BY created_at ASC LIMIT 1) AS earliest_price,
        (SELECT COALESCE(SUM(amount_in), 0) FROM trade_events WHERE lower(token_b_symbol) = lower($1) AND event_type IN ('swap','buy') AND created_at >= NOW() - INTERVAL '24 hours') AS volume_24h,
        (SELECT COUNT(*) FROM trade_events WHERE lower(token_b_symbol) = lower($1) AND event_type IN ('swap','buy') AND created_at >= NOW() - INTERVAL '24 hours') AS trades_24h`,
      [tokenId]
    );

    const row = result.rows[0] || {};
    const latest = parseFloat(row.latest_price) || 0;
    const earliest = parseFloat(row.earliest_price) || 0;
    const price24h = parseFloat(row.price_24h_ago) || earliest;
    const price7d = parseFloat(row.price_7d_ago) || earliest;
    const stats = {
      latestPrice: latest,
      change24h: price24h > 0 ? ((latest - price24h) / price24h) * 100 : 0,
      change7d: price7d > 0 ? ((latest - price7d) / price7d) * 100 : 0,
      volume24h: parseFloat(row.volume_24h) || 0,
      trades24h: parseInt(row.trades_24h) || 0,
      hasData: latest > 0,
    };

    memCache.setSWR(cacheKey, stats, 60, 120);
    if (this.cache) {
      await this.cache.set(cacheKey, stats, 180);
    }

    return stats;
  }

  async getAllTokenStats(tokenIds) {
    const memKey = `allStats:${tokenIds.sort().join(',').toLowerCase()}`;
    const { data: swrData, stale } = memCache.getStale(memKey);
    if (swrData && !stale) return swrData;
    if (swrData && stale) {
      if (!memCache.isRefreshing(memKey)) {
        memCache.markRefreshing(memKey);
        this._fetchAllTokenStats(tokenIds, memKey)
          .catch(() => {})
          .finally(() => memCache.clearRefreshing(memKey));
      }
      return swrData;
    }
    return this._fetchAllTokenStats(tokenIds, memKey);
  }

  async _fetchAllTokenStats(tokenIds, memKey) {

    try {
      const result = await db.query(
        `SELECT * FROM token_stats_cache WHERE token_symbol = ANY($1::text[])`,
        [tokenIds.map(t => t.toLowerCase())]
      );
      if (result.rows.length > 0) {
        const results = {};
        for (const row of result.rows) {
          const id = row.token_symbol;
          const latest = parseFloat(row.latest_price) || 0;
          const earliest = parseFloat(row.earliest_price) || 0;
          const price24h = parseFloat(row.price_24h_ago) || earliest;
          const price7d = parseFloat(row.price_7d_ago) || earliest;
          results[id] = {
            latestPrice: latest,
            change24h: price24h > 0 ? ((latest - price24h) / price24h) * 100 : 0,
            change7d: price7d > 0 ? ((latest - price7d) / price7d) * 100 : 0,
            volume24h: parseFloat(row.volume_24h) || 0,
            trades24h: parseInt(row.trades_24h) || 0,
            hasData: latest > 0,
          };
        }
        for (const id of tokenIds) {
          const key = id.toLowerCase();
          if (!results[key]) {
            results[key] = { latestPrice: 0, change24h: 0, change7d: 0, volume24h: 0, trades24h: 0, hasData: false };
          }
          if (!results[id] && results[key]) {
            results[id] = results[key];
          }
        }
        memCache.setSWR(memKey, results, 60, 120);
        return results;
      }
    } catch {}

    const result = await db.query(
      `WITH tokens AS (
        SELECT unnest($1::text[]) AS token_id
      ),
      latest AS (
        SELECT DISTINCT ON (lower(token_b_symbol))
          lower(token_b_symbol) AS tid, price AS latest_price
        FROM trade_events
        WHERE event_type IN ('swap','buy')
          AND lower(token_b_symbol) = ANY(SELECT lower(token_id) FROM tokens)
        ORDER BY lower(token_b_symbol), created_at DESC
      ),
      earliest AS (
        SELECT DISTINCT ON (lower(token_b_symbol))
          lower(token_b_symbol) AS tid, price AS earliest_price
        FROM trade_events
        WHERE event_type IN ('swap','buy')
          AND lower(token_b_symbol) = ANY(SELECT lower(token_id) FROM tokens)
        ORDER BY lower(token_b_symbol), created_at ASC
      ),
      price_24h AS (
        SELECT DISTINCT ON (lower(token_b_symbol))
          lower(token_b_symbol) AS tid, price AS price_24h_ago
        FROM trade_events
        WHERE event_type IN ('swap','buy')
          AND created_at <= NOW() - INTERVAL '24 hours'
          AND lower(token_b_symbol) = ANY(SELECT lower(token_id) FROM tokens)
        ORDER BY lower(token_b_symbol), created_at DESC
      ),
      price_7d AS (
        SELECT DISTINCT ON (lower(token_b_symbol))
          lower(token_b_symbol) AS tid, price AS price_7d_ago
        FROM trade_events
        WHERE event_type IN ('swap','buy')
          AND created_at <= NOW() - INTERVAL '7 days'
          AND lower(token_b_symbol) = ANY(SELECT lower(token_id) FROM tokens)
        ORDER BY lower(token_b_symbol), created_at DESC
      ),
      vol AS (
        SELECT lower(token_b_symbol) AS tid,
          COALESCE(SUM(amount_in), 0) AS volume_24h,
          COUNT(*) AS trades_24h
        FROM trade_events
        WHERE event_type IN ('swap','buy')
          AND created_at >= NOW() - INTERVAL '24 hours'
          AND lower(token_b_symbol) = ANY(SELECT lower(token_id) FROM tokens)
        GROUP BY lower(token_b_symbol)
      )
      SELECT t.token_id,
        l.latest_price, e.earliest_price,
        p24.price_24h_ago, p7.price_7d_ago,
        COALESCE(v.volume_24h, 0) AS volume_24h,
        COALESCE(v.trades_24h, 0) AS trades_24h
      FROM tokens t
      LEFT JOIN latest l ON l.tid = lower(t.token_id)
      LEFT JOIN earliest e ON e.tid = lower(t.token_id)
      LEFT JOIN price_24h p24 ON p24.tid = lower(t.token_id)
      LEFT JOIN price_7d p7 ON p7.tid = lower(t.token_id)
      LEFT JOIN vol v ON v.tid = lower(t.token_id)`,
      [tokenIds]
    );

    const results = {};
    for (const row of result.rows) {
      const id = row.token_id;
      const latest = parseFloat(row.latest_price) || 0;
      const earliest = parseFloat(row.earliest_price) || 0;
      const price24h = parseFloat(row.price_24h_ago) || earliest;
      const price7d = parseFloat(row.price_7d_ago) || earliest;
      results[id] = {
        latestPrice: latest,
        change24h: price24h > 0 ? ((latest - price24h) / price24h) * 100 : 0,
        change7d: price7d > 0 ? ((latest - price7d) / price7d) * 100 : 0,
        volume24h: parseFloat(row.volume_24h) || 0,
        trades24h: parseInt(row.trades_24h) || 0,
        hasData: latest > 0,
      };
    }

    for (const id of tokenIds) {
      if (!results[id]) {
        results[id] = { latestPrice: 0, change24h: 0, change7d: 0, volume24h: 0, trades24h: 0, hasData: false };
      }
    }

    memCache.setSWR(memKey, results, 60, 120);
    return results;
  }
}

module.exports = { TradeService };
