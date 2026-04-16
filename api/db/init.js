'use strict';

const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

let sql = null;

function getSql() {
  if (sql) return sql;
  const connectionString = process.env.NEON_DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    console.warn('[DB] No NEON_DATABASE_URL set — database features disabled');
    return null;
  }
  const isLocal = false;
  console.log('[DB] Connecting to:', connectionString.replace(/:[^:@]+@/, ':***@').split('?')[0]);
  sql = postgres(connectionString, {
    ssl: isLocal ? false : 'require',
    max: 10,
    idle_timeout: 30,
    connect_timeout: 15,
    prepare: false,
  });
  return sql;
}

const ADMIN_TABLES = [
  { name: 'program_config', sql: `CREATE TABLE IF NOT EXISTS program_config (key VARCHAR(64) PRIMARY KEY, value VARCHAR(128) NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'tokens', sql: `CREATE TABLE IF NOT EXISTS tokens (id SERIAL PRIMARY KEY, symbol VARCHAR(16) NOT NULL UNIQUE, name VARCHAR(128) NOT NULL, mint_address VARCHAR(64) NOT NULL UNIQUE, decimals INT NOT NULL DEFAULT 5, supply VARCHAR(64) NOT NULL DEFAULT '0', metadata_uri VARCHAR(256) NOT NULL DEFAULT '', image_url VARCHAR(256) NOT NULL DEFAULT '', tx_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'multisig_config', sql: `CREATE TABLE IF NOT EXISTS multisig_config (id SERIAL PRIMARY KEY, multisig_pda VARCHAR(64) NOT NULL, treasury_authority_pda VARCHAR(64) NOT NULL, program_id VARCHAR(64) NOT NULL, owners JSONB NOT NULL DEFAULT '[]', threshold INT NOT NULL DEFAULT 2, allowed_programs JSONB NOT NULL DEFAULT '[]', tx_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'treasury_wallets', sql: `CREATE TABLE IF NOT EXISTS treasury_wallets (id SERIAL PRIMARY KEY, token_symbol VARCHAR(16) NOT NULL, mint_address VARCHAR(64) NOT NULL, treasury_ata VARCHAR(64) NOT NULL, tx_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'pools', sql: `CREATE TABLE IF NOT EXISTS pools (id SERIAL PRIMARY KEY, token_a_symbol VARCHAR(16) NOT NULL, token_b_symbol VARCHAR(16) NOT NULL, token_a_mint VARCHAR(64) NOT NULL DEFAULT '', token_b_mint VARCHAR(64) NOT NULL DEFAULT '', pool_address VARCHAR(64) NOT NULL UNIQUE, tick_spacing INT NOT NULL DEFAULT 64, fee_tier DOUBLE PRECISION NOT NULL DEFAULT 0.30, tx_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'transfer_proposals', sql: `CREATE TABLE IF NOT EXISTS transfer_proposals (id SERIAL PRIMARY KEY, transaction_index INT NOT NULL UNIQUE, token_symbol VARCHAR(16) NOT NULL, token_mint VARCHAR(64) NOT NULL, amount VARCHAR(64) NOT NULL, decimals INT NOT NULL DEFAULT 5, destination VARCHAR(64) NOT NULL, creator VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', approvals INT NOT NULL DEFAULT 0, threshold INT NOT NULL DEFAULT 2, approved_by JSONB NOT NULL DEFAULT '[]', vt_signature VARCHAR(128) NOT NULL DEFAULT '', proposal_signature VARCHAR(128) NOT NULL DEFAULT '', execute_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'swap_limit_config', sql: `CREATE TABLE IF NOT EXISTS swap_limit_config (id SERIAL PRIMARY KEY, daily_limit DOUBLE PRECISION NOT NULL DEFAULT 100, monthly_limit DOUBLE PRECISION NOT NULL DEFAULT 500, updated_by VARCHAR(64) NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'swap_limit_proposals', sql: `CREATE TABLE IF NOT EXISTS swap_limit_proposals (id SERIAL PRIMARY KEY, transaction_index INT NOT NULL UNIQUE, proposed_daily DOUBLE PRECISION NOT NULL, proposed_monthly DOUBLE PRECISION NOT NULL, current_daily DOUBLE PRECISION NOT NULL DEFAULT 100, current_monthly DOUBLE PRECISION NOT NULL DEFAULT 500, creator VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', approvals INT NOT NULL DEFAULT 0, threshold INT NOT NULL DEFAULT 2, approved_by JSONB NOT NULL DEFAULT '[]', execute_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'token_prices', sql: `CREATE TABLE IF NOT EXISTS token_prices (id BIGSERIAL PRIMARY KEY, token_symbol VARCHAR(16) NOT NULL, token_mint VARCHAR(64) NOT NULL, pair_symbol VARCHAR(16) NOT NULL DEFAULT '', pair_mint VARCHAR(64) NOT NULL DEFAULT '', pool_address VARCHAR(64) NOT NULL DEFAULT '', price DOUBLE PRECISION NOT NULL, liquidity VARCHAR(64) NOT NULL DEFAULT '0', source VARCHAR(32) NOT NULL DEFAULT 'pool', volume DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'referral_codes', sql: `CREATE TABLE IF NOT EXISTS referral_codes (id SERIAL PRIMARY KEY, code VARCHAR(16) NOT NULL UNIQUE, wallet VARCHAR(64) NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'referral_uses', sql: `CREATE TABLE IF NOT EXISTS referral_uses (id SERIAL PRIMARY KEY, code VARCHAR(16) NOT NULL, referrer_wallet VARCHAR(64) NOT NULL, referee_wallet VARCHAR(64) NOT NULL UNIQUE, referee_first_swap BOOLEAN NOT NULL DEFAULT FALSE, referrer_rewarded BOOLEAN NOT NULL DEFAULT FALSE, referee_rewarded BOOLEAN NOT NULL DEFAULT FALSE, referrer_reward_amount DOUBLE PRECISION NOT NULL DEFAULT 0, referee_reward_amount DOUBLE PRECISION NOT NULL DEFAULT 0, referrer_reward_tx VARCHAR(128), referee_reward_tx VARCHAR(128), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'referral_config', sql: `CREATE TABLE IF NOT EXISTS referral_config (id SERIAL PRIMARY KEY, referrer_reward DOUBLE PRECISION NOT NULL DEFAULT 0.25, referee_reward DOUBLE PRECISION NOT NULL DEFAULT 0.5, updated_by VARCHAR(64) NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'referral_reward_proposals', sql: `CREATE TABLE IF NOT EXISTS referral_reward_proposals (id SERIAL PRIMARY KEY, transaction_index INT NOT NULL UNIQUE, proposed_referrer_reward DOUBLE PRECISION NOT NULL, proposed_referee_reward DOUBLE PRECISION NOT NULL, current_referrer_reward DOUBLE PRECISION NOT NULL DEFAULT 0.25, current_referee_reward DOUBLE PRECISION NOT NULL DEFAULT 0.5, creator VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', approvals INT NOT NULL DEFAULT 0, threshold INT NOT NULL DEFAULT 2, approved_by JSONB NOT NULL DEFAULT '[]', execute_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'moonpay_transactions', sql: `CREATE TABLE IF NOT EXISTS moonpay_transactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_wallet VARCHAR(64) NOT NULL, update_token VARCHAR(64) NOT NULL DEFAULT '', type VARCHAR(10) NOT NULL DEFAULT 'buy', moonpay_transaction_id VARCHAR(128) NOT NULL DEFAULT '', status VARCHAR(20) NOT NULL DEFAULT 'pending', crypto_currency VARCHAR(16) NOT NULL DEFAULT '', fiat_currency VARCHAR(16) NOT NULL DEFAULT 'USD', amount_fiat DOUBLE PRECISION NOT NULL DEFAULT 0, amount_crypto DOUBLE PRECISION NOT NULL DEFAULT 0, token_price DOUBLE PRECISION NOT NULL DEFAULT 0, tx_signature VARCHAR(128) NOT NULL DEFAULT '', moonpay_status VARCHAR(32) NOT NULL DEFAULT '', widget_url TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'token_purchases', sql: `CREATE TABLE IF NOT EXISTS token_purchases (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_wallet VARCHAR(64) NOT NULL, ntc_amount DOUBLE PRECISION NOT NULL DEFAULT 0, price_usd DOUBLE PRECISION NOT NULL DEFAULT 0, pay_currency VARCHAR(16) NOT NULL DEFAULT '', pay_amount DOUBLE PRECISION NOT NULL DEFAULT 0, nowpayments_id BIGINT DEFAULT NULL, nowpayments_status VARCHAR(32) NOT NULL DEFAULT '', pay_address VARCHAR(256) NOT NULL DEFAULT '', status VARCHAR(20) NOT NULL DEFAULT 'pending', ntc_tx_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'chart_candles', sql: `CREATE TABLE IF NOT EXISTS chart_candles (id BIGSERIAL PRIMARY KEY, token_symbol VARCHAR(16) NOT NULL, interval_key VARCHAR(8) NOT NULL, bucket TIMESTAMPTZ NOT NULL, open DOUBLE PRECISION NOT NULL DEFAULT 0, high DOUBLE PRECISION NOT NULL DEFAULT 0, low DOUBLE PRECISION NOT NULL DEFAULT 0, close DOUBLE PRECISION NOT NULL DEFAULT 0, volume DOUBLE PRECISION NOT NULL DEFAULT 0, trade_count INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(token_symbol, interval_key, bucket))` },
  { name: 'token_stats_cache', sql: `CREATE TABLE IF NOT EXISTS token_stats_cache (token_symbol VARCHAR(16) PRIMARY KEY, latest_price DOUBLE PRECISION NOT NULL DEFAULT 0, price_24h_ago DOUBLE PRECISION NOT NULL DEFAULT 0, price_7d_ago DOUBLE PRECISION NOT NULL DEFAULT 0, earliest_price DOUBLE PRECISION NOT NULL DEFAULT 0, volume_24h DOUBLE PRECISION NOT NULL DEFAULT 0, trades_24h INT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'limit_orders', sql: `CREATE TABLE IF NOT EXISTS limit_orders (id BIGSERIAL PRIMARY KEY, wallet VARCHAR(64) NOT NULL, sell_token VARCHAR(16) NOT NULL, buy_token VARCHAR(16) NOT NULL, sell_mint VARCHAR(64) NOT NULL DEFAULT '', buy_mint VARCHAR(64) NOT NULL DEFAULT '', amount DOUBLE PRECISION NOT NULL, target_price DOUBLE PRECISION NOT NULL, side VARCHAR(4) NOT NULL DEFAULT 'buy', status VARCHAR(16) NOT NULL DEFAULT 'open', filled_tx VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'user_profiles', sql: `CREATE TABLE IF NOT EXISTS user_profiles (id SERIAL PRIMARY KEY, wallet VARCHAR(64) NOT NULL UNIQUE, username VARCHAR(32) NOT NULL UNIQUE, display_name VARCHAR(64) NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', avatar_url VARCHAR(512) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'profile_follows', sql: `CREATE TABLE IF NOT EXISTS profile_follows (id BIGSERIAL PRIMARY KEY, follower_wallet VARCHAR(64) NOT NULL, following_wallet VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(follower_wallet, following_wallet))` },
  { name: 'profile_members', sql: `CREATE TABLE IF NOT EXISTS profile_members (id BIGSERIAL PRIMARY KEY, member_wallet VARCHAR(64) NOT NULL, profile_wallet VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(member_wallet, profile_wallet))` },
  { name: 'user_posts', sql: `CREATE TABLE IF NOT EXISTS user_posts (id BIGSERIAL PRIMARY KEY, author_wallet VARCHAR(64) NOT NULL, type VARCHAR(10) NOT NULL DEFAULT 'blog', title VARCHAR(256) NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', image_url VARCHAR(512) NOT NULL DEFAULT '', video_url VARCHAR(512) NOT NULL DEFAULT '', category VARCHAR(32) NOT NULL DEFAULT 'General', votes INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'user_reposts', sql: `CREATE TABLE IF NOT EXISTS user_reposts (id BIGSERIAL PRIMARY KEY, original_post_id BIGINT NOT NULL, reposter_wallet VARCHAR(64) NOT NULL, commentary TEXT NOT NULL DEFAULT '', category_tags JSONB NOT NULL DEFAULT '[]', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'support_messages', sql: `CREATE TABLE IF NOT EXISTS support_messages (id BIGSERIAL PRIMARY KEY, name VARCHAR(128) NOT NULL, email VARCHAR(256) NOT NULL, subject VARCHAR(256) NOT NULL DEFAULT '', message TEXT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'new', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'network_posts', sql: `CREATE TABLE IF NOT EXISTS network_posts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), author_wallet VARCHAR(64) NOT NULL, title VARCHAR(256) NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', media_url VARCHAR(1024) NOT NULL DEFAULT '', media_type VARCHAR(10) NOT NULL DEFAULT '', cloudinary_public_id VARCHAR(256) NOT NULL DEFAULT '', likes_count INT NOT NULL DEFAULT 0, comments_count INT NOT NULL DEFAULT 0, category VARCHAR(32) NOT NULL DEFAULT 'General', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'network_post_likes', sql: `CREATE TABLE IF NOT EXISTS network_post_likes (id BIGSERIAL PRIMARY KEY, post_id UUID NOT NULL, wallet VARCHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(post_id, wallet))` },
  { name: 'network_post_comments', sql: `CREATE TABLE IF NOT EXISTS network_post_comments (id BIGSERIAL PRIMARY KEY, post_id UUID NOT NULL, wallet VARCHAR(64) NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'network_post_permissions', sql: `CREATE TABLE IF NOT EXISTS network_post_permissions (id SERIAL PRIMARY KEY, wallet VARCHAR(64) NOT NULL UNIQUE, granted_by VARCHAR(64) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'admin_wallets', sql: `CREATE TABLE IF NOT EXISTS admin_wallets (id SERIAL PRIMARY KEY, wallet VARCHAR(64) NOT NULL UNIQUE, role VARCHAR(32) NOT NULL DEFAULT 'admin', added_by VARCHAR(64) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'token_buy_price_config', sql: `CREATE TABLE IF NOT EXISTS token_buy_price_config (id SERIAL PRIMARY KEY, token_symbol VARCHAR(16) NOT NULL UNIQUE, price_usd DOUBLE PRECISION NOT NULL, updated_by VARCHAR(64) NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
  { name: 'token_buy_price_proposals', sql: `CREATE TABLE IF NOT EXISTS token_buy_price_proposals (id SERIAL PRIMARY KEY, transaction_index INT NOT NULL UNIQUE, token_symbol VARCHAR(16) NOT NULL, proposed_price DOUBLE PRECISION NOT NULL, current_price DOUBLE PRECISION NOT NULL DEFAULT 0, creator VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', approvals INT NOT NULL DEFAULT 0, threshold INT NOT NULL DEFAULT 2, approved_by JSONB NOT NULL DEFAULT '[]', propose_signature VARCHAR(128) NOT NULL DEFAULT '', approve_signatures JSONB NOT NULL DEFAULT '[]', execute_signature VARCHAR(128) NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())` },
];

async function ensureAdminTables(s) {
  try { await s`CREATE EXTENSION IF NOT EXISTS pgcrypto` } catch (_) {}
  for (const t of ADMIN_TABLES) {
    try {
      const check = await s`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = ${t.name}) AS exists`;
      if (!check[0].exists) {
        await s.unsafe(t.sql);
        console.log(`[DB] Created table: ${t.name}`);
      }
    } catch (e) {
      if (!e.message.includes('already exists')) {
        console.warn(`[DB] Warning creating ${t.name}:`, e.message.substring(0, 120));
      }
    }
  }
  try {
    const colCheck = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'transfer_proposals' AND column_name = 'approved_by'`;
    if (colCheck.length === 0) {
      await s.unsafe(`ALTER TABLE transfer_proposals ADD COLUMN approved_by JSONB NOT NULL DEFAULT '[]'`);
      console.log('[DB] Added approved_by column to transfer_proposals');
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] approved_by migration:', e.message.substring(0, 80));
    }
  }
  try {
    const tpExists = await s`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'transfer_proposals') AS exists`;
    if (tpExists[0].exists) {
      await s.unsafe(`DELETE FROM transfer_proposals WHERE id NOT IN (SELECT MAX(id) FROM transfer_proposals GROUP BY transaction_index)`);
      await s.unsafe(`UPDATE transfer_proposals SET approvals = LEAST(approvals, 3) WHERE approvals > 3`);
      const uqCheck = await s`SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'transfer_proposals' AND constraint_type = 'UNIQUE'`;
      if (uqCheck.length === 0) {
        await s.unsafe(`ALTER TABLE transfer_proposals ADD CONSTRAINT uq_tp_tx_index UNIQUE (transaction_index)`);
        console.log('[DB] Added unique constraint to transfer_proposals.transaction_index');
      }
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] transfer_proposals migration:', e.message.substring(0, 80));
    }
  }
  try {
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_trade_events_wallet_date ON trade_events (wallet, created_at DESC)`);
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] wallet index migration:', e.message.substring(0, 80));
    }
  }
  try {
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_token_prices_symbol ON token_prices (token_symbol, created_at DESC)`);
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_token_prices_mint ON token_prices (token_mint, created_at DESC)`);
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_token_prices_pair ON token_prices (token_symbol, pair_symbol, created_at DESC)`);
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] token_prices index migration:', e.message.substring(0, 80));
    }
  }
  try {
    const volCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'token_prices' AND column_name = 'volume_24h'`;
    if (volCol.length > 0) {
      await s.unsafe(`ALTER TABLE token_prices RENAME COLUMN volume_24h TO volume`);
      console.log('[DB] Renamed token_prices.volume_24h to volume');
    }
  } catch (e) {
    if (!e.message.includes('already exists') && !e.message.includes('does not exist')) {
      console.warn('[DB] volume rename migration:', e.message.substring(0, 80));
    }
  }
  try {
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_moonpay_tx_wallet ON moonpay_transactions (user_wallet, created_at DESC)`);
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_moonpay_tx_mpid ON moonpay_transactions (moonpay_transaction_id)`);
    const utCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'moonpay_transactions' AND column_name = 'update_token'`;
    if (utCol.length === 0) {
      await s.unsafe(`ALTER TABLE moonpay_transactions ADD COLUMN update_token VARCHAR(64) NOT NULL DEFAULT ''`);
      console.log('[DB] Added update_token column to moonpay_transactions');
    }
    const typeCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'moonpay_transactions' AND column_name = 'type'`;
    if (typeCol.length === 0) {
      await s.unsafe(`ALTER TABLE moonpay_transactions ADD COLUMN type VARCHAR(10) NOT NULL DEFAULT 'buy'`);
      console.log('[DB] Added type column to moonpay_transactions');
    }
    const priceCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'moonpay_transactions' AND column_name = 'token_price'`;
    if (priceCol.length === 0) {
      await s.unsafe(`ALTER TABLE moonpay_transactions ADD COLUMN token_price DOUBLE PRECISION NOT NULL DEFAULT 0`);
      console.log('[DB] Added token_price column to moonpay_transactions');
    }
    const txSigCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'moonpay_transactions' AND column_name = 'tx_signature'`;
    if (txSigCol.length === 0) {
      await s.unsafe(`ALTER TABLE moonpay_transactions ADD COLUMN tx_signature VARCHAR(128) NOT NULL DEFAULT ''`);
      console.log('[DB] Added tx_signature column to moonpay_transactions');
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] moonpay indexes migration:', e.message.substring(0, 80));
    }
  }
  try {
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_limit_orders_wallet ON limit_orders (wallet, status, created_at DESC)`);
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_limit_orders_status ON limit_orders (status, created_at DESC)`);
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] limit_orders index migration:', e.message.substring(0, 80));
    }
  }
  try {
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_chart_candles_lookup ON chart_candles (token_symbol, interval_key, bucket DESC)`);
    await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_trade_events_token_b_lower ON trade_events (lower(token_b_symbol), event_type, created_at DESC)`);
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] chart optimization indexes:', e.message.substring(0, 80));
    }
  }
  try {
    const txColCheck = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'referral_uses' AND column_name = 'referrer_reward_tx'`;
    if (txColCheck.length === 0) {
      await s.unsafe(`ALTER TABLE referral_uses ADD COLUMN referrer_reward_tx VARCHAR(128)`);
      await s.unsafe(`ALTER TABLE referral_uses ADD COLUMN referee_reward_tx VARCHAR(128)`);
      console.log('[DB] Added reward tx columns to referral_uses');
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] referral tx columns migration:', e.message.substring(0, 80));
    }
  }
  try {
    const npUpdatedAt = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'network_posts' AND column_name = 'updated_at'`;
    if (npUpdatedAt.length === 0) {
      await s.unsafe(`ALTER TABLE network_posts ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
      console.log('[DB] Added updated_at column to network_posts');
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] network_posts updated_at migration:', e.message.substring(0, 80));
    }
  }
  try {
    const idType = await s`SELECT data_type FROM information_schema.columns WHERE table_name = 'network_posts' AND column_name = 'id'`;
    if (idType.length > 0 && idType[0].data_type !== 'uuid') {
      console.log('[DB] Migrating network_posts id from integer to UUID...');
      await s.begin(async (tx) => {
        await tx.unsafe(`ALTER TABLE network_posts ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid()`);
        await tx.unsafe(`UPDATE network_posts SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL`);
        const likesHasUuid = await tx`SELECT column_name FROM information_schema.columns WHERE table_name = 'network_post_likes' AND column_name = 'uuid_post_id'`;
        if (likesHasUuid.length === 0) {
          await tx.unsafe(`ALTER TABLE network_post_likes ADD COLUMN uuid_post_id UUID`);
        }
        const commentsHasUuid = await tx`SELECT column_name FROM information_schema.columns WHERE table_name = 'network_post_comments' AND column_name = 'uuid_post_id'`;
        if (commentsHasUuid.length === 0) {
          await tx.unsafe(`ALTER TABLE network_post_comments ADD COLUMN uuid_post_id UUID`);
        }
        await tx.unsafe(`UPDATE network_post_likes SET uuid_post_id = (SELECT uuid_id FROM network_posts WHERE network_posts.id = network_post_likes.post_id) WHERE uuid_post_id IS NULL`);
        await tx.unsafe(`UPDATE network_post_comments SET uuid_post_id = (SELECT uuid_id FROM network_posts WHERE network_posts.id = network_post_comments.post_id) WHERE uuid_post_id IS NULL`);
        await tx.unsafe(`ALTER TABLE network_post_likes DROP CONSTRAINT IF EXISTS network_post_likes_post_id_wallet_key`);
        await tx.unsafe(`ALTER TABLE network_post_likes DROP COLUMN post_id`);
        await tx.unsafe(`ALTER TABLE network_post_likes RENAME COLUMN uuid_post_id TO post_id`);
        await tx.unsafe(`ALTER TABLE network_post_likes ALTER COLUMN post_id SET NOT NULL`);
        await tx.unsafe(`ALTER TABLE network_post_likes ADD CONSTRAINT network_post_likes_post_id_wallet_key UNIQUE(post_id, wallet)`);
        await tx.unsafe(`ALTER TABLE network_post_comments DROP COLUMN post_id`);
        await tx.unsafe(`ALTER TABLE network_post_comments RENAME COLUMN uuid_post_id TO post_id`);
        await tx.unsafe(`ALTER TABLE network_post_comments ALTER COLUMN post_id SET NOT NULL`);
        await tx.unsafe(`ALTER TABLE network_posts DROP CONSTRAINT network_posts_pkey`);
        await tx.unsafe(`ALTER TABLE network_posts DROP COLUMN id`);
        await tx.unsafe(`ALTER TABLE network_posts RENAME COLUMN uuid_id TO id`);
        await tx.unsafe(`ALTER TABLE network_posts ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
        await tx.unsafe(`ALTER TABLE network_posts ALTER COLUMN id SET NOT NULL`);
        await tx.unsafe(`ALTER TABLE network_posts ADD PRIMARY KEY (id)`);
      });
      console.log('[DB] Migrated network_posts id to UUID');
    }
  } catch (e) {
    console.warn('[DB] network_posts UUID migration:', e.message.substring(0, 120));
  }
  try {
    const psCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'swap_limit_proposals' AND column_name = 'propose_signature'`;
    if (psCol.length === 0) {
      await s.unsafe(`ALTER TABLE swap_limit_proposals ADD COLUMN propose_signature VARCHAR(128) NOT NULL DEFAULT ''`);
      console.log('[DB] Added propose_signature column to swap_limit_proposals');
    }
    const asCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'swap_limit_proposals' AND column_name = 'approve_signatures'`;
    if (asCol.length === 0) {
      await s.unsafe(`ALTER TABLE swap_limit_proposals ADD COLUMN approve_signatures JSONB NOT NULL DEFAULT '[]'`);
      console.log('[DB] Added approve_signatures column to swap_limit_proposals');
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] swap_limit_proposals signature columns migration:', e.message.substring(0, 80));
    }
  }
  try {
    const payTxCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'token_purchases' AND column_name = 'pay_tx_hash'`;
    if (payTxCol.length === 0) {
      await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN pay_tx_hash VARCHAR(128) NOT NULL DEFAULT ''`);
      await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN evm_tx_verified BOOLEAN NOT NULL DEFAULT FALSE`);
      await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN confirmed_at TIMESTAMPTZ DEFAULT NULL`);
      await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN sent_at TIMESTAMPTZ DEFAULT NULL`);
      console.log('[DB] Added pay_tx_hash, evm_tx_verified, confirmed_at, sent_at columns to token_purchases');
    } else {
      const evmVerCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'token_purchases' AND column_name = 'evm_tx_verified'`;
      if (evmVerCol.length === 0) {
        await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN evm_tx_verified BOOLEAN NOT NULL DEFAULT FALSE`);
        console.log('[DB] Added evm_tx_verified column to token_purchases');
      }
      const confirmedCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'token_purchases' AND column_name = 'confirmed_at'`;
      if (confirmedCol.length === 0) {
        await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN confirmed_at TIMESTAMPTZ DEFAULT NULL`);
        await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN sent_at TIMESTAMPTZ DEFAULT NULL`);
        console.log('[DB] Added confirmed_at, sent_at columns to token_purchases');
      }
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] token_purchases new columns migration:', e.message.substring(0, 80));
    }
  }
  try {
    const tokenSymCol = await s`SELECT column_name FROM information_schema.columns WHERE table_name = 'token_purchases' AND column_name = 'token_symbol'`;
    if (tokenSymCol.length === 0) {
      await s.unsafe(`ALTER TABLE token_purchases ADD COLUMN token_symbol VARCHAR(16) NOT NULL DEFAULT 'NTC'`);
      console.log('[DB] Added token_symbol column to token_purchases');
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] token_symbol migration:', e.message.substring(0, 80));
    }
  }
  try {
    const idxCheck = await s`SELECT indexname FROM pg_indexes WHERE tablename = 'token_purchases' AND indexname = 'uq_token_purchases_pay_tx_hash'`;
    if (idxCheck.length === 0) {
      await s.unsafe(`CREATE UNIQUE INDEX uq_token_purchases_pay_tx_hash ON token_purchases (pay_tx_hash) WHERE pay_tx_hash != '' AND pay_tx_hash IS NOT NULL`);
      console.log('[DB] Added unique index on token_purchases.pay_tx_hash (non-empty)');
    }
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.warn('[DB] pay_tx_hash unique index migration:', e.message.substring(0, 80));
    }
  }
}

