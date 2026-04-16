'use strict';

const db = require('./init');

const ALL_TOKENS = ['NTC', 'ASDC', 'EDC', 'RDC', 'DMC', 'BDC', 'YDC', 'SDC', 'CDC', 'ADC', 'SGDC'];

const TOKEN_PRICES = {
  NTC: 1.00, ASDC: 1.00, EDC: 1.08, RDC: 0.20, DMC: 1.00,
  BDC: 1.26, YDC: 0.14, SDC: 1.12, CDC: 0.70, ADC: 0.63, SGDC: 0.75,
};

const ORIGINAL_SWAP_VOLUME = {
  NTC: 45200, ASDC: 32100, EDC: 28400, DMC: 18700, BDC: 15200,
  YDC: 9800, SDC: 7600, CDC: 5100, ADC: 3400, SGDC: 2800,
  RDC: 4000,
};

const ORIGINAL_REFERRAL_DATA = [
  { month: 'Jan', value: 20 }, { month: 'Feb', value: 35 }, { month: 'Mar', value: 25 },
  { month: 'Apr', value: 45 }, { month: 'May', value: 30 }, { month: 'Jun', value: 80 },
  { month: 'Jul', value: 120 }, { month: 'Aug', value: 60 }, { month: 'Sep', value: 45 },
  { month: 'Oct', value: 55 }, { month: 'Nov', value: 70 },
];

const ORIGINAL_TRAFFIC_DATA = {
  Jan: { search: 30, direct: 25 }, Feb: { search: 45, direct: 35 },
  Mar: { search: 35, direct: 30 }, Apr: { search: 55, direct: 40 },
  May: { search: 40, direct: 35 }, Jun: { search: 70, direct: 55 },
  Jul: { search: 90, direct: 70 }, Aug: { search: 65, direct: 50 },
  Sep: { search: 50, direct: 40 }, Oct: { search: 60, direct: 48 },
  Nov: { search: 75, direct: 58 },
};

const ORIGINAL_PAGE_VIEWS = [
  { d: 'Jan', views: 3200 }, { d: 'Feb', views: 3800 }, { d: 'Mar', views: 4100 },
  { d: 'Apr', views: 3600 }, { d: 'May', views: 4800 }, { d: 'Jun', views: 5200 },
  { d: 'Jul', views: 5800 }, { d: 'Aug', views: 5100 }, { d: 'Sep', views: 4900 },
  { d: 'Oct', views: 5500 }, { d: 'Nov', views: 6200 },
];

const ORIGINAL_TOP_PAGES = [
  { page: '/exchange', views: 18420, pct: 38.2 },
  { page: '/', views: 12800, pct: 26.6 },
  { page: '/markets', views: 8100, pct: 16.8 },
  { page: '/buy', views: 4200, pct: 8.7 },
  { page: '/assets', views: 2800, pct: 5.8 },
  { page: '/docs', views: 1900, pct: 3.9 },
];

const ORIGINAL_PRICE_TRENDS = {
  asdc: [1.02, 1.05, 1.01, 1.08, 1.12, 1.10, 1.15],
  edc: [0.88, 0.91, 0.95, 0.93, 0.97, 1.01, 0.99],
  dmc: [0.65, 0.63, 0.67, 0.70, 0.68, 0.72, 0.71],
};

const ORIGINAL_TRENDING_PAIRS = [
  { tokenA: 'NTC', tokenB: 'ASDC', price: 1.02, change: 5.24, vol: 32100, swaps: 412 },
  { tokenA: 'NTC', tokenB: 'EDC', price: 0.91, change: 8.42, vol: 28400, swaps: 387 },
  { tokenA: 'NTC', tokenB: 'DMC', price: 0.67, change: -1.35, vol: 18700, swaps: 245 },
  { tokenA: 'NTC', tokenB: 'BDC', price: 0.82, change: 2.10, vol: 15200, swaps: 198 },
  { tokenA: 'NTC', tokenB: 'YDC', price: 0.0073, change: -3.18, vol: 9800, swaps: 156 },
];

