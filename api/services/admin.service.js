'use strict';

const db = require('../db/init');

class AdminService {
  constructor({ cacheService } = {}) {
    this.cache = cacheService || null;
  }

  async getPlatformStats(period) {
    const intervals = { week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.all;
    const halfInterval = period === 'week' ? '14 days' : period === 'month' ? '60 days' : period === 'year' ? '730 days' : '7300 days';

    const result = await db.query(`
      SELECT
        (SELECT COUNT(DISTINCT wallet) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${interval}') AS unique_wallets,
        (SELECT COUNT(DISTINCT wallet) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}') AS prev_unique_wallets,
        (SELECT COALESCE(SUM(amount_in), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${interval}') AS total_volume,
        (SELECT COALESCE(SUM(amount_in), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}') AS prev_volume,
        (SELECT COUNT(*) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${interval}') AS total_trades,
        (SELECT COUNT(*) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}') AS prev_trades,
        (SELECT COALESCE(SUM(CASE WHEN event_type = 'add_liquidity' THEN amount_in WHEN event_type = 'remove_liquidity' THEN -amount_in ELSE 0 END), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${interval}') AS tvl,
        (SELECT COALESCE(SUM(CASE WHEN event_type = 'add_liquidity' THEN amount_in WHEN event_type = 'remove_liquidity' THEN -amount_in ELSE 0 END), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}') AS prev_tvl
    `, []);

    const row = result.rows[0] || {};
    const uniqueWallets = parseInt(row.unique_wallets) || 0;
    const prevWallets = parseInt(row.prev_unique_wallets) || 0;
    const totalVolume = parseFloat(row.total_volume) || 0;
    const prevVolume = parseFloat(row.prev_volume) || 0;
    const totalTrades = parseInt(row.total_trades) || 0;
    const prevTrades = parseInt(row.prev_trades) || 0;
    const feeTier = 0.30;
    const totalFees = totalVolume * feeTier / 100;
    const prevFees = prevVolume * feeTier / 100;
    const totalTVL = parseFloat(row.tvl) || 0;
    const prevTVL = parseFloat(row.prev_tvl) || 0;

    return {
      totalUsers: uniqueWallets,
      usersChange: prevWallets > 0 ? ((uniqueWallets - prevWallets) / prevWallets * 100) : (uniqueWallets > 0 ? 100 : 0),
      totalVolume,
      volumeChange: prevVolume > 0 ? ((totalVolume - prevVolume) / prevVolume * 100) : (totalVolume > 0 ? 100 : 0),
      totalFees,
      feesChange: prevFees > 0 ? ((totalFees - prevFees) / prevFees * 100) : (totalFees > 0 ? 100 : 0),
      totalTrades,
      tradesChange: prevTrades > 0 ? ((totalTrades - prevTrades) / prevTrades * 100) : (totalTrades > 0 ? 100 : 0),
      totalTVL,
      tvlChange: prevTVL > 0 ? ((totalTVL - prevTVL) / prevTVL * 100) : (totalTVL > 0 ? 100 : 0),
    };
  }

  async getVolumeOverTime(period) {
    const config = {
      week: { trunc: 'day', interval: '7 days', fmt: 'Dy' },
      month: { trunc: 'week', interval: '30 days', fmt: '"Wk" W' },
      year: { trunc: 'month', interval: '365 days', fmt: 'Mon' },
      all: { trunc: 'month', interval: '3650 days', fmt: 'Mon' },
    };
    const c = config[period] || config.all;

    const result = await db.query(`
      SELECT
        date_trunc('${c.trunc}', created_at) AS bucket,
        to_char(date_trunc('${c.trunc}', created_at), '${c.fmt}') AS label,
        COALESCE(SUM(amount_in), 0) AS volume,
        COUNT(*) AS trades
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '${c.interval}'
      GROUP BY bucket, label
      ORDER BY bucket ASC
    `, []);

    return (result.rows || []).map(r => ({
      label: r.label,
      volume: parseFloat(r.volume) || 0,
      trades: parseInt(r.trades) || 0,
    }));
  }

  async getTradeActivity(period) {
    const config = {
      week: { trunc: 'day', interval: '7 days', fmt: 'Dy' },
      month: { trunc: 'week', interval: '30 days', fmt: '"Wk" W' },
      year: { trunc: 'month', interval: '365 days', fmt: 'Mon' },
      all: { trunc: 'month', interval: '3650 days', fmt: 'Mon' },
    };
    const c = config[period] || config.all;

    const result = await db.query(`
      SELECT
        date_trunc('${c.trunc}', created_at) AS bucket,
        to_char(date_trunc('${c.trunc}', created_at), '${c.fmt}') AS label,
        COUNT(*) FILTER (WHERE event_type = 'swap') AS swaps,
        COUNT(*) FILTER (WHERE event_type = 'buy') AS buys,
        COUNT(DISTINCT wallet) AS unique_wallets
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '${c.interval}'
      GROUP BY bucket, label
      ORDER BY bucket ASC
    `, []);

    return (result.rows || []).map(r => ({
      label: r.label,
      swaps: parseInt(r.swaps) || 0,
      buys: parseInt(r.buys) || 0,
      uniqueWallets: parseInt(r.unique_wallets) || 0,
    }));
  }

  async getVolumeByToken(period) {
    const ALLOWED_TOKENS = ['NTC','ASDC','EDC','RDC','DMC','BDC','YDC','SDC','CDC','ADC','SGDC'];
    const intervals = { week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.all;

    const result = await db.query(`
      SELECT
        UPPER(token_b_symbol) AS symbol,
        COALESCE(SUM(amount_in), 0) AS volume,
        COUNT(*) AS trades
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '${interval}'
        AND event_type IN ('swap', 'buy')
        AND UPPER(token_b_symbol) = ANY($1)
      GROUP BY UPPER(token_b_symbol)
      ORDER BY volume DESC
    `, [ALLOWED_TOKENS]);

    const colors = {
      NTC: '#a855f7', ASDC: '#22c55e', EDC: '#eab308', DMC: '#f97316',
      BDC: '#3b82f6', YDC: '#ef4444', SDC: '#06b6d4', CDC: '#ec4899',
      RDC: '#8b5cf6', ADC: '#14b8a6', SGDC: '#f59e0b',
    };

    const rowMap = {};
    for (const r of (result.rows || [])) {
      rowMap[r.symbol] = {
        name: r.symbol,
        volume: parseFloat(r.volume) || 0,
        trades: parseInt(r.trades) || 0,
        color: colors[r.symbol] || '#6b7280',
      };
    }
    return ALLOWED_TOKENS.map(sym => rowMap[sym] || {
      name: sym,
      volume: 0,
      trades: 0,
      color: colors[sym] || '#6b7280',
    });
  }

  async getTrendingSwapsStats() {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM trade_events WHERE created_at >= NOW() - INTERVAL '24 hours' AND event_type IN ('swap', 'buy')) AS current_swaps,
        (SELECT COUNT(*) FROM trade_events WHERE created_at >= NOW() - INTERVAL '48 hours' AND created_at < NOW() - INTERVAL '24 hours' AND event_type IN ('swap', 'buy')) AS prev_swaps
    `, []);
    const row = result.rows[0] || {};
    const current = parseInt(row.current_swaps) || 0;
    const prev = parseInt(row.prev_swaps) || 0;
    const change = prev > 0 ? parseFloat(((current - prev) / prev * 100).toFixed(1)) : (current > 0 ? 100 : 0);
    return { count: current, change };
  }

  async getTopPerformers() {
    const ALLOWED_TOKENS = ['NTC','ASDC','EDC','RDC','DMC','BDC','YDC','SDC','CDC','ADC','SGDC'];
    const result = await db.query(`
      SELECT DISTINCT UPPER(token_b_symbol) AS symbol
      FROM trade_events
      WHERE event_type IN ('swap', 'buy')
        AND UPPER(token_b_symbol) = ANY($1)
    `, [ALLOWED_TOKENS]);

    const tokens = (result.rows || []).map(r => r.symbol);
    const performers = [];

    for (const sym of tokens) {
      const priceResult = await db.query(`
        SELECT
          (SELECT price FROM trade_events WHERE UPPER(token_b_symbol) = $1 AND event_type IN ('swap','buy') ORDER BY created_at DESC LIMIT 1) AS latest,
          (SELECT price FROM trade_events WHERE UPPER(token_b_symbol) = $1 AND event_type IN ('swap','buy') ORDER BY created_at ASC LIMIT 1) AS earliest,
          (SELECT COALESCE(SUM(amount_in), 0) FROM trade_events WHERE UPPER(token_b_symbol) = $1 AND created_at >= NOW() - INTERVAL '24 hours') AS vol24h,
          (SELECT COUNT(*) FROM trade_events WHERE UPPER(token_b_symbol) = $1 AND created_at >= NOW() - INTERVAL '24 hours') AS trades24h
      `, [sym]);
      const pr = priceResult.rows[0] || {};
      const latest = parseFloat(pr.latest) || 0;
      const earliest = parseFloat(pr.earliest) || 0;
      const change = earliest > 0 ? ((latest - earliest) / earliest * 100) : 0;
      performers.push({
        symbol: sym,
        price: latest,
        change24h: parseFloat(change.toFixed(2)),
        volume24h: parseFloat(pr.vol24h) || 0,
        trades24h: parseInt(pr.trades24h) || 0,
      });
    }

    return performers;
  }

  async getTrendingPairs() {
    const result = await db.query(`
      SELECT
        UPPER(token_a_symbol) AS token_a,
        UPPER(token_b_symbol) AS token_b,
        COUNT(*) AS swaps,
        COALESCE(SUM(amount_in), 0) AS volume,
        (ARRAY_AGG(price ORDER BY created_at DESC))[1] AS latest_price,
        (ARRAY_AGG(price ORDER BY created_at ASC))[1] AS earliest_price
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND event_type IN ('swap', 'buy')
      GROUP BY UPPER(token_a_symbol), UPPER(token_b_symbol)
      ORDER BY volume DESC
      LIMIT 10
    `, []);

    return (result.rows || []).map(r => {
      const latest = parseFloat(r.latest_price) || 0;
      const earliest = parseFloat(r.earliest_price) || 0;
      const change = earliest > 0 ? ((latest - earliest) / earliest * 100) : 0;
      return {
        pair: `${r.token_a}/${r.token_b}`,
        price: latest,
        change: parseFloat(change.toFixed(2)),
        volume: parseFloat(r.volume) || 0,
        swaps: parseInt(r.swaps) || 0,
      };
    });
  }

  async getPriceTrends(tokenIds, period) {
    const ALLOWED_TOKENS = ['ntc','asdc','edc','rdc','dmc','bdc','ydc','sdc','cdc','adc','sgdc'];
    const filteredIds = tokenIds.filter(t => ALLOWED_TOKENS.includes(t.toLowerCase()));
    const intervals = { week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.week;
    const truncUnit = period === 'week' ? 'hour' : period === 'month' ? 'day' : 'week';

    const bucketsResult = await db.query(`
      SELECT DISTINCT
        date_trunc('${truncUnit}', created_at) AS bucket,
        to_char(date_trunc('${truncUnit}', created_at), 'Mon DD HH24:MI') AS label
      FROM trade_events
      WHERE event_type IN ('swap', 'buy')
        AND created_at >= NOW() - INTERVAL '${interval}'
      ORDER BY bucket ASC
    `, []);
    const allBuckets = (bucketsResult.rows || []).map(r => ({ bucket: r.bucket, label: r.label }));

    const results = {};
    for (const tid of filteredIds) {
      const r = await db.query(`
        SELECT
          date_trunc('${truncUnit}', created_at) AS bucket,
          to_char(date_trunc('${truncUnit}', created_at), 'Mon DD HH24:MI') AS label,
          (ARRAY_AGG(price ORDER BY created_at DESC))[1] AS close_price
        FROM trade_events
        WHERE LOWER(token_b_symbol) = LOWER($1)
          AND event_type IN ('swap', 'buy')
          AND created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY date_trunc('${truncUnit}', created_at)
        ORDER BY date_trunc('${truncUnit}', created_at) ASC
      `, [tid]);

      const priceMap = {};
      for (const row of (r.rows || [])) {
        priceMap[row.bucket] = parseFloat(row.close_price) || 0;
      }

      let lastPrice = 0;
      results[tid.toLowerCase()] = allBuckets.map(b => {
        const price = priceMap[b.bucket] !== undefined ? priceMap[b.bucket] : lastPrice;
        lastPrice = price;
        return { label: b.label, price };
      });
    }

    return results;
  }

  async getFeesBreakdown(period) {
    const intervals = { day: '1 day', week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.all;
    const feeTier = 0.30;

    const result = await db.query(`
      SELECT
        UPPER(token_a_symbol) || '/' || UPPER(token_b_symbol) AS pair,
        UPPER(token_a_symbol) AS token_a,
        UPPER(token_b_symbol) AS token_b,
        COALESCE(SUM(amount_in), 0) AS volume,
        COUNT(*) AS trades
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '${interval}'
        AND event_type IN ('swap', 'buy')
      GROUP BY UPPER(token_a_symbol), UPPER(token_b_symbol)
      ORDER BY volume DESC
    `, []);

    return (result.rows || []).map(r => {
      const vol = parseFloat(r.volume) || 0;
      return {
        pair: r.pair,
        tokenA: r.token_a,
        tokenB: r.token_b,
        volume: vol,
        fees: vol * feeTier / 100,
        trades: parseInt(r.trades) || 0,
      };
    });
  }

  async getFullAdminData(period = 'all') {
    const cacheKey = `admin:full:${period}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const [platformStats, volumeOverTime, tradeActivity, volumeByToken, topPerformers, trendingPairs, trendingSwapsStats] = await Promise.all([
      this.getPlatformStats(period),
      this.getVolumeOverTime(period),
      this.getTradeActivity(period),
      this.getVolumeByToken(period),
      this.getTopPerformers(),
      this.getTrendingPairs(),
      this.getTrendingSwapsStats(),
    ]);

    const data = {
      platformStats,
      volumeOverTime,
      tradeActivity,
      volumeByToken,
      topPerformers,
      trendingPairs,
      trendingSwapsStats,
    };

    if (this.cache) {
      await this.cache.set(cacheKey, data, 30);
    }

    return data;
  }
}

module.exports = AdminService;
