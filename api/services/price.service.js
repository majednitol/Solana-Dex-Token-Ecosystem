'use strict';

const db = require('../db/init');

const DEFAULT_MIN_VOLUME = 0;

class PriceService {
  constructor({ cacheService, minVolumeThreshold }) {
    this.cache = cacheService || null;
    this.minVolumeThreshold = minVolumeThreshold ?? DEFAULT_MIN_VOLUME;
  }

  async savePrice({ tokenSymbol, tokenMint, pairSymbol, pairMint, poolAddress, price, liquidity, source, volume }) {
    if (!price || price <= 0) return null;

    const result = await db.query(
      `INSERT INTO token_prices (token_symbol, token_mint, pair_symbol, pair_mint, pool_address, price, liquidity, source, volume)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tokenSymbol || '',
        tokenMint || '',
        pairSymbol || '',
        pairMint || '',
        poolAddress || '',
        price,
        String(liquidity || '0'),
        source || 'pool',
        volume || 0,
      ]
    );

    const row = result.rows[0];

    if (this.cache) {
      this.cache.publishPricesUpdate({
        type: 'price_update',
        tokenSymbol,
        pairSymbol,
        price,
        source,
      });
    }

    return row;
  }

  async getLatestPrice(tokenSymbol, pairSymbol) {
    const cacheKey = `oracle:latest:${tokenSymbol}:${pairSymbol || 'any'}`;
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    let sql, params;
    if (pairSymbol) {
      sql = `SELECT * FROM token_prices WHERE token_symbol = $1 AND pair_symbol = $2 ORDER BY created_at DESC LIMIT 1`;
      params = [tokenSymbol, pairSymbol];
    } else {
      sql = `SELECT * FROM token_prices WHERE token_symbol = $1 ORDER BY created_at DESC LIMIT 1`;
      params = [tokenSymbol];
    }

    const result = await db.query(sql, params);
    const row = result.rows[0] || null;

    if (row && this.cache) {
      await this.cache.set(cacheKey, row, 30);
    }

    return row;
  }

  async getLatestPrices() {
    const cacheKey = 'oracle:latest:all';
    if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;
    }

    const result = await db.query(
      `SELECT DISTINCT ON (token_symbol, pair_symbol)
         token_symbol, token_mint, pair_symbol, pair_mint, pool_address, price, liquidity, source, volume, created_at
       FROM token_prices
       ORDER BY token_symbol, pair_symbol, created_at DESC`
    );

    const prices = result.rows;
    if (this.cache) {
      await this.cache.set(cacheKey, prices, 30);
    }

    return prices;
  }

  async getHistoricalPrices(token, days) {
    const daysNum = Number(days) || 30;
    const cutoff = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const result = await db.query(
      `SELECT * FROM token_prices WHERE token_symbol = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 2000`,
      [token, cutoff]
    );
    return result.rows;
  }

  async getHistoricalPricesFiltered({ tokenSymbol, pairSymbol, from, to, limit, offset }) {
    let sql = 'SELECT * FROM token_prices WHERE token_symbol = $1';
    const params = [tokenSymbol];
    let idx = 2;

    if (pairSymbol) {
      sql += ` AND pair_symbol = $${idx}`;
      params.push(pairSymbol);
      idx++;
    }
    if (from) {
      sql += ` AND created_at >= $${idx}`;
      params.push(new Date(from));
      idx++;
    }
    if (to) {
      sql += ` AND created_at <= $${idx}`;
      params.push(new Date(to));
      idx++;
    }

    sql += ' ORDER BY created_at DESC';

    const lim = Math.min(Number(limit) || 500, 2000);
    const off = Number(offset) || 0;
    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(lim, off);

    const result = await db.query(sql, params);
    return result.rows;
  }

  async get365DayAveragePrice(token) {
    return this._computeFilteredAverage(token, undefined, 365);
  }

  async getVwap({ tokenSymbol, pairSymbol, days }) {
    return this._computeFilteredAverage(tokenSymbol, pairSymbol, days);
  }

  async _computeFilteredAverage(tokenSymbol, pairSymbol, days) {
    const daysNum = Number(days) || 365;
    const cutoff = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    let sql, params;
    if (pairSymbol) {
      sql = `SELECT price, volume, liquidity, created_at
             FROM token_prices
             WHERE token_symbol = $1 AND pair_symbol = $2 AND created_at >= $3
             ORDER BY created_at ASC`;
      params = [tokenSymbol, pairSymbol, cutoff];
    } else {
      sql = `SELECT price, volume, liquidity, created_at
             FROM token_prices
             WHERE token_symbol = $1 AND created_at >= $2
             ORDER BY created_at ASC`;
      params = [tokenSymbol, cutoff];
    }

    const result = await db.query(sql, params);
    const rows = result.rows;

    if (rows.length === 0) {
      return { vwap: 0, dataPoints: 0, days: daysNum, filtered: 0 };
    }

    const prices = rows.map(r => r.price);
    const rollingMedian = this._rollingMedian(prices, Math.min(20, Math.floor(prices.length / 2) || 1));

    let weightedSum = 0;
    let totalWeight = 0;
    let filtered = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const median = rollingMedian[i];

      if (median > 0 && Math.abs(row.price - median) / median > 0.30) {
        filtered++;
        continue;
      }

      const volume = parseFloat(row.volume) || 0;
      if (this.minVolumeThreshold > 0 && volume < this.minVolumeThreshold) {
        filtered++;
        continue;
      }

      const weight = Math.max(volume, 1);
      weightedSum += row.price * weight;
      totalWeight += weight;
    }

    const vwap = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const included = rows.length - filtered;

    return {
      vwap,
      dataPoints: rows.length,
      included,
      days: daysNum,
      filtered,
      median: this._median(prices),
    };
  }

  _rollingMedian(arr, windowSize) {
    const result = new Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      const start = Math.max(0, i - windowSize);
      const end = i + 1;
      const window = arr.slice(start, end);
      result[i] = this._median(window);
    }
    return result;
  }

  _median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  async get24hVolume(tokenSymbol) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const result = await db.query(
      `SELECT COALESCE(SUM(amount_in), 0) as volume
       FROM trade_events
       WHERE (token_a_symbol = $1 OR token_b_symbol = $1) AND created_at >= $2`,
      [tokenSymbol, cutoff]
    );
    return parseFloat(result.rows[0]?.volume) || 0;
  }

  async getRecentSwapPrices(limit) {
    const lim = Math.min(Number(limit) || 100, 500);
    const result = await db.query(
      `SELECT token_a_symbol, token_b_symbol, token_a_mint, token_b_mint,
              amount_in, amount_out, price, pool_address, created_at
       FROM trade_events
       WHERE event_type = 'swap' AND amount_in > 0 AND amount_out > 0
       ORDER BY created_at DESC
       LIMIT $1`,
      [lim]
    );
    return result.rows;
  }

  async pruneOldPrices(retentionDays = 400) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await db.query(
      `DELETE FROM token_prices WHERE created_at < $1`,
      [cutoff]
    );
    return result.rows?.length || 0;
  }
}

module.exports = { PriceService };
