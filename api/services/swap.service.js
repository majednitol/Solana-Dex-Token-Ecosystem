'use strict';

const { PublicKey, Transaction, TransactionInstruction, Connection, Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

/**
 * SwapService (AUTO-POOL MODE, Orca new stack)
 *
 * Universal transfer fee (0.05%):
 * - Production best: Token-2022 TransferFee extension at mint-time.
 * - Orca swap executes normal token transfers; the token program enforces fees.
 * - We adjust QUOTES here so UI/API reflects net received after fee.
 */

function mustEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env: ${name}`);
  return String(v).trim();
}

function optEnv(name, def = undefined) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return def;
  return String(v).trim();
}

const { getWalletBytes, getWalletKeypair } = require('../utils/wallet');

function loadKeypairFromPath(p) {
  try {
    const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
    const raw = fs.readFileSync(abs, 'utf8');
    const arr = JSON.parse(raw);
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch (_) {
    return getWalletKeypair();
  }
}

function toBigIntLike(x) {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(x);
  if (typeof x === 'string') return BigInt(x);
  throw new Error('amountIn must be bigint | number | string');
}

/** ---------- Universal fee helpers (0.05%) ---------- */
const TRANSFER_FEE_BPS = Number(process.env.TRANSFER_FEE_BPS ?? '5'); // 5 bps = 0.05%
const BPS_DENOM = 10_000n;

function ceilDiv(a, b) {
  return (a + b - 1n) / b;
}

function calcTransferFee(amount, feeBps = TRANSFER_FEE_BPS) {
  const amt = BigInt(amount);
  const bps = BigInt(feeBps);
  if (amt <= 0n || bps <= 0n) return 0n;
  return ceilDiv(amt * bps, BPS_DENOM);
}

function applyTransferFeeNet(amount, feeBps = TRANSFER_FEE_BPS) {
  const amt = BigInt(amount);
  const fee = calcTransferFee(amt, feeBps);
  if (fee <= 0n) return amt;
  if (fee >= amt) return 0n;
  return amt - fee;
}

/** ---------- kit instruction -> web3 instruction ---------- */
function pickPubkeyString(a) {
  return a?.pubkey?.toString?.() ?? a?.address?.toString?.() ?? a?.pubkey ?? a?.address ?? a;
}

function detectSigner(a) {
  if (typeof a?.role === 'number') return (a.role & 2) !== 0;
  const role = String(a?.role ?? '').toLowerCase();
  const mode = String(a?.mode ?? '').toLowerCase();
  const access = String(a?.access ?? '').toLowerCase();
  return Boolean(a?.isSigner) || Boolean(a?.signer) || role.includes('signer') || mode.includes('signer') || access.includes('signer');
}

function detectWritable(a) {
  if (typeof a?.role === 'number') return (a.role & 1) !== 0;

  if (a?.isWritable !== undefined) return Boolean(a.isWritable);
  if (a?.writable !== undefined) return Boolean(a.writable);
  if (a?.meta?.isWritable !== undefined) return Boolean(a.meta.isWritable);
  if (a?.meta?.writable !== undefined) return Boolean(a.meta.writable);

  const role = String(a?.role ?? '').toLowerCase();
  const mode = String(a?.mode ?? '').toLowerCase();
  const access = String(a?.access ?? '').toLowerCase();

  if (role.includes('writable')) return true;
  if (mode.includes('writable')) return true;
  if (access.includes('writable')) return true;

  return false;
}

function kitIxToWeb3Ix(ix, forceWritablePubkeys = new Set()) {
  const programIdStr = ix?.programAddress ?? ix?.programId ?? ix?.program;
  if (!programIdStr) throw new Error('Instruction missing programAddress/programId');

  const programId = new PublicKey(String(programIdStr));

  const keys = (ix.accounts ?? []).map((a) => {
    const pkStr = pickPubkeyString(a);
    if (!pkStr) throw new Error('Account meta missing pubkey/address');

    const pubkeyStr = String(pkStr);
    const isSigner = detectSigner(a);
    const isWritable = forceWritablePubkeys.has(pubkeyStr) ? true : detectWritable(a);

    return { pubkey: new PublicKey(pubkeyStr), isSigner, isWritable };
  });

  const dataU8 = ix?.data ?? new Uint8Array();

  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(dataU8),
  });
}

/** ---------- singleton Orca new-stack runtime ---------- */
let _boot = null;

async function bootOrcaNewStack() {
  if (_boot) return _boot;

  _boot = (async () => {
    const { getRpcUrl, getOrcaWhirlpoolsConfig, wrapRpcUrl } = require('../utils/network');
    const RPC_URL = getRpcUrl();

    const kit = await import('@solana/kit');
    const whirlpools = await import('@orca-so/whirlpools');

    await whirlpools.setWhirlpoolsConfig(getOrcaWhirlpoolsConfig());
    await whirlpools.setRpc(RPC_URL);

    const rpc = kit.createSolanaRpc(await wrapRpcUrl(RPC_URL));

    const payerBytes = getWalletBytes();
    const signer = await whirlpools.setPayerFromBytes(payerBytes);

    const connection = new Connection(RPC_URL, 'confirmed');
    const payer = getWalletKeypair();

    return { RPC_URL, rpc, signer, connection, payer, kit, whirlpools };
  })();

  return _boot;
}



async function getPoolAddressFromDb(mintIn, mintOut) {
  try {
    const { query: dbQuery } = require('../db/init');
    const mintInStr = String(mintIn);
    const mintOutStr = String(mintOut);
    const result = await dbQuery(
      `SELECT pool_address, tick_spacing FROM pools
       WHERE (token_a_mint = $1 AND token_b_mint = $2)
          OR (token_a_mint = $2 AND token_b_mint = $1)
       ORDER BY id LIMIT 1`,
      [mintInStr, mintOutStr]
    );
    if (result.rows && result.rows.length > 0) {
      return result.rows[0];
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function findBestPoolForExactIn({ mintIn, mintOut, amountIn, slippageBps }) {
  const { rpc, signer, kit, whirlpools } = await bootOrcaNewStack();

  const mintInAddr = kit.address(String(mintIn));
  const mintOutAddr = kit.address(String(mintOut));
  const amt = toBigIntLike(amountIn);

  const dbPool = await getPoolAddressFromDb(mintIn, mintOut);

  if (dbPool && dbPool.pool_address) {
    try {
      const poolAddr = kit.address(dbPool.pool_address);
      const { instructions, quote } = await whirlpools.swapInstructions(
        rpc,
        { inputAmount: amt, mint: mintInAddr },
        poolAddr,
        slippageBps,
        signer
      );
      const estOut = BigInt(quote.tokenEstOut ?? quote.estimatedAmountOut ?? 0n);
      return {
        poolAddress: poolAddr,
        tickSpacing: dbPool.tick_spacing || 64,
        feeRate: 3000,
        quote,
        instructions,
        estOut,
      };
    } catch (dbPoolErr) {
      console.warn('[Swap] DB pool quote failed, falling back to pool scan:', dbPoolErr.message);
    }
  }

  const pools = await whirlpools.fetchWhirlpoolsByTokenPair(rpc, mintInAddr, mintOutAddr);
  if (!pools || pools.length === 0) {
    throw new Error('No Orca pools found for this mint pair on this network.');
  }

  const TARGET_FEE_RATE = 3000;
  const preferred = pools.filter(p => p.initialized && p.feeRate === TARGET_FEE_RATE);
  const poolsToQuote = preferred.length > 0 ? preferred : pools.filter(p => p.initialized);

  let best = null;

  for (const p of poolsToQuote) {
    const poolAddress = p.address ?? p.poolAddress ?? p.whirlpoolAddress;
    if (!poolAddress) continue;

    try {
      const { instructions, quote } = await whirlpools.swapInstructions(
        rpc,
        { inputAmount: amt, mint: mintInAddr },
        poolAddress,
        slippageBps,
        signer
      );

      const estOut = BigInt(quote.tokenEstOut ?? quote.estimatedAmountOut ?? 0n);

      if (!best || estOut > best.estOut) {
        best = {
          poolAddress,
          tickSpacing: p.tickSpacing,
          feeRate: p.feeRate,
          quote,
          instructions,
          estOut,
        };
      }
    } catch (_) {}
  }

  if (!best) throw new Error('Found pools, but none could produce a quote for this input.');
  return best;
}

/** ---------- execute swap server-side ---------- */
async function executeSwapServerSide({ instructionsKit, forceWritablePubkeys }) {
  const { connection, payer } = await bootOrcaNewStack();

  const web3Ixs = instructionsKit.map((ix) => kitIxToWeb3Ix(ix, forceWritablePubkeys));
  const tx = new Transaction().add(...web3Ixs);

  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  tx.sign(payer);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });

  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

/** =================== SERVICE =================== */
class SwapService {
  constructor({ connection, orca, tokensService, treasuryVault }) {
    this.connection = connection;
    this.orca = orca;
    this.tokensService = tokensService;
    this.treasuryVault = treasuryVault ? new PublicKey(treasuryVault) : null;
  }

  /**
   * GET /quote (AUTO POOL)
   * NOTE: We return gross and net (after universal 0.05% output transfer fee).
   */
  async getQuote({ mintIn, mintOut, amountIn, slippageBps = 50 }) {
    if (!mintIn || !mintOut) throw new Error('getQuote: mintIn & mintOut required');
    if (amountIn === undefined) throw new Error('getQuote: amountIn required');

    const best = await findBestPoolForExactIn({
      mintIn,
      mintOut,
      amountIn,
      slippageBps: Number(slippageBps),
    });

    const tokenEstOutGross = BigInt(best.quote.tokenEstOut ?? best.quote.estimatedAmountOut ?? 0n);
    const tokenMinOutGross = BigInt(best.quote.tokenMinOut ?? best.quote.otherAmountThreshold ?? 0n);

    // Universal fee applies on OUTPUT token transfer to user (Token-2022 TransferFee extension).
    const tokenEstOutNet = applyTransferFeeNet(tokenEstOutGross, TRANSFER_FEE_BPS);
    const tokenMinOutNet = applyTransferFeeNet(tokenMinOutGross, TRANSFER_FEE_BPS);

    return {
      pool: String(best.poolAddress),
      tickSpacing: Number(best.tickSpacing ?? 0),
      feeBps: TRANSFER_FEE_BPS,
      poolFeeBps: 30,
      quote: {
        tokenEstOutGross: tokenEstOutGross.toString(),
        tokenEstOutNet: tokenEstOutNet.toString(),
        tokenMinOutGross: tokenMinOutGross.toString(),
        tokenMinOutNet: tokenMinOutNet.toString(),
        raw: best.quote,
      },
    };
  }

  /**
   * POST /swap (AUTO POOL, server-side execute)
   * Execution stays Orca-native.
   * We still return gross/net expectations for dashboards.
   */
  async swapExactIn({ mintIn, mintOut, amountIn, slippageBps = 50 }) {
    if (!mintIn || !mintOut) throw new Error('swapExactIn: mintIn & mintOut required');
    if (amountIn === undefined) throw new Error('swapExactIn: amountIn required');

    const best = await findBestPoolForExactIn({
      mintIn,
      mintOut,
      amountIn,
      slippageBps: Number(slippageBps),
    });

    const forceWritable = new Set([String(best.poolAddress)]);

    const signature = await executeSwapServerSide({
      instructionsKit: best.instructions,
      forceWritablePubkeys: forceWritable,
    });

    const tokenEstOutGross = BigInt(best.quote.tokenEstOut ?? best.quote.estimatedAmountOut ?? 0n);
    const tokenMinOutGross = BigInt(best.quote.tokenMinOut ?? best.quote.otherAmountThreshold ?? 0n);

    const tokenEstOutNet = applyTransferFeeNet(tokenEstOutGross, TRANSFER_FEE_BPS);
    const tokenMinOutNet = applyTransferFeeNet(tokenMinOutGross, TRANSFER_FEE_BPS);

    return {
      pool: String(best.poolAddress),
      signature,
      feeBps: TRANSFER_FEE_BPS,
      quote: {
        tokenEstOutGross: tokenEstOutGross.toString(),
        tokenEstOutNet: tokenEstOutNet.toString(),
        tokenMinOutGross: tokenMinOutGross.toString(),
        tokenMinOutNet: tokenMinOutNet.toString(),
      },
    };
  }

}

module.exports = { SwapService };

