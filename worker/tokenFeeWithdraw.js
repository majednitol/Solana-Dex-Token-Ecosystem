'use strict';

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(process.cwd(), 'api/.env') });
if (!process.env.SOLANA_RPC_URL) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
}

const { Connection, PublicKey } = require('@solana/web3.js');
const { initDatabase, query: dbQuery, shutdown: dbShutdown } = require('../api/db/init');
const { CacheService } = require('../api/services/cache.service');
const { TreasuryService } = require('../api/services/treasury.service');

const INTERVAL_MS = Number(process.env.TOKEN_FEE_INTERVAL_MS || 3600000);
const { getRpcUrl } = require('../api/utils/network');
const RPC_URL = getRpcUrl();
const COMMITMENT = process.env.SOLANA_COMMITMENT || 'confirmed';
const SQUADS_VAULT_ADDRESS = process.env.SQUADS_VAULT_ADDRESS || null;

let running = true;
let timer = null;
let cache = null;
let treasuryService = null;

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
    console.warn('[TokenFeeWithdraw] Could not resolve vault from DB:', e.message);
    return null;
  }
}

async function runCycle() {
  const cycleStart = Date.now();
  console.log(`\n[TokenFeeWithdraw] === Withdrawal cycle started at ${new Date().toISOString()} ===`);

  try {
    const result = await treasuryService.withdrawAllTransferFees();
    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    console.log(`[TokenFeeWithdraw] === Cycle complete in ${elapsed}s ===`);
    console.log(`[TokenFeeWithdraw]   Transfer fees: ${result.succeeded}/${result.total} succeeded`);

    if (result.errors && result.errors.length > 0) {
      for (const err of result.errors) {
        console.warn(`[TokenFeeWithdraw]   Error: ${err}`);
      }
    }
  } catch (e) {
    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    console.error(`[TokenFeeWithdraw] === Cycle failed in ${elapsed}s ===`);
    console.error(`[TokenFeeWithdraw]   Error: ${e.message}`);
  }
}

async function main() {
  console.log('[TokenFeeWithdraw] Starting token fee withdrawal worker...');
  console.log(`[TokenFeeWithdraw] Interval: ${INTERVAL_MS}ms (${(INTERVAL_MS / 60000).toFixed(1)} min)`);
  console.log(`[TokenFeeWithdraw] RPC: ${RPC_URL}`);
  console.log(`[TokenFeeWithdraw] Squads vault: ${SQUADS_VAULT_ADDRESS || 'not configured (using default treasury)'}`);

  const dbOk = await initDatabase();
  if (!dbOk) {
    console.error('[TokenFeeWithdraw] Database init failed — exiting');
    process.exit(1);
  }

  cache = new CacheService();
  await cache.init();

  const connection = new Connection(RPC_URL, COMMITMENT);

  const vaultAddress = await resolveVaultFromDb();

  let tokensService = null;
  try {
    const { TokensService } = require('../api/services/tokens.service');
    tokensService = new TokensService({
      connection,
      treasuryPubkey: vaultAddress || 'unknown',
    });
    if (tokensService.loadFromDatabase) {
      await tokensService.loadFromDatabase();
    } else if (tokensService.loadFromRegistry) {
      await tokensService.loadFromRegistry();
    }
    console.log(`[TokenFeeWithdraw] Tokens loaded: ${tokensService.listTokens().length}`);
  } catch (e) {
    console.warn('[TokenFeeWithdraw] Could not load TokensService:', e.message);
  }

  treasuryService = new TreasuryService({
    connection,
    cacheService: cache,
    tokensService,
  });

  if (vaultAddress) {
    try {
      treasuryService.setSquadsVault(vaultAddress);
      console.log(`[TokenFeeWithdraw] Squads vault configured: ${vaultAddress}`);
    } catch (e) {
      console.warn('[TokenFeeWithdraw] Failed to set Squads vault:', e.message);
    }
  }

  const depositTarget = treasuryService.getDepositTarget();
  console.log(`[TokenFeeWithdraw] Deposit target: ${depositTarget ? depositTarget.toBase58() : 'not set'}`);

  try {
    const state = await treasuryService.getMultisigState();
    if (state.initialized) {
      console.log(`[TokenFeeWithdraw] Multisig initialized: threshold=${state.threshold}, owners=${state.owners.length}`);
    } else {
      console.warn('[TokenFeeWithdraw] Multisig not initialized on-chain — fee withdrawal via CPI may fail');
    }
  } catch (e) {
    console.warn('[TokenFeeWithdraw] Could not check multisig state:', e.message);
  }

  await runCycle();

  if (running) {
    timer = setInterval(async () => {
      if (!running) return;
      try {
        await runCycle();
      } catch (e) {
        console.error('[TokenFeeWithdraw] Cycle error:', e.message);
      }
    }, INTERVAL_MS);
  }
}

async function shutdown(signal) {
  console.log(`\n[TokenFeeWithdraw] Received ${signal} — shutting down gracefully...`);
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (cache) {
    await cache.shutdown();
  }
  await dbShutdown();
  console.log('[TokenFeeWithdraw] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((e) => {
  console.error('[TokenFeeWithdraw] Fatal error:', e.stack || e.message);
  process.exit(1);
});
