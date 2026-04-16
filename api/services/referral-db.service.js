'use strict';

const db = require('../db/init');
const crypto = require('crypto');
const { PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  getAccount,
} = require('@solana/spl-token');

const DEFAULT_REFERRER_REWARD = 0.25;
const DEFAULT_REFEREE_REWARD = 0.5;
const NTC_DECIMALS = 5;

let _cachedNtcMint = null;
async function getNtcMintFromDb() {
  if (_cachedNtcMint) return _cachedNtcMint;
  try {
    const result = await db.query('SELECT mint_address, decimals FROM tokens WHERE symbol = $1', ['NTC']);
    if (result.rows.length > 0) {
      _cachedNtcMint = result.rows[0].mint_address;
      return _cachedNtcMint;
    }
  } catch (e) {
    console.warn('[Referral] Could not fetch NTC mint from DB:', e.message);
  }
  return null;
}

class MemCache {
  constructor() {
    this._store = new Map();
  }
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) { this._store.delete(key); return null; }
    return entry.data;
  }
  set(key, data, ttlSec) {
    this._store.set(key, { data, exp: Date.now() + ttlSec * 1000 });
  }
  del(key) { this._store.delete(key); }
}

const memCache = new MemCache();

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

class ReferralDbService {
  constructor() {
    this._connection = null;
    this._wallet = null;
  }

  setDeps({ connection, wallet }) {
    this._connection = connection;
    this._wallet = wallet;
  }

