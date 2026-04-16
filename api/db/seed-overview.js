'use strict';

const { initDatabase, query, shutdown } = require('./init');

const seedData = [
  {
    period: 'all',
    referral_data: [
      { month: 'Jan', value: 20 }, { month: 'Feb', value: 35 }, { month: 'Mar', value: 25 },
      { month: 'Apr', value: 45 }, { month: 'May', value: 30 }, { month: 'Jun', value: 80 },
      { month: 'Jul', value: 120 }, { month: 'Aug', value: 60 }, { month: 'Sep', value: 45 },
      { month: 'Oct', value: 55 }, { month: 'Nov', value: 70 },
    ],
    traffic_data: [
      { month: 'Jan', search: 30, direct: 45 }, { month: 'Feb', search: 25, direct: 35 },
      { month: 'Mar', search: 40, direct: 50 }, { month: 'Apr', search: 35, direct: 30 },
      { month: 'May', search: 50, direct: 55 }, { month: 'Jun', search: 45, direct: 40 },
      { month: 'Jul', search: 60, direct: 50 }, { month: 'Aug', search: 55, direct: 45 },
      { month: 'Sep', search: 65, direct: 60 }, { month: 'Oct', search: 50, direct: 55 },
      { month: 'Nov', search: 70, direct: 65 },
    ],
    weekly_data: [
      { day: 'Mon', newVisitors: 180, returning: 120 }, { day: 'Tue', newVisitors: 240, returning: 160 },
      { day: 'Wed', newVisitors: 300, returning: 200 }, { day: 'Thu', newVisitors: 280, returning: 350 },
      { day: 'Fri', newVisitors: 350, returning: 280 }, { day: 'Sat', newVisitors: 480, returning: 360 },
      { day: 'Sun', newVisitors: 400, returning: 240 },
    ],
    most_viewed: [
      { name: 'NTC', value: 28904153 },
      { name: 'ASDC', value: 16119827 },
      { name: 'EDC', value: 16233812 },
    ],
    platform_stats: { totalUsers: 10800, usersChange: 28.4, totalVolume: 11650, volumeChange: -3.24, totalFees: 5250, feesChange: -1.8, totalTVL: 726.80, tvlChange: 1.08 },
  },
  {
    period: 'week',
    referral_data: [
      { month: 'Mon', value: 8 }, { month: 'Tue', value: 12 }, { month: 'Wed', value: 6 },
      { month: 'Thu', value: 15 }, { month: 'Fri', value: 18 }, { month: 'Sat', value: 22 },
      { month: 'Sun', value: 14 },
    ],
    traffic_data: [
      { month: 'Mon', search: 8, direct: 12 }, { month: 'Tue', search: 10, direct: 9 },
      { month: 'Wed', search: 12, direct: 14 }, { month: 'Thu', search: 9, direct: 11 },
      { month: 'Fri', search: 15, direct: 13 }, { month: 'Sat', search: 18, direct: 16 },
      { month: 'Sun', search: 14, direct: 11 },
    ],
    weekly_data: [
      { day: 'Mon', newVisitors: 45, returning: 30 }, { day: 'Tue', newVisitors: 60, returning: 40 },
      { day: 'Wed', newVisitors: 75, returning: 50 }, { day: 'Thu', newVisitors: 70, returning: 88 },
      { day: 'Fri', newVisitors: 88, returning: 70 }, { day: 'Sat', newVisitors: 120, returning: 90 },
      { day: 'Sun', newVisitors: 100, returning: 60 },
    ],
    most_viewed: [
      { name: 'NTC', value: 2312332 },
      { name: 'ASDC', value: 1289586 },
      { name: 'EDC', value: 1298705 },
    ],
    platform_stats: { totalUsers: 820, usersChange: 12.5, totalVolume: 1850, volumeChange: 5.2, totalFees: 445, feesChange: 3.1, totalTVL: 726.80, tvlChange: 0.32 },
  },
  {
    period: 'month',
    referral_data: [
      { month: 'Wk 1', value: 35 }, { month: 'Wk 2', value: 50 },
      { month: 'Wk 3', value: 42 }, { month: 'Wk 4', value: 65 },
    ],
    traffic_data: [
      { month: 'Wk 1', search: 45, direct: 50 }, { month: 'Wk 2', search: 55, direct: 40 },
      { month: 'Wk 3', search: 60, direct: 55 }, { month: 'Wk 4', search: 70, direct: 65 },
    ],
    weekly_data: [
      { day: 'Wk 1', newVisitors: 680, returning: 480 }, { day: 'Wk 2', newVisitors: 820, returning: 560 },
      { day: 'Wk 3', newVisitors: 950, returning: 720 }, { day: 'Wk 4', newVisitors: 1100, returning: 840 },
    ],
    most_viewed: [
      { name: 'NTC', value: 8671246 },
      { name: 'ASDC', value: 4835948 },
      { name: 'EDC', value: 4870144 },
    ],
    platform_stats: { totalUsers: 3200, usersChange: 18.7, totalVolume: 4600, volumeChange: -1.8, totalFees: 1380, feesChange: 2.4, totalTVL: 726.80, tvlChange: 0.75 },
  },
  {
    period: 'year',
    referral_data: [
      { month: 'Jan', value: 20 }, { month: 'Feb', value: 35 }, { month: 'Mar', value: 25 },
      { month: 'Apr', value: 45 }, { month: 'May', value: 30 }, { month: 'Jun', value: 80 },
      { month: 'Jul', value: 120 }, { month: 'Aug', value: 60 }, { month: 'Sep', value: 45 },
      { month: 'Oct', value: 55 }, { month: 'Nov', value: 70 },
    ],
    traffic_data: [
      { month: 'Jan', search: 30, direct: 45 }, { month: 'Feb', search: 25, direct: 35 },
      { month: 'Mar', search: 40, direct: 50 }, { month: 'Apr', search: 35, direct: 30 },
      { month: 'May', search: 50, direct: 55 }, { month: 'Jun', search: 45, direct: 40 },
      { month: 'Jul', search: 60, direct: 50 }, { month: 'Aug', search: 55, direct: 45 },
      { month: 'Sep', search: 65, direct: 60 }, { month: 'Oct', search: 50, direct: 55 },
      { month: 'Nov', search: 70, direct: 65 },
    ],
    weekly_data: [
      { day: 'Jan', newVisitors: 1200, returning: 800 }, { day: 'Mar', newVisitors: 1800, returning: 1100 },
      { day: 'May', newVisitors: 2400, returning: 1600 }, { day: 'Jul', newVisitors: 3200, returning: 2100 },
      { day: 'Sep', newVisitors: 2800, returning: 1900 }, { day: 'Nov', newVisitors: 3600, returning: 2400 },
    ],
    most_viewed: [
      { name: 'NTC', value: 24568530 },
      { name: 'ASDC', value: 13701853 },
      { name: 'EDC', value: 13798740 },
    ],
    platform_stats: { totalUsers: 9500, usersChange: 24.1, totalVolume: 9800, volumeChange: -2.5, totalFees: 4410, feesChange: -0.9, totalTVL: 726.80, tvlChange: 1.02 },
  },
];

