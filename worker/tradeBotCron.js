'use strict';

const fs = require('fs');
const path = require('path');
const bs58 = require('bs58');

require('dotenv').config({ path: path.resolve(process.cwd(), 'api/.env') });
if (!process.env.SOLANA_RPC_URL) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
}

const botKey = process.env.WALLET_KEY || process.env.TRADE_BOT_PRIVATE_KEY;
if (!botKey) {
  console.error('[TradeBot] Missing WALLET_KEY env var');
  process.exit(1);
}
const decoded = bs58.decode(botKey);
const keypairArray = Array.from(decoded);
const tmpKeypairPath = path.resolve('/tmp', 'trade_bot_keypair.json');
fs.writeFileSync(tmpKeypairPath, JSON.stringify(keypairArray));
process.env.WALLET_KEYPAIR_PATH = tmpKeypairPath;

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} = require('@solana/spl-token');
const { initDatabase } = require('../api/db/init');
const { CacheService } = require('../api/services/cache.service');
const { TradeService } = require('../api/services/trade.service');
const { SwapService } = require('../api/services/swap.service');

const TOTAL_TRADES = 10_000;
const DURATION_MS = 2 * 60 * 60 * 1000;
const INTERVAL_MS = Math.floor(DURATION_MS / TOTAL_TRADES);
const { getRpcUrl } = require('../api/utils/network');
const RPC_URL = getRpcUrl();
const DECIMALS = 5;
const RAW_FACTOR = 10 ** DECIMALS;

async function getNtcMintFromDb() {
  const { query } = require('../api/db/init');
  const result = await query('SELECT mint_address FROM tokens WHERE symbol = $1', ['NTC']);
  if (result.rows.length > 0) return result.rows[0].mint_address;
  return null;
}

const FIXED_TOKENS = {
  ASDC: { mint: '7mYrsR87Yfbr4qBqfHaAiawkTSG6DzduPdPk915pMqXd', symbol: 'ASDC' },
  EDC:  { mint: '3Bhw91Pb8qK14THnRzGhxvyAYVE5q3AyMyd5JEKU9q8Y',  symbol: 'EDC' },
  RDC:  { mint: '2HhsSMYPfwmmztHzqSt1szHZ2P7A2vqmGtFPvHpQ9ytL',  symbol: 'RDC' },
};

let TOKENS = {};

let running = true;
let stats = { success: 0, failed: 0, skipped: 0, totalAttempted: 0 };

async function getTokenBalance(connection, owner, mintAddress) {
  try {
    const mint = new PublicKey(mintAddress);
    const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
    const bal = await connection.getTokenAccountBalance(ata);
    return {
      uiAmount: parseFloat(bal.value.uiAmount || 0),
      rawAmount: BigInt(bal.value.amount || '0'),
    };
  } catch (e) {
    if (e.message?.includes('could not find account')) {
      return { uiAmount: 0, rawAmount: 0n };
    }
    throw e;
  }
}

function calculateSwapAmount(walletBalance) {
  if (walletBalance <= 0n) return 0n;

  const minTrade = BigInt(1 * RAW_FACTOR);
  const maxTrade = BigInt(50 * RAW_FACTOR);

  const maxSafe = walletBalance / 100n;

  if (maxSafe < minTrade) return 0n;

  const upper = maxSafe < maxTrade ? maxSafe : maxTrade;
  const range = Number(upper - minTrade);
  if (range <= 0) return minTrade;

  const randomAmount = minTrade + BigInt(Math.floor(Math.random() * range));
  return randomAmount;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, maxRetries = 5) {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e.message || '';
      const is429 = msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('rate limit');
      const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT');

      if ((is429 || isTimeout) && attempt < maxRetries) {
        const jitter = Math.random() * 1000;
        console.log(`[TradeBot] Retry ${attempt}/${maxRetries} after ${Math.round(delay + jitter)}ms (${is429 ? '429' : 'timeout'})`);
        await sleep(delay + jitter);
        delay *= 2;
        continue;
      }
      throw e;
    }
  }
}

async function executeTrade({ connection, swapService, tradeService, wallet, pair, tradeNum }) {
  const { from, to } = pair;
  const tag = `[Trade #${tradeNum}] ${from.symbol}→${to.symbol}`;

  const balance = await getTokenBalance(connection, wallet.publicKey, from.mint);
  const swapAmount = calculateSwapAmount(balance.rawAmount);

  if (swapAmount <= 0n) {
    console.log(`${tag} SKIP — insufficient ${from.symbol} balance (${balance.uiAmount})`);
    stats.skipped++;
    return null;
  }

  const humanAmount = Number(swapAmount) / RAW_FACTOR;
  console.log(`${tag} Swapping ${humanAmount.toFixed(5)} ${from.symbol} → ${to.symbol} (wallet bal: ${balance.uiAmount})`);

  const result = await retryWithBackoff(async () => {
    return await swapService.swapExactIn({
      mintIn: from.mint,
      mintOut: to.mint,
      amountIn: swapAmount.toString(),
      slippageBps: 100,
    });
  });

  const estOut = parseFloat(result.quote?.tokenEstOutNet || '0') / RAW_FACTOR;
  const price = humanAmount > 0 ? estOut / humanAmount : 0;

  await tradeService.recordTrade({
    eventType: 'swap',
    tokenA: from.symbol,
    tokenB: to.symbol,
    tokenAMint: from.mint,
    tokenBMint: to.mint,
    amountIn: humanAmount,
    amountOut: estOut,
    price: price,
    poolAddress: result.pool || '',
    txSignature: result.signature,
    wallet: wallet.publicKey.toBase58(),
  });

  console.log(`${tag} OK sig=${result.signature.slice(0, 16)}… out=${estOut.toFixed(5)} price=${price.toFixed(6)}`);
  stats.success++;
  return result;
}