  /**
   * Transfer NTC reward from pool liquidity reserve to recipient.
   * Source: server wallet's NTC ATA — funded by pool operations (fee collection, LP activity).
   * Direct Whirlpool vault transfers are impossible (vaults are PDA-controlled by the program).
   */
  async _transferFromPoolReserve(recipientWallet, amount) {
    if (!this._connection || !this._wallet) {
      throw new Error('Connection/wallet not set — call setDeps first');
    }
    const ntcMintAddr = await getNtcMintFromDb();
    if (!ntcMintAddr) {
      console.warn('[Referral] NTC mint not found in database — skipping transfer');
      return null;
    }
    const mintPk = new PublicKey(ntcMintAddr);
    const recipientPk = new PublicKey(recipientWallet);
    const senderAta = getAssociatedTokenAddressSync(mintPk, this._wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
    const recipientAta = getAssociatedTokenAddressSync(mintPk, recipientPk, true, TOKEN_2022_PROGRAM_ID);

    const tx = new Transaction();

    let recipientAtaExists = false;
    try {
      await getAccount(this._connection, recipientAta, 'confirmed', TOKEN_2022_PROGRAM_ID);
      recipientAtaExists = true;
    } catch {
      recipientAtaExists = false;
    }

    if (!recipientAtaExists) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          this._wallet.publicKey,
          recipientAta,
          recipientPk,
          mintPk,
          TOKEN_2022_PROGRAM_ID
        )
      );
    }

    const rawAmount = BigInt(Math.round(amount * (10 ** NTC_DECIMALS)));
    tx.add(
      createTransferCheckedInstruction(
        senderAta,
        mintPk,
        recipientAta,
        this._wallet.publicKey,
        rawAmount,
        NTC_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const signature = await sendAndConfirmTransaction(this._connection, tx, [this._wallet], {
      commitment: 'confirmed',
      maxRetries: 3,
    });

    return signature;
  }

  async getOrCreateCode(wallet) {
    if (!wallet) throw new Error('Wallet required');

    const cacheKey = `ref_code:${wallet}`;
    const cached = memCache.get(cacheKey);
    if (cached) return cached;

    const existing = await db.query(
      'SELECT code FROM referral_codes WHERE wallet = $1',
      [wallet]
    );
    if (existing.rows.length > 0) {
      const code = existing.rows[0].code;
      memCache.set(cacheKey, code, 300);
      return code;
    }

    let code;
    let attempts = 0;
    while (attempts < 10) {
      code = generateCode();
      try {
        await db.query(
          'INSERT INTO referral_codes (code, wallet) VALUES ($1, $2) ON CONFLICT (wallet) DO NOTHING',
          [code, wallet]
        );
        const check = await db.query('SELECT code FROM referral_codes WHERE wallet = $1', [wallet]);
        if (check.rows.length > 0) {
          code = check.rows[0].code;
          break;
        }
      } catch (e) {
        if (e.message.includes('referral_codes_code_key')) {
          attempts++;
          continue;
        }
        throw e;
      }
      attempts++;
    }

    memCache.set(cacheKey, code, 300);
    return code;
  }

  async useCode(code, refereeWallet) {
    if (!code || !refereeWallet) throw new Error('Code and referee wallet required');

    const codeUpper = code.toUpperCase();
    const codeRow = await db.query(
      'SELECT wallet FROM referral_codes WHERE code = $1',
      [codeUpper]
    );
    if (!codeRow.rows.length) {
      return { ok: false, error: 'Invalid referral code' };
    }

    const referrerWallet = codeRow.rows[0].wallet;

    if (referrerWallet === refereeWallet) {
      return { ok: false, error: 'Cannot use your own referral code' };
    }

    const existingUse = await db.query(
      'SELECT id FROM referral_uses WHERE referee_wallet = $1',
      [refereeWallet]
    );
    if (existingUse.rows.length > 0) {
      return { ok: false, error: 'Referral code already applied to this wallet' };
    }

    const config = await this.getRewardConfig();

    let insertResult;
    try {
      insertResult = await db.query(
        `INSERT INTO referral_uses (code, referrer_wallet, referee_wallet, referrer_reward_amount, referee_reward_amount)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (referee_wallet) DO NOTHING
         RETURNING id`,
        [codeUpper, referrerWallet, refereeWallet, config.referrerReward, config.refereeReward]
      );
    } catch (err) {
      if (err.code === '23505') {
        return { ok: false, error: 'Referral code already applied to this wallet' };
      }
      throw err;
    }

    if (!insertResult.rows.length) {
      return { ok: false, error: 'Referral code already applied to this wallet' };
    }

    console.log(`[Referral] Code ${codeUpper} applied: referrer=${referrerWallet.slice(0,8)}..., referee=${refereeWallet.slice(0,8)}... — rewards pending first swap`);

    return { ok: true, referrerWallet, refereeWallet };
  }

  async onSwapComplete(wallet) {
    if (!wallet) return null;

    const claimed = await db.query(
      `UPDATE referral_uses SET referee_first_swap = TRUE, updated_at = NOW()
       WHERE referee_wallet = $1 AND referee_first_swap = FALSE
       RETURNING *`,
      [wallet]
    );
    if (!claimed.rows.length) return null;

    const row = claimed.rows[0];

    const results = {
      referralId: row.id,
      referrerPaid: row.referrer_rewarded,
      referrerTx: row.referrer_reward_tx,
      refereePaid: row.referee_rewarded,
      refereeTx: row.referee_reward_tx,
      errors: [],
    };

    if (!row.referrer_rewarded) {
      try {
        const referrerTx = await this._transferFromPoolReserve(row.referrer_wallet, row.referrer_reward_amount);
        await db.query(
          `UPDATE referral_uses SET referrer_rewarded = TRUE, referrer_reward_tx = $2, updated_at = NOW() WHERE id = $1`,
          [row.id, referrerTx]
        );
        results.referrerPaid = true;
        results.referrerTx = referrerTx;
        console.log(`[Referral] Referrer reward ${row.referrer_reward_amount} NTC sent to ${row.referrer_wallet.slice(0,8)}..., tx=${referrerTx}`);
      } catch (err) {
        results.errors.push(`Referrer payout failed: ${err.message}`);
        console.error(`[Referral] Referrer payout failed for ${row.referrer_wallet.slice(0,8)}...:`, err.message);
      }
    }

    if (!row.referee_rewarded) {
      try {
        const refereeTx = await this._transferFromPoolReserve(row.referee_wallet, row.referee_reward_amount);
        await db.query(
          `UPDATE referral_uses SET referee_rewarded = TRUE, referee_reward_tx = $2, updated_at = NOW() WHERE id = $1`,
          [row.id, refereeTx]
        );
        results.refereePaid = true;
        results.refereeTx = refereeTx;
        console.log(`[Referral] Referee reward ${row.referee_reward_amount} NTC sent to ${row.referee_wallet.slice(0,8)}..., tx=${refereeTx}`);
      } catch (err) {
        results.errors.push(`Referee payout failed: ${err.message}`);
        console.error(`[Referral] Referee payout failed for ${row.referee_wallet.slice(0,8)}...:`, err.message);
      }
    }

    return {
      referrerWallet: row.referrer_wallet,
      refereeWallet: row.referee_wallet,
      referrerReward: row.referrer_reward_amount,
      refereeReward: row.referee_reward_amount,
      referralId: row.id,
      ...results,
    };
  }

  async retryFailedPayouts() {
    const unpaid = await db.query(
      `SELECT * FROM referral_uses WHERE referee_first_swap = TRUE AND (referrer_rewarded = FALSE OR referee_rewarded = FALSE)`
    );

    const results = [];
    for (const row of unpaid.rows) {
      const entry = { id: row.id, referrerPaid: row.referrer_rewarded, refereePaid: row.referee_rewarded };

      if (!row.referrer_rewarded) {
        try {
          const tx = await this._transferFromPoolReserve(row.referrer_wallet, row.referrer_reward_amount);
          await db.query(
            `UPDATE referral_uses SET referrer_rewarded = TRUE, referrer_reward_tx = $2, updated_at = NOW() WHERE id = $1`,
            [row.id, tx]
          );
          entry.referrerPaid = true;
          entry.referrerTx = tx;
        } catch (err) {
          entry.referrerError = err.message;
        }
      }

      if (!row.referee_rewarded) {
        try {
          const tx = await this._transferFromPoolReserve(row.referee_wallet, row.referee_reward_amount);
          await db.query(
            `UPDATE referral_uses SET referee_rewarded = TRUE, referee_reward_tx = $2, updated_at = NOW() WHERE id = $1`,
            [row.id, tx]
          );
          entry.refereePaid = true;
          entry.refereeTx = tx;
        } catch (err) {
          entry.refereeError = err.message;
        }
      }

      results.push(entry);
    }

    return results;
  }

  async getStats(wallet) {
    if (!wallet) return { totalReferrals: 0, completedSwaps: 0, totalRewardsEarned: 0, pendingRewards: 0, referrals: [] };

    const codeRow = await db.query('SELECT code FROM referral_codes WHERE wallet = $1', [wallet]);
    const code = codeRow.rows[0]?.code || null;

    const result = await db.query(
      `SELECT
        COUNT(*) AS total_referrals,
        COALESCE(SUM(CASE WHEN referee_first_swap = TRUE THEN 1 ELSE 0 END), 0) AS completed_swaps,
        COALESCE(SUM(CASE WHEN referrer_rewarded = TRUE THEN referrer_reward_amount ELSE 0 END), 0) AS total_rewards_earned,
        COALESCE(SUM(CASE WHEN referrer_rewarded = FALSE THEN referrer_reward_amount ELSE 0 END), 0) AS pending_rewards
       FROM referral_uses WHERE referrer_wallet = $1`,
      [wallet]
    );

    const row = result.rows[0] || {};

    const referralsList = await db.query(
      `SELECT referee_wallet, referee_first_swap, referrer_rewarded, referee_rewarded, referrer_reward_amount, referee_reward_amount, created_at
       FROM referral_uses WHERE referrer_wallet = $1 ORDER BY created_at DESC LIMIT 50`,
      [wallet]
    );

    const usedByResult = await db.query(
      'SELECT code, referrer_wallet, referee_first_swap, referee_rewarded, referee_reward_amount, created_at FROM referral_uses WHERE referee_wallet = $1 LIMIT 1',
      [wallet]
    );

    return {
      code,
      totalReferrals: parseInt(row.total_referrals) || 0,
      completedSwaps: parseInt(row.completed_swaps) || 0,
      totalRewardsEarned: parseFloat(row.total_rewards_earned) || 0,
      pendingRewards: parseFloat(row.pending_rewards) || 0,
      referrals: referralsList.rows.map(r => ({
        refereeWallet: r.referee_wallet,
        firstSwapDone: r.referee_first_swap,
        referrerRewarded: r.referrer_rewarded,
        refereeRewarded: r.referee_rewarded,
        referrerReward: r.referrer_reward_amount,
        refereeReward: r.referee_reward_amount,
        createdAt: new Date(r.created_at).getTime(),
      })),
      usedCode: usedByResult.rows[0] ? {
        code: usedByResult.rows[0].code,
        referrerWallet: usedByResult.rows[0].referrer_wallet,
        firstSwapDone: usedByResult.rows[0].referee_first_swap,
        rewarded: usedByResult.rows[0].referee_rewarded,
        rewardAmount: usedByResult.rows[0].referee_reward_amount,
        createdAt: new Date(usedByResult.rows[0].created_at).getTime(),
      } : null,
    };
  }

  async getRewardConfig() {
    const cacheKey = 'referral_config';
    const cached = memCache.get(cacheKey);
    if (cached) return cached;

    try {
      const result = await db.query(
        'SELECT referrer_reward, referee_reward FROM referral_config ORDER BY updated_at DESC LIMIT 1'
      );
      if (result.rows.length > 0) {
        const config = {
          referrerReward: parseFloat(result.rows[0].referrer_reward) || DEFAULT_REFERRER_REWARD,
          refereeReward: parseFloat(result.rows[0].referee_reward) || DEFAULT_REFEREE_REWARD,
        };
        memCache.set(cacheKey, config, 60);
        return config;
      }
    } catch (e) {
      console.warn('[Referral] Failed to read config from DB:', e.message);
    }

    const defaults = { referrerReward: DEFAULT_REFERRER_REWARD, refereeReward: DEFAULT_REFEREE_REWARD };
    memCache.set(cacheKey, defaults, 60);
    return defaults;
  }

  invalidateConfigCache() {
    memCache.del('referral_config');
  }

  async getConfigHistory(limit = 20) {
    try {
      const result = await db.query(
        'SELECT referrer_reward, referee_reward, updated_by, updated_at FROM referral_config ORDER BY updated_at DESC LIMIT $1',
        [limit]
      );
      return result.rows.map(r => ({
        referrerReward: parseFloat(r.referrer_reward),
        refereeReward: parseFloat(r.referee_reward),
        updatedBy: r.updated_by,
        updatedAt: r.updated_at,
      }));
    } catch (e) {
      console.warn('[Referral] Failed to read config history:', e.message);
      return [];
    }
  }

  async getAdminStats() {
    const config = await this.getRewardConfig();
    const result = await db.query(`
      SELECT
        COUNT(DISTINCT rc.wallet) AS total_codes,
        (SELECT COUNT(*) FROM referral_uses) AS total_uses,
        (SELECT COUNT(*) FROM referral_uses WHERE referee_first_swap = TRUE) AS completed_swaps,
        (SELECT COALESCE(SUM(referrer_reward_amount), 0) FROM referral_uses WHERE referrer_rewarded = TRUE) AS total_referrer_rewards_paid,
        (SELECT COALESCE(SUM(referee_reward_amount), 0) FROM referral_uses WHERE referee_rewarded = TRUE) AS total_referee_rewards_paid,
        (SELECT COALESCE(SUM(referrer_reward_amount), 0) FROM referral_uses WHERE referee_first_swap = TRUE AND referrer_rewarded = FALSE) AS pending_referrer_rewards,
        (SELECT COALESCE(SUM(referee_reward_amount), 0) FROM referral_uses WHERE referee_first_swap = TRUE AND referee_rewarded = FALSE) AS pending_referee_rewards
      FROM referral_codes rc
    `);

    const row = result.rows[0] || {};
    return {
      config,
      totalCodes: parseInt(row.total_codes) || 0,
      totalUses: parseInt(row.total_uses) || 0,
      completedSwaps: parseInt(row.completed_swaps) || 0,
      totalReferrerRewardsPaid: parseFloat(row.total_referrer_rewards_paid) || 0,
      totalRefereeRewardsPaid: parseFloat(row.total_referee_rewards_paid) || 0,
      pendingReferrerRewards: parseFloat(row.pending_referrer_rewards) || 0,
      pendingRefereeRewards: parseFloat(row.pending_referee_rewards) || 0,
    };
  }
}

module.exports = { ReferralDbService };
