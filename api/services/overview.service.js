'use strict';

const db = require('../db/init');

class OverviewService {
  async registerWallet(wallet) {
    if (!wallet || wallet.length < 32) return;
    await db.query(`
      INSERT INTO user_wallets (wallet, first_seen, last_seen)
      VALUES ($1, NOW(), NOW())
      ON CONFLICT (wallet) DO UPDATE SET last_seen = NOW()
    `, [wallet]);
  }

  async recordVisit({ sessionId, wallet, page, source }) {
    const VALID_PAGES = ['/', '/exchange', '/swap', '/markets', '/assets', '/docs', '/community',
      '/announcements', '/support', '/buy', '/api', '/get-listed', '/saved', '/settings', '/admin'];
    const VALID_SOURCES = ['search', 'direct'];

    const cleanPage = VALID_PAGES.includes(page) ? page : '/';
    const cleanSource = VALID_SOURCES.includes(source) ? source : 'direct';
    const cleanWallet = (wallet && /^[A-Za-z0-9]{32,64}$/.test(wallet)) ? wallet : '';
    const cleanSession = (sessionId || '').slice(0, 64);

    await db.query(`
      INSERT INTO page_visits (session_id, wallet, page, source, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, [cleanSession, cleanWallet, cleanPage, cleanSource]);
  }

  async getReferralData(period) {
    const config = {
      week:  { interval: '7 days',   trunc: 'day',   fmt: 'Dy' },
      month: { interval: '30 days',  trunc: 'week',  fmt: '"Wk " W' },
      year:  { interval: '365 days', trunc: 'month', fmt: 'Mon' },
      all:   { interval: '3650 days', trunc: 'month', fmt: 'Mon' },
    };
    const c = config[period] || config.all;

    const result = await db.query(`
      SELECT
        to_char(date_trunc('${c.trunc}', created_at), '${c.fmt}') AS label,
        COUNT(*) AS value
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '${c.interval}'
        AND event_type IN ('swap', 'buy')
      GROUP BY date_trunc('${c.trunc}', created_at), label
      ORDER BY date_trunc('${c.trunc}', created_at) ASC
    `, []);

    return (result.rows || []).map(r => ({
      month: r.label ? r.label.trim() : '',
      value: parseInt(r.value) || 0,
    }));
  }

  async getTrafficData(period) {
    const config = {
      week:  { interval: '7 days',   trunc: 'day',   fmt: 'Dy' },
      month: { interval: '30 days',  trunc: 'week',  fmt: '"Wk " W' },
      year:  { interval: '365 days', trunc: 'month', fmt: 'Mon' },
      all:   { interval: '3650 days', trunc: 'month', fmt: 'Mon' },
    };
    const c = config[period] || config.all;

    const result = await db.query(`
      SELECT
        to_char(date_trunc('${c.trunc}', created_at), '${c.fmt}') AS label,
        COUNT(*) FILTER (WHERE source = 'search') AS search,
        COUNT(*) FILTER (WHERE source = 'direct') AS direct
      FROM page_visits
      WHERE created_at >= NOW() - INTERVAL '${c.interval}'
      GROUP BY date_trunc('${c.trunc}', created_at), label
      ORDER BY date_trunc('${c.trunc}', created_at) ASC
    `, []);

    return (result.rows || []).map(r => ({
      month: r.label ? r.label.trim() : '',
      search: parseInt(r.search) || 0,
      direct: parseInt(r.direct) || 0,
    }));
  }

  async getWeeklyData(period) {
    const config = {
      week:  { interval: '7 days',   trunc: 'day',   fmt: 'Dy' },
      month: { interval: '30 days',  trunc: 'week',  fmt: '"Wk " W' },
      year:  { interval: '365 days', trunc: 'month', fmt: 'Mon' },
      all:   { interval: '3650 days', trunc: 'month', fmt: 'Mon' },
    };
    const c = config[period] || config.all;

    const result = await db.query(`
      WITH session_first AS (
        SELECT session_id, MIN(created_at) AS first_visit
        FROM page_visits
        GROUP BY session_id
      )
      SELECT
        to_char(date_trunc('${c.trunc}', pv.created_at), '${c.fmt}') AS label,
        COUNT(DISTINCT CASE
          WHEN sf.first_visit >= date_trunc('${c.trunc}', pv.created_at)
           AND sf.first_visit < date_trunc('${c.trunc}', pv.created_at) + INTERVAL '1 ${c.trunc}'
          THEN pv.session_id END) AS new_visitors,
        COUNT(DISTINCT CASE
          WHEN sf.first_visit < date_trunc('${c.trunc}', pv.created_at)
          THEN pv.session_id END) AS returning
      FROM page_visits pv
      JOIN session_first sf ON sf.session_id = pv.session_id
      WHERE pv.created_at >= NOW() - INTERVAL '${c.interval}'
      GROUP BY date_trunc('${c.trunc}', pv.created_at), label
      ORDER BY date_trunc('${c.trunc}', pv.created_at) ASC
    `, []);

    return (result.rows || []).map(r => ({
      day: r.label ? r.label.trim() : '',
      newVisitors: parseInt(r.new_visitors) || 0,
      returning: parseInt(r.returning) || 0,
    }));
  }

  async getMostViewed(period) {
    const ALLOWED_TOKENS = ['NTC','ASDC','EDC','RDC','DMC','BDC','YDC','SDC','CDC','ADC','SGDC'];
    const intervals = { week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.all;
    const result = await db.query(`
      SELECT
        UPPER(token_b_symbol) AS name,
        COALESCE(SUM(amount_in), 0) AS value
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '${interval}'
        AND event_type IN ('swap', 'buy')
        AND UPPER(token_b_symbol) = ANY($1)
      GROUP BY UPPER(token_b_symbol)
      ORDER BY value DESC
    `, [ALLOWED_TOKENS]);

    const rowMap = {};
    for (const r of (result.rows || [])) {
      rowMap[r.name] = { name: r.name, value: parseFloat(r.value) || 0 };
    }
    return ALLOWED_TOKENS.map(sym => rowMap[sym] || { name: sym, value: 0 });
  }

  async getMostViewedVolume24h() {
    const result = await db.query(`
      SELECT COALESCE(SUM(amount_in), 0) AS total
      FROM trade_events
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND event_type IN ('swap', 'buy')
    `, []);
    return parseFloat((result.rows[0] || {}).total) || 0;
  }

  async getPlatformStats(period) {
    const intervals = { week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.all;
    const halfInterval = period === 'week' ? '14 days' : period === 'month' ? '60 days' : period === 'year' ? '730 days' : '7300 days';

    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM user_wallets WHERE first_seen >= NOW() - INTERVAL '${interval}') AS total_users,
        (SELECT COUNT(*) FROM user_wallets WHERE first_seen >= NOW() - INTERVAL '${halfInterval}' AND first_seen < NOW() - INTERVAL '${interval}') AS prev_users,
        (SELECT COALESCE(SUM(amount_in), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${interval}' AND event_type IN ('swap', 'buy')) AS total_volume,
        (SELECT COALESCE(SUM(amount_in), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}' AND event_type IN ('swap', 'buy')) AS prev_volume,
        (SELECT COUNT(*) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${interval}') AS total_trades,
        (SELECT COUNT(*) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}') AS prev_trades,
        (SELECT COALESCE(SUM(CASE WHEN event_type = 'add_liquidity' THEN amount_in WHEN event_type = 'remove_liquidity' THEN -amount_in ELSE 0 END), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${interval}') AS tvl,
        (SELECT COALESCE(SUM(CASE WHEN event_type = 'add_liquidity' THEN amount_in WHEN event_type = 'remove_liquidity' THEN -amount_in ELSE 0 END), 0) FROM trade_events WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}') AS prev_tvl
    `, []);

    const row = result.rows[0] || {};
    const totalUsers = parseInt(row.total_users) || 0;
    const prevUsers = parseInt(row.prev_users) || 0;
    const totalVolume = parseFloat(row.total_volume) || 0;
    const prevVolume = parseFloat(row.prev_volume) || 0;
    const feeTier = 0.30;
    const totalFees = totalVolume * feeTier / 100;
    const prevFees = prevVolume * feeTier / 100;
    const totalTVL = parseFloat(row.tvl) || 0;
    const prevTVL = parseFloat(row.prev_tvl) || 0;

    const pctChange = (curr, prev) => prev > 0 ? parseFloat(((curr - prev) / prev * 100).toFixed(2)) : (curr > 0 ? 100 : 0);

    return {
      totalUsers,
      usersChange: pctChange(totalUsers, prevUsers),
      totalVolume,
      volumeChange: pctChange(totalVolume, prevVolume),
      totalFees,
      feesChange: pctChange(totalFees, prevFees),
      totalTVL,
      tvlChange: pctChange(totalTVL, prevTVL),
    };
  }