async function main() {
  console.log('[TradeBot] ============================================');
  console.log(`[TradeBot] Starting: ${TOTAL_TRADES} trades over ${DURATION_MS / 60000} minutes`);
  console.log(`[TradeBot] Interval: ~${INTERVAL_MS}ms between trades`);
  console.log('[TradeBot] ============================================');

  await initDatabase();
  console.log('[TradeBot] Database connected');

  const ntcMint = await getNtcMintFromDb();
  if (!ntcMint) {
    console.warn('[TradeBot] NTC token not found in database — skipping trade bot');
    process.exit(0);
  }
  TOKENS = { NTC: { mint: ntcMint, symbol: 'NTC' }, ...FIXED_TOKENS };
  const PAIRS = [];
  for (const sym of Object.keys(FIXED_TOKENS)) {
    PAIRS.push({ from: TOKENS.NTC, to: TOKENS[sym] });
    PAIRS.push({ from: TOKENS[sym], to: TOKENS.NTC });
  }
  console.log(`[TradeBot] NTC mint loaded from DB: ${ntcMint}`);
  console.log(`[TradeBot] Pairs: NTC/ASDC, NTC/EDC, NTC/RDC (bidirectional)`);

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairArray));
  console.log(`[TradeBot] Wallet: ${wallet.publicKey.toBase58()}`);

  let cache = null;
  try {
    cache = new CacheService();
    await cache.init();
    console.log('[TradeBot] Cache connected');
  } catch (e) {
    console.warn('[TradeBot] Cache not available, proceeding without:', e.message);
    cache = null;
  }

  const swapService = new SwapService({ connection });
  const tradeService = new TradeService({ cacheService: cache });

  for (const token of Object.values(TOKENS)) {
    try {
      const bal = await getTokenBalance(connection, wallet.publicKey, token.mint);
      console.log(`[TradeBot] Balance ${token.symbol}: ${bal.uiAmount}`);
    } catch (e) {
      console.warn(`[TradeBot] Could not fetch ${token.symbol} balance:`, e.message);
    }
  }

  const startTime = Date.now();
  let pairIndex = 0;

  for (let i = 1; i <= TOTAL_TRADES && running; i++) {
    stats.totalAttempted = i;
    const pair = PAIRS[pairIndex % PAIRS.length];
    pairIndex++;

    try {
      await executeTrade({ connection, swapService, tradeService, wallet, pair, tradeNum: i });
    } catch (e) {
      stats.failed++;
      console.error(`[Trade #${i}] FAILED ${pair.from.symbol}→${pair.to.symbol}: ${e.message}`);
    }

    if (i < TOTAL_TRADES && running) {
      const elapsed = Date.now() - startTime;
      const expectedElapsed = i * INTERVAL_MS;
      const sleepTime = Math.max(100, expectedElapsed - elapsed);
      await sleep(sleepTime);
    }

    if (i % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
      console.log(`[TradeBot] Progress: ${i}/${TOTAL_TRADES} | OK:${stats.success} FAIL:${stats.failed} SKIP:${stats.skipped} | ${elapsed}min elapsed`);
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log('[TradeBot] ============================================');
  console.log(`[TradeBot] COMPLETE after ${totalElapsed} minutes`);
  console.log(`[TradeBot]   Attempted: ${stats.totalAttempted}`);
  console.log(`[TradeBot]   Succeeded: ${stats.success}`);
  console.log(`[TradeBot]   Failed:    ${stats.failed}`);
  console.log(`[TradeBot]   Skipped:   ${stats.skipped}`);
  console.log('[TradeBot] ============================================');

  try { fs.unlinkSync(tmpKeypairPath); } catch {}
  if (cache) await cache.shutdown?.();
  process.exit(0);
}

process.on('SIGTERM', () => {
  console.log('[TradeBot] Received SIGTERM, finishing current trade...');
  running = false;
});
process.on('SIGINT', () => {
  console.log('[TradeBot] Received SIGINT, finishing current trade...');
  running = false;
});

main().catch(e => {
  console.error('[TradeBot] Fatal error:', e);
  try { fs.unlinkSync(tmpKeypairPath); } catch {}
  process.exit(1);
});