async function seed() {
  console.log('[Seed] Initializing database...');
  await initDatabase();

  console.log('[Seed] Creating admin_overview_seed table...');
  await query(`
    CREATE TABLE IF NOT EXISTS admin_overview_seed (
      period          VARCHAR(16)     PRIMARY KEY,
      referral_data   JSONB           NOT NULL DEFAULT '[]',
      traffic_data    JSONB           NOT NULL DEFAULT '[]',
      weekly_data     JSONB           NOT NULL DEFAULT '[]',
      most_viewed     JSONB           NOT NULL DEFAULT '[]',
      platform_stats  JSONB           NOT NULL DEFAULT '{}'
    )
  `, []);

  console.log('[Seed] Inserting seed data for 4 periods...');
  for (const row of seedData) {
    await query(`
      INSERT INTO admin_overview_seed (period, referral_data, traffic_data, weekly_data, most_viewed, platform_stats)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (period) DO UPDATE SET
        referral_data = EXCLUDED.referral_data,
        traffic_data = EXCLUDED.traffic_data,
        weekly_data = EXCLUDED.weekly_data,
        most_viewed = EXCLUDED.most_viewed,
        platform_stats = EXCLUDED.platform_stats
    `, [
      row.period,
      JSON.stringify(row.referral_data),
      JSON.stringify(row.traffic_data),
      JSON.stringify(row.weekly_data),
      JSON.stringify(row.most_viewed),
      JSON.stringify(row.platform_stats),
    ]);
    console.log(`[Seed]   ✓ ${row.period}`);
  }

  console.log('[Seed] Done — verifying...');
  const check = await query('SELECT period FROM admin_overview_seed ORDER BY period', []);
  console.log('[Seed] Periods in DB:', check.rows.map(r => r.period).join(', '));

  await shutdown();
  console.log('[Seed] Complete.');
}

seed().catch(e => {
  console.error('[Seed] Error:', e.message);
  process.exit(1);
});