const MONTH_OFFSETS = { Jan: 10, Feb: 9, Mar: 8, Apr: 7, May: 6, Jun: 5, Jul: 4, Aug: 3, Sep: 2, Oct: 1, Nov: 0 };

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function seedAnalytics() {
  console.log('[Seed] Starting deterministic analytics seed (batched)...');
  const rand = seededRandom(42);

  const wallets = [];
  for (let i = 0; i < 120; i++) {
    wallets.push(('SeedWallet' + String(i).padStart(4, '0')).padEnd(44, 'A'));
  }

  console.log('[Seed] Inserting user_wallets (batched)...');
  const walletData = [];
  for (let i = 0; i < wallets.length; i++) {
    const daysAgo = Math.floor(rand() * 330) + 1;
    walletData.push({ wallet: wallets[i], daysAgo, lastDaysAgo: Math.max(0, daysAgo - 15) });
  }
  const WALLET_CHUNK = 60;
  for (let i = 0; i < walletData.length; i += WALLET_CHUNK) {
    const chunk = walletData.slice(i, i + WALLET_CHUNK);
    const placeholders = [];
    const values = [];
    let idx = 1;
    for (const w of chunk) {
      placeholders.push(`($${idx++}, NOW() - INTERVAL '${w.daysAgo} days', NOW() - INTERVAL '${w.lastDaysAgo} days')`);
      values.push(w.wallet);
    }
    await db.query(
      `INSERT INTO user_wallets (wallet, first_seen, last_seen) VALUES ${placeholders.join(',')} ON CONFLICT (wallet) DO NOTHING`,
      values
    );
  }

  const tradeRows = [];
  function addTrade(tokenA, tokenB, amountIn, amountOut, price, wallet, daysAgo, hoursAgo) {
    tradeRows.push(['swap', tokenA, tokenB, amountIn, amountOut, price, wallet, daysAgo, hoursAgo]);
  }

  console.log('[Seed] Generating trade_events from original swap volume data...');
  for (const [symbol, totalVol] of Object.entries(ORIGINAL_SWAP_VOLUME)) {
    const tradeCount = Math.max(10, Math.floor(totalVol / 200));
    const perTrade = totalVol / tradeCount;
    const basePrice = TOKEN_PRICES[symbol] || 1;

    for (let t = 0; t < tradeCount; t++) {
      const daysAgo = Math.floor(rand() * 330);
      const hoursAgo = Math.floor(rand() * 24);
      const tokenA = symbol === 'NTC' ? ALL_TOKENS[1 + Math.floor(rand() * (ALL_TOKENS.length - 1))] : 'NTC';
      const priceVariation = basePrice * (0.95 + rand() * 0.10);
      const amountIn = perTrade * (0.8 + rand() * 0.4);
      addTrade(tokenA, symbol, amountIn, amountIn / priceVariation, priceVariation, wallets[Math.floor(rand() * wallets.length)], daysAgo, hoursAgo);
    }
  }

  console.log('[Seed] Generating trade_events for original trending pairs...');
  for (const pair of ORIGINAL_TRENDING_PAIRS) {
    for (let s = 0; s < pair.swaps; s++) {
      const hoursAgo = Math.floor(rand() * 24);
      const amountIn = pair.vol / pair.swaps * (0.8 + rand() * 0.4);
      addTrade(pair.tokenA, pair.tokenB, amountIn, amountIn / pair.price, pair.price, wallets[Math.floor(rand() * wallets.length)], 0, hoursAgo);
    }
  }

  console.log('[Seed] Generating trade_events for original price trends...');
  for (const [tokenId, prices] of Object.entries(ORIGINAL_PRICE_TRENDS)) {
    const sym = tokenId.toUpperCase();
    for (let d = 0; d < prices.length; d++) {
      const daysAgo = 6 - d;
      for (let h = 0; h < 3; h++) {
        const hour = h * 8;
        const price = prices[d] * (0.99 + rand() * 0.02);
        addTrade('NTC', sym, 500 + rand() * 1000, 500 / price, price, wallets[Math.floor(rand() * wallets.length)], daysAgo, hour);
      }
    }
  }

  console.log('[Seed] Generating referral-matching swap activity...');
  for (const entry of ORIGINAL_REFERRAL_DATA) {
    const monthOffset = MONTH_OFFSETS[entry.month];
    if (monthOffset === undefined) continue;
    for (let i = 0; i < entry.value; i++) {
      const daysAgo = monthOffset * 30 + Math.floor(rand() * 30);
      const token = ALL_TOKENS[1 + Math.floor(rand() * (ALL_TOKENS.length - 1))];
      addTrade('NTC', token, 100 + rand() * 500, 100, TOKEN_PRICES[token] || 1, wallets[Math.floor(rand() * wallets.length)], daysAgo, 0);
    }
  }

  console.log(`[Seed] Batch inserting ${tradeRows.length} trade_events...`);
  const TRADE_CHUNK = 200;
  for (let i = 0; i < tradeRows.length; i += TRADE_CHUNK) {
    const chunk = tradeRows.slice(i, i + TRADE_CHUNK);
    const placeholders = [];
    const values = [];
    let idx = 1;
    for (const [eventType, tokenA, tokenB, amountIn, amountOut, price, wallet, daysAgo, hoursAgo] of chunk) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, NOW() - INTERVAL '${daysAgo} days' - INTERVAL '${hoursAgo} hours')`);
      values.push(eventType, tokenA, tokenB, amountIn, amountOut, price, wallet);
    }
    await db.query(
      `INSERT INTO trade_events (event_type, token_a_symbol, token_b_symbol, amount_in, amount_out, price, wallet, created_at) VALUES ${placeholders.join(',')}`,
      values
    );
    if ((i + TRADE_CHUNK) % 1000 === 0 || i + TRADE_CHUNK >= tradeRows.length) {
      console.log(`[Seed]   ...${Math.min(i + TRADE_CHUNK, tradeRows.length)}/${tradeRows.length} trade rows`);
    }
  }

  console.log('[Seed] Generating page_visits...');
  const pageWeights = ORIGINAL_TOP_PAGES.map(p => ({ page: p.page, weight: p.pct / 100 }));
  const visitRows = [];

  for (const entry of ORIGINAL_PAGE_VIEWS) {
    const monthOffset = MONTH_OFFSETS[entry.d];
    if (monthOffset === undefined) continue;
    const traffic = ORIGINAL_TRAFFIC_DATA[entry.d] || { search: 20, direct: 20 };
    const totalVisits = entry.views;
    const sessionsPerMonth = Math.max(10, Math.floor(totalVisits / 4));

    const sessionIds = [];
    for (let s = 0; s < sessionsPerMonth; s++) {
      sessionIds.push(`seed_${entry.d}_${s}`);
    }

    for (let v = 0; v < totalVisits; v++) {
      const daysAgo = monthOffset * 30 + Math.floor(rand() * 30);
      const hoursAgo = Math.floor(rand() * 24);
      const sessionId = sessionIds[Math.floor(rand() * sessionIds.length)];
      const wallet = rand() > 0.4 ? wallets[Math.floor(rand() * wallets.length)] : '';
      const totalTraffic = traffic.search + traffic.direct;
      const source = rand() < traffic.search / totalTraffic ? 'search' : 'direct';

      let cumWeight = 0;
      let page = '/';
      const r = rand();
      for (const pw of pageWeights) {
        cumWeight += pw.weight;
        if (r < cumWeight) { page = pw.page; break; }
      }

      visitRows.push([sessionId, wallet, page, source, daysAgo, hoursAgo]);
    }
  }

  console.log(`[Seed] Batch inserting ${visitRows.length} page_visits...`);
  const VISIT_CHUNK = 300;
  for (let i = 0; i < visitRows.length; i += VISIT_CHUNK) {
    const chunk = visitRows.slice(i, i + VISIT_CHUNK);
    const placeholders = [];
    const values = [];
    let idx = 1;
    for (const [sessionId, wallet, page, source, daysAgo, hoursAgo] of chunk) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, NOW() - INTERVAL '${daysAgo} days' - INTERVAL '${hoursAgo} hours')`);
      values.push(sessionId, wallet, page, source);
    }
    await db.query(
      `INSERT INTO page_visits (session_id, wallet, page, source, created_at) VALUES ${placeholders.join(',')}`,
      values
    );
    if ((i + VISIT_CHUNK) % 3000 === 0 || i + VISIT_CHUNK >= visitRows.length) {
      console.log(`[Seed]   ...${Math.min(i + VISIT_CHUNK, visitRows.length)}/${visitRows.length} visit rows`);
    }
  }

  console.log('[Seed] Deterministic analytics seed complete!');
}

if (require.main === module) {
  (async () => {
    try {
      const { initDatabase } = require('./init');
      await initDatabase();
      await seedAnalytics();
      process.exit(0);
    } catch (e) {
      console.error('[Seed] Error:', e.message);
      process.exit(1);
    }
  })();
}

module.exports = { seedAnalytics };