  async getVisitStats(period) {
    const intervals = { week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.all;
    const halfInterval = period === 'week' ? '14 days' : period === 'month' ? '60 days' : period === 'year' ? '730 days' : '7300 days';

    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM page_visits WHERE created_at >= NOW() - INTERVAL '${interval}') AS page_views,
        (SELECT COUNT(*) FROM page_visits WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}') AS prev_page_views,
        (SELECT COUNT(DISTINCT wallet) FROM page_visits WHERE created_at >= NOW() - INTERVAL '${interval}' AND wallet != '') AS unique_visitors,
        (SELECT COUNT(DISTINCT wallet) FROM page_visits WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}' AND wallet != '') AS prev_unique_visitors
    `, []);

    const row = result.rows[0] || {};
    const pageViews = parseInt(row.page_views) || 0;
    const prevPageViews = parseInt(row.prev_page_views) || 0;
    const uniqueVisitors = parseInt(row.unique_visitors) || 0;
    const prevUniqueVisitors = parseInt(row.prev_unique_visitors) || 0;

    const bounceResult = await db.query(`
      WITH session_pages AS (
        SELECT session_id, COUNT(DISTINCT page) AS page_count
        FROM page_visits
        WHERE created_at >= NOW() - INTERVAL '${interval}' AND session_id != ''
        GROUP BY session_id
      )
      SELECT
        COUNT(*) AS total_sessions,
        COUNT(*) FILTER (WHERE page_count = 1) AS single_page_sessions
      FROM session_pages
    `, []);

    const bounceRow = bounceResult.rows[0] || {};
    const totalSessions = parseInt(bounceRow.total_sessions) || 0;
    const singlePageSessions = parseInt(bounceRow.single_page_sessions) || 0;
    const bounceRate = totalSessions > 0 ? parseFloat((singlePageSessions / totalSessions * 100).toFixed(1)) : 0;

    const prevBounceResult = await db.query(`
      WITH session_pages AS (
        SELECT session_id, COUNT(DISTINCT page) AS page_count
        FROM page_visits
        WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}' AND session_id != ''
        GROUP BY session_id
      )
      SELECT
        COUNT(*) AS total_sessions,
        COUNT(*) FILTER (WHERE page_count = 1) AS single_page_sessions
      FROM session_pages
    `, []);

    const prevBounceRow = prevBounceResult.rows[0] || {};
    const prevTotalSessions = parseInt(prevBounceRow.total_sessions) || 0;
    const prevSinglePageSessions = parseInt(prevBounceRow.single_page_sessions) || 0;
    const prevBounceRate = prevTotalSessions > 0 ? parseFloat((prevSinglePageSessions / prevTotalSessions * 100).toFixed(1)) : 0;

    const avgSessionResult = await db.query(`
      SELECT AVG(duration) AS avg_duration FROM (
        SELECT session_id, EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) AS duration
        FROM page_visits
        WHERE created_at >= NOW() - INTERVAL '${interval}' AND session_id != ''
        GROUP BY session_id
        HAVING COUNT(*) > 1
      ) sub
    `, []);

    const avgDurationSec = parseFloat((avgSessionResult.rows[0] || {}).avg_duration) || 0;
    const avgMinutes = Math.floor(avgDurationSec / 60);
    const avgSeconds = Math.floor(avgDurationSec % 60);

    const prevAvgSessionResult = await db.query(`
      SELECT AVG(duration) AS avg_duration FROM (
        SELECT session_id, EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) AS duration
        FROM page_visits
        WHERE created_at >= NOW() - INTERVAL '${halfInterval}' AND created_at < NOW() - INTERVAL '${interval}' AND session_id != ''
        GROUP BY session_id
        HAVING COUNT(*) > 1
      ) sub
    `, []);

    const prevAvgDurationSec = parseFloat((prevAvgSessionResult.rows[0] || {}).avg_duration) || 0;

    const pctChange = (curr, prev) => prev > 0 ? parseFloat(((curr - prev) / prev * 100).toFixed(1)) : (curr > 0 ? 100 : 0);

    return {
      pageViews,
      pageViewsChange: pctChange(pageViews, prevPageViews),
      uniqueVisitors,
      uniqueVisitorsChange: pctChange(uniqueVisitors, prevUniqueVisitors),
      avgSession: `${avgMinutes}m ${avgSeconds}s`,
      avgSessionChange: pctChange(avgDurationSec, prevAvgDurationSec),
      bounceRate,
      bounceRateChange: parseFloat((prevBounceRate - bounceRate).toFixed(1)),
    };
  }

  async getPageViewsOverTime(period) {
    const config = {
      week:  { interval: '7 days',   trunc: 'day',   fmt: 'Dy' },
      month: { interval: '30 days',  trunc: 'week',  fmt: '"Wk " W' },
      year:  { interval: '365 days', trunc: 'month', fmt: 'Mon' },
      all:   { interval: '3650 days', trunc: 'month', fmt: 'Mon' },
    };
    const c = config[period] || config.all;

    const result = await db.query(`
      SELECT
        to_char(date_trunc('${c.trunc}', created_at), '${c.fmt}') AS label,
        COUNT(*) AS views
      FROM page_visits
      WHERE created_at >= NOW() - INTERVAL '${c.interval}'
      GROUP BY date_trunc('${c.trunc}', created_at), label
      ORDER BY date_trunc('${c.trunc}', created_at) ASC
    `, []);

    return (result.rows || []).map(r => ({
      d: r.label ? r.label.trim() : '',
      views: parseInt(r.views) || 0,
    }));
  }

  async getTopPages(period) {
    const intervals = { week: '7 days', month: '30 days', year: '365 days', all: '3650 days' };
    const interval = intervals[period] || intervals.all;

    const result = await db.query(`
      SELECT
        page,
        COUNT(*) AS views
      FROM page_visits
      WHERE created_at >= NOW() - INTERVAL '${interval}'
      GROUP BY page
      ORDER BY views DESC
      LIMIT 10
    `, []);

    const rows = result.rows || [];
    const totalViews = rows.reduce((s, r) => s + (parseInt(r.views) || 0), 0);

    const PAGE_NAMES = {
      '/': 'Home', '/exchange': 'Exchange', '/swap': 'Swap', '/markets': 'Markets',
      '/assets': 'Assets', '/docs': 'WhitePaper', '/community': 'Community',
      '/announcements': 'Announcements', '/support': 'Support', '/buy': 'Buy Tokens',
      '/api': 'API', '/get-listed': 'Get Listed', '/saved': 'Saved',
      '/settings': 'Settings', '/admin': 'Admin',
    };

    return rows.map(r => {
      const views = parseInt(r.views) || 0;
      return {
        page: PAGE_NAMES[r.page] || r.page,
        views,
        pct: totalViews > 0 ? parseFloat((views / totalViews * 100).toFixed(1)) : 0,
      };
    });
  }

  async getTopBarStats() {
    const result = await db.query(`
      WITH latest_prices AS (
        SELECT DISTINCT ON (LOWER(token_symbol))
          LOWER(token_symbol) AS token_symbol_lc, price
        FROM token_prices
        ORDER BY LOWER(token_symbol), created_at DESC
      ),
      prices_24h_ago AS (
        SELECT DISTINCT ON (LOWER(token_symbol))
          LOWER(token_symbol) AS token_symbol_lc, price
        FROM token_prices
        WHERE created_at <= NOW() - INTERVAL '24 hours'
        ORDER BY LOWER(token_symbol), created_at DESC
      )
      SELECT
        (SELECT COUNT(*) FROM tokens) AS token_count,
        COALESCE(SUM(
          (CAST(t.supply AS DOUBLE PRECISION) / POWER(10, t.decimals)) *
          COALESCE(lp.price, 0)
        ), 0) AS market_cap,
        COALESCE(SUM(
          (CAST(t.supply AS DOUBLE PRECISION) / POWER(10, t.decimals)) *
          COALESCE(p24.price, 0)
        ), 0) AS market_cap_24h_ago,
        (SELECT COALESCE(SUM(amount_in), 0)
         FROM trade_events
         WHERE created_at >= NOW() - INTERVAL '24 hours'
           AND event_type IN ('swap', 'buy')) AS volume_24h
      FROM tokens t
      LEFT JOIN latest_prices lp ON lp.token_symbol_lc = LOWER(t.symbol)
      LEFT JOIN prices_24h_ago p24 ON p24.token_symbol_lc = LOWER(t.symbol)
    `, []);

    const row = result.rows[0] || {};
    const tokenCount = parseInt(row.token_count) || 0;
    const volume24h = parseFloat(row.volume_24h) || 0;
    let marketCap = parseFloat(row.market_cap) || 0;
    let marketCap24hAgo = parseFloat(row.market_cap_24h_ago) || 0;

    if (marketCap === 0 && tokenCount > 0) {
      console.warn(`[Overview] Primary top-bar query returned zero market cap for ${tokenCount} tokens — using fallback`);
      marketCap = 0;
      marketCap24hAgo = 0;
      try {
        const fallbackResult = await db.query(`
          WITH fb_latest AS (
            SELECT DISTINCT ON (LOWER(token_symbol))
              LOWER(token_symbol) AS sym, price
            FROM token_prices
            WHERE price > 0
            ORDER BY LOWER(token_symbol), created_at DESC
          ),
          fb_24h AS (
            SELECT DISTINCT ON (LOWER(token_symbol))
              LOWER(token_symbol) AS sym, price
            FROM token_prices
            WHERE price > 0 AND created_at <= NOW() - INTERVAL '24 hours'
            ORDER BY LOWER(token_symbol), created_at DESC
          )
          SELECT t.supply, t.decimals, fl.price AS latest_price, f24.price AS price_24h
          FROM tokens t
          INNER JOIN fb_latest fl ON fl.sym = LOWER(t.symbol)
          LEFT JOIN fb_24h f24 ON f24.sym = LOWER(t.symbol)
        `, []);
        for (const r of fallbackResult.rows) {
          const decimals = parseInt(r.decimals);
          const humanSupply = parseFloat(r.supply) / Math.pow(10, Number.isFinite(decimals) ? decimals : 5);
          marketCap += humanSupply * (parseFloat(r.latest_price) || 0);
          marketCap24hAgo += humanSupply * (parseFloat(r.price_24h) || 0);
        }
      } catch (e) {
        console.warn('[Overview] Fallback market cap computation failed:', e.message.substring(0, 80));
      }
    }

    const marketCapChange24h = marketCap24hAgo > 0
      ? parseFloat(((marketCap - marketCap24hAgo) / marketCap24hAgo * 100).toFixed(2))
      : 0;

    return { tokenCount, marketCap, volume24h, marketCapChange24h };
  }

  async getAggregated(period) {
    const [referralData, trafficData, weeklyData, mostViewedData, platformStats, volume24h, visitStats, pageViewsOverTime, topPages] = await Promise.all([
      this.getReferralData(period),
      this.getTrafficData(period),
      this.getWeeklyData(period),
      this.getMostViewed(period),
      this.getPlatformStats(period),
      this.getMostViewedVolume24h(),
      this.getVisitStats(period),
      this.getPageViewsOverTime(period),
      this.getTopPages(period),
    ]);

    const referralTotal = referralData.reduce((s, d) => s + d.value, 0);
    const referralHalf = Math.floor(referralData.length / 2);
    const recentHalf = referralData.slice(referralHalf).reduce((s, d) => s + d.value, 0);
    const earlierHalf = referralData.slice(0, referralHalf).reduce((s, d) => s + d.value, 0);
    const referralChange = earlierHalf > 0 ? parseFloat(((recentHalf - earlierHalf) / earlierHalf * 100).toFixed(1)) : (recentHalf > 0 ? 100 : 0);

    return {
      referralData,
      referralTotal,
      referralChange,
      trafficData,
      weeklyData,
      mostViewedData,
      volume24h,
      platformStats,
      visitStats,
      pageViewsOverTime,
      topPages,
    };
  }
}

module.exports = OverviewService;
