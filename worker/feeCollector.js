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

const INTERVAL_MS = Number(process.env.FEE_COLLECT_INTERVAL_MS || 86400000);
const { getRpcUrl } = require('../api/utils/network');
const RPC_URL = getRpcUrl();
const COMMITMENT = process.env.SOLANA_COMMITMENT || 'confirmed';

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
    console.warn('[FeeCollector] Could not resolve vault from DB:', e.message);
    return null;
  }
}

async function runCycle() {
  const cycleStart = Date.now();
  const depositTarget = treasuryService.getDepositTarget();
  const destination = depositTarget ? `vault (${depositTarget.toBase58()})` : 'default treasury authority';
  console.log(`\n[FeeCollector] === Collection cycle started at ${new Date().toISOString()} ===`);
  console.log(`[FeeCollector] Fee destination: ${destination}`);

  let poolResult = { ok: false, error: 'skipped' };
  let transferResult = { succeeded: 0, total: 0 };

  try {
    transferResult = await treasuryService.withdrawAllTransferFees();
  } catch (e) {
    transferResult = { succeeded: 0, total: 0, error: e.message };
  }

  await new Promise(r => setTimeout(r, 3000));

  try {
    if (cache?.enabled) {
      await cache.set('fee_collector:pool_harvest', { active: true, startedAt: Date.now() }, 300);
      console.log('[FeeCollector] Set pool harvest flag — Price Watcher will pause');
      await new Promise(r => setTimeout(r, 5000));
    }
    poolResult = await treasuryService.collectPoolFees();
  } catch (e) {
    poolResult = { ok: false, error: e.message };
  } finally {
    if (cache?.enabled) {
      try { await cache.client.del('fee_collector:pool_harvest'); } catch (_) {}
      console.log('[FeeCollector] Cleared pool harvest flag — Price Watcher can resume');
    }
  }

  const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
  console.log(`[FeeCollector] === Cycle complete in ${elapsed}s ===`);
  console.log(`[FeeCollector]   Pool fees: ${poolResult.ok ? (poolResult.skipped ? 'no fees to collect' : (poolResult.harvested || 0) + ' harvested') : 'ERROR: ' + poolResult.error}`);
  console.log(`[FeeCollector]   Transfer fees: ${transferResult.succeeded} collected, ${transferResult.skipped || 0} skipped (no fees), ${transferResult.total} total`);

  if (poolResult.results && poolResult.results.length > 0) {
    for (const r of poolResult.results) {
      if (r && r.amount > 0) {
        console.log(`[FeeCollector]     POOL ${r.token_symbol || 'POOL'}: ${r.amount} (tx: ${r.tx_signature || 'n/a'})`);
      }
    }
  }

  if (transferResult.results) {
    for (const r of transferResult.results) {
      if (r.ok && r.amount > 0) {
        console.log(`[FeeCollector]     ${r.symbol}: ${r.amount} -> vault (tx: ${r.txSignature})`);
      }
    }
  }
}

async function main() {
  console.log('[FeeCollector] Starting fee collector worker...');
  console.log(`[FeeCollector] Interval: ${INTERVAL_MS}ms (${(INTERVAL_MS / 60000).toFixed(1)} min)`);
  console.log(`[FeeCollector] RPC: ${RPC_URL}`);

  const dbOk = await initDatabase();
  if (!dbOk) {
    console.error('[FeeCollector] Database init failed — exiting');
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
    console.log(`[FeeCollector] Tokens loaded: ${tokensService.listTokens().length}`);
  } catch (e) {
    console.warn('[FeeCollector] Could not load TokensService:', e.message);
  }

  treasuryService = new TreasuryService({
    connection,
    cacheService: cache,
    tokensService,
  });
  if (vaultAddress) {
    treasuryService.setSquadsVault(vaultAddress);
    console.log(`[FeeCollector] Squads vault set from DB: ${vaultAddress}`);
  } else {
    console.warn('[FeeCollector] No vault address found — fees may not route to treasury');
  }

  const depositTarget = treasuryService.getDepositTarget();
  console.log(`[FeeCollector] Deposit target: ${depositTarget ? depositTarget.toBase58() : 'not set'}`);

  await runCycle();

  if (running) {
    timer = setInterval(async () => {
      if (!running) return;
      try {
        await runCycle();
      } catch (e) {
        console.error('[FeeCollector] Cycle error:', e.message);
      }
    }, INTERVAL_MS);
  }
}

async function shutdown(signal) {
  console.log(`\n[FeeCollector] Received ${signal} — shutting down gracefully...`);
  running = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (cache) {
    await cache.shutdown();
  }
  await dbShutdown();
  console.log('[FeeCollector] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((e) => {
  console.error('[FeeCollector] Fatal error:', e.stack || e.message);
  process.exit(1);
});