async function initDatabase() {
  const s = getSql();
  if (!s) return false;

  try {
    const exists = await s`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'trade_events'
      ) AS exists
    `;

    if (exists[0].exists) {
      console.log('[DB] Tables already exist — skipping schema init');
      const feeExists = await s`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'fee_events'
        ) AS exists
      `;
      if (!feeExists[0].exists) {
        console.log('[DB] Creating fee_events table...');
        await s.unsafe(`CREATE TABLE IF NOT EXISTS fee_events (
          id              BIGSERIAL        PRIMARY KEY,
          token_mint      VARCHAR(64)      NOT NULL,
          token_symbol    VARCHAR(16)      NOT NULL DEFAULT '',
          amount          DOUBLE PRECISION NOT NULL DEFAULT 0,
          fee_type        VARCHAR(32)      NOT NULL,
          tx_signature    VARCHAR(128)     NOT NULL DEFAULT '',
          created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
        )`);
        await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_fee_events_token ON fee_events (token_mint, created_at DESC)`);
        await s.unsafe(`CREATE INDEX IF NOT EXISTS idx_fee_events_type  ON fee_events (fee_type, created_at DESC)`);
        console.log('[DB] fee_events table created');
      }
      await ensureAdminTables(s);
      return true;
    }

    const schemaPath = path.resolve(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    const statements = schemaSql
      .split(/;\s*$/m)
      .map(st => st.trim())
      .filter(st => st.length > 0);

    for (const stmt of statements) {
      try {
        await s.unsafe(stmt);
      } catch (e) {
        if (e.message.includes('already exists')) {
          continue;
        }
        console.warn('[DB] Schema statement warning:', e.message.substring(0, 120));
      }
    }

    console.log('[DB] Schema initialized successfully');
    await ensureAdminTables(s);
    return true;
  } catch (e) {
    console.error('[DB] Init failed:', e.message);
    return false;
  }
}

async function query(text, params) {
  const s = getSql();
  if (!s) throw new Error('Database not available');
  const result = await s.unsafe(text, params || []);
  return { rows: result };
}

async function shutdown() {
  if (sql) {
    await sql.end();
    sql = null;
  }
}

module.exports = { initDatabase, getSql, query, shutdown };
