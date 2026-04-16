'use strict';



const { PublicKey } = require('@solana/web3.js');
const { createSolanaRpc, address } = require('@solana/kit');

const {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  createConcentratedLiquidityPool,
  fetchWhirlpoolsByTokenPair,
} = require('@orca-so/whirlpools');

function optEnv(name, def = undefined) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return def;
  return String(v).trim();
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

const fs = require('fs');
const path = require('path');

const { getWalletBytes } = require('../utils/wallet');

function readKeypairBytes(filePath) {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const raw = fs.readFileSync(abs, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error(`Invalid keypair json: ${abs}`);
    const u8 = new Uint8Array(arr);
    return new Uint8Array(u8.buffer.slice(0));
  } catch (_) {
    return getWalletBytes();
  }
}


function nativeToUi(amount, decimals = 5) {
  if (amount === 0n) return "0";

  const amountStr = amount.toString();
  const dec = Number(decimals);


  const padLength = dec > amountStr.length ? dec - amountStr.length : 0;
  const padded = "0".repeat(padLength) + amountStr;


  const intPart = padded.slice(0, padded.length - dec) || "0";
  const fracPart = padded.slice(padded.length - dec);


  const trimmedFrac = fracPart.replace(/0+$/, "");

  return trimmedFrac.length > 0 ? `${intPart}.${trimmedFrac}` : intPart;
}


async function fetchVaultBalances(rpc, pool) {
  const [vaultAInfo, vaultBInfo] = await Promise.all([
    rpc.getAccountInfo(address(pool.tokenVaultA), { encoding: 'base64' }).send().catch(() => null),
    rpc.getAccountInfo(address(pool.tokenVaultB), { encoding: 'base64' }).send().catch(() => null),
  ]);

  const decodeAmount = (info) => {
    if (!info || !info.value || !info.value.data) return 0n;
    const data = info.value.data[0];
    const buffer = Buffer.from(data, 'base64');
    // SPL Token Account layout: amount is at offset 64 (u64)
    return buffer.readBigUInt64LE(64);
  };

  return {
    rawAmountA: decodeAmount(vaultAInfo),
    rawAmountB: decodeAmount(vaultBInfo),
  };
}

// ---------------------------------------------------

class PoolService {
  /**
   * @param {object} deps
   * @param {import('@solana/web3.js').Connection} deps.connection
   * @param {object} deps.tokensService (required for symbol->mint resolution)
   */
  constructor({ connection, tokensService }) {
    if (!connection) throw new Error('PoolService: connection required');
    if (!tokensService) throw new Error('PoolService: tokensService required');

    this.connection = connection;
    this.tokensService = tokensService;

    const { getRpcUrl, getOrcaWhirlpoolsConfig } = require('../utils/network');
    this.rpcUrl = getRpcUrl();
    this.commitment = optEnv('SOLANA_COMMITMENT', 'confirmed');
    this.network = getOrcaWhirlpoolsConfig();
    this.tickSpacing = Number(optEnv('ORCA_TICK_SPACING', '64'));

    this._boot = null;
    this._poolCache = new Map();
    this._poolCacheTTL = 30_000;
  }

  clearPoolCache() {
    this._poolCache.clear();
  }

  async boot() {
    if (this._boot) return this._boot;

    this._boot = (async () => {
      await setWhirlpoolsConfig(this.network);
      await setRpc(this.rpcUrl);

      const payerBytes = getWalletBytes();
      await setPayerFromBytes(payerBytes);

      return true;
    })();

    return this._boot;
  }


  resolveMint(input) {
    const s = String(input || '').trim();
    must(s, 'mint is required');

    // 1. Try PublicKey (base58)
    try {
      const pk = new PublicKey(s);
      return pk.toBase58();
    } catch (_) {}

    // 2. Try tokensService symbol lookup
    if (this.tokensService) {
      try {
        const mintPk = this.tokensService.getMint(s);
        return mintPk.toBase58();
      } catch (_) {}
    }

    throw new Error(`Could not resolve mint for input: ${s}`);
  }


  async createPool({ tokenX, tokenY, tickSpacing, priceXUsd = 1, priceYUsd = 1 }) {
    await this.boot();

    const mintX = this.resolveMint(tokenX);
    const mintY = this.resolveMint(tokenY);


    const mintABuf = Buffer.from(new PublicKey(mintX).toBytes());
    const mintBBuf = Buffer.from(new PublicKey(mintY).toBytes());
    const flipped = Buffer.compare(mintABuf, mintBBuf) > 0;

    const mintA = flipped ? mintY : mintX;
    const mintB = flipped ? mintX : mintY;

    const usedTick = Number.isFinite(Number(tickSpacing)) && Number(tickSpacing) > 0 
      ? Number(tickSpacing) 
      : this.tickSpacing;

    // Calculate initial price (Price of A in terms of B)
    // If flipped, the input priceXUsd corresponds to tokenY (which is now A)
    const initialPrice = flipped 
      ? priceYUsd / priceXUsd 
      : priceXUsd / priceYUsd;

    try {
      const { poolAddress, initializationCost, callback: sendTx } =
        await createConcentratedLiquidityPool(
          address(mintA),
          address(mintB),
          usedTick,
          initialPrice
        );

      const txId = await sendTx();
      const poolStr = String(poolAddress);

      return {
        ok: true,
        poolAddress: poolStr,
        txId,
        initializationCostLamports: String(initializationCost),
        tickSpacing: usedTick,
        initialPrice,
        mintA,
        mintB,
      };
    } catch (e) {
      const msg = String(e?.message || e);
      return {
        ok: false,
        error: msg,
        mintA,
        mintB,
        tickSpacing: usedTick,
      };
    }
  }

  /**
   * Get Pool Info (Best pool by liquidity)
   * Fetches reserves and on-chain data.
   * Decimals fixed to 5.
   */
  async getPool({ tokenA, tokenB, poolAddress }) {
    const mintA = this.resolveMint(tokenA);
    const mintB = this.resolveMint(tokenB);

    const pairKey = [mintA, mintB].sort().join(':');
    const cacheKey = poolAddress ? `${pairKey}:${poolAddress}` : pairKey;
    const cached = this._poolCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this._poolCacheTTL) {
      return cached.data;
    }

    if (poolAddress) {
      const directResult = await this.getPoolByAddress(poolAddress);
      if (directResult.ok) {
        this._poolCache.set(cacheKey, { ts: Date.now(), data: directResult });
        this._poolCache.set(pairKey, { ts: Date.now(), data: directResult });
        return directResult;
      }
    }

    const rpc = createSolanaRpc(this.rpcUrl);

    const pools = await fetchWhirlpoolsByTokenPair(
      rpc,
      address(mintA),
      address(mintB)
    );

    if (!pools || pools.length === 0) {
      return { ok: false, error: "No pools found for this pair" };
    }

    const initialized = pools.filter(p => p.initialized);
    if (initialized.length === 0) {
      return { ok: false, error: "No initialized pools found" };
    }

    const bestPool = initialized.sort(
      (a, b) => Number(b.liquidity) - Number(a.liquidity)
    )[0];

    const { rawAmountA, rawAmountB } = await fetchVaultBalances(rpc, bestPool);

    const uiAmountA = nativeToUi(rawAmountA, 5);
    const uiAmountB = nativeToUi(rawAmountB, 5);

    const poolAddr = bestPool.address.toString();
    const priceData = await this.getPoolPrice(poolAddr);

    const result = {
      ok: true,
      poolAddress: poolAddr,
      tickSpacing: bestPool.tickSpacing,
      liquidity: priceData.liquidity || '0',
      feeRate: bestPool.feeRate,
      price: priceData.price,
      sqrtPrice: priceData.sqrtPrice,
      tickCurrentIndex: priceData.tickCurrentIndex,
      reserves: {
        tokenA: {
          mint: bestPool.tokenMintA.toString(),
          vault: bestPool.tokenVaultA.toString(),
          amount: rawAmountA.toString(),
          uiAmount: uiAmountA,
          decimals: 5
        },
        tokenB: {
          mint: bestPool.tokenMintB.toString(),
          vault: bestPool.tokenVaultB.toString(),
          amount: rawAmountB.toString(),
          uiAmount: uiAmountB,
          decimals: 5
        }
      }
    };

    this._poolCache.set(cacheKey, { ts: Date.now(), data: result });
    return result;
  }

  async getPoolByAddress(poolAddress) {
    if (!poolAddress) return { ok: false, error: "Pool address is required" };

    const rpc = createSolanaRpc(this.rpcUrl);
    let info;
    try {
      info = await rpc.getAccountInfo(address(String(poolAddress)), { encoding: 'base64' }).send();
    } catch (e) {
      return { ok: false, error: `Solana fetch error: ${e.message}` };
    }
    if (!info || !info.value || !info.value.data) {
      return { ok: false, error: `Pool account not found: ${poolAddress}` };
    }

    const buf = Buffer.from(info.value.data[0], 'base64');
    if (buf.length < 245) {
      return { ok: false, error: `Invalid Whirlpool account size: ${buf.length}` };
    }

    // Whirlpool account layout (after 8-byte discriminator):
    // 8:   whirlpoolsConfig (32)
    // 40:  whirlpoolBump (1)
    // 41:  tickSpacing (2)
    // 45:  feeRate (2)
    // 49:  liquidity (16)
    // 65:  sqrtPrice (16)
    // 81:  tickCurrentIndex (4)
    // 85:  protocolFeeOwedA (8)
    // 93:  protocolFeeOwedB (8)
    // 101: tokenMintA (32)
    // 133: tokenVaultA (32)
    // 165: feeGrowthGlobalA (16)
    // 181: tokenMintB (32)
    // 213: tokenVaultB (32)

    const tickSpacing = buf.readUInt16LE(41);
    const feeRate = buf.readUInt16LE(45);

    const liquidityLo = buf.readBigUInt64LE(49);
    const liquidityHi = buf.readBigUInt64LE(57);
    const liquidity = (liquidityHi << 64n) | liquidityLo;

    const sqrtPriceLo = buf.readBigUInt64LE(65);
    const sqrtPriceHi = buf.readBigUInt64LE(73);
    const sqrtPriceX64 = (sqrtPriceHi << 64n) | sqrtPriceLo;

    const tickCurrentIndex = buf.readInt32LE(81);

    const TWO_64 = 2n ** 64n;
    const sqrtPriceFloat = Number(sqrtPriceX64) / Number(TWO_64);
    const price = sqrtPriceFloat * sqrtPriceFloat;

    const mintA = new PublicKey(buf.slice(101, 133)).toBase58();
    const vaultA = new PublicKey(buf.slice(133, 165)).toBase58();
    const mintB = new PublicKey(buf.slice(181, 213)).toBase58();
    const vaultB = new PublicKey(buf.slice(213, 245)).toBase58();

    const { rawAmountA, rawAmountB } = await fetchVaultBalances(rpc, {
        tokenVaultA: vaultA,
        tokenVaultB: vaultB
    });

    return {
      ok: true,
      poolAddress: String(poolAddress),
      tickSpacing,
      liquidity: liquidity.toString(),
      feeRate,
      price,
      sqrtPrice: sqrtPriceX64.toString(),
      tickCurrentIndex,
      reserves: {
        tokenA: {
          mint: mintA,
          vault: vaultA,
          amount: rawAmountA.toString(),
          uiAmount: nativeToUi(rawAmountA, 5),
          decimals: 5
        },
        tokenB: {
          mint: mintB,
          vault: vaultB,
          amount: rawAmountB.toString(),
          uiAmount: nativeToUi(rawAmountB, 5),
          decimals: 5
        }
      }
    };
  }

  async getPoolPrice(poolAddress, decimalsA = 5, decimalsB = 5) {
    const rpc = createSolanaRpc(this.rpcUrl);
    let info;
    try {
      info = await rpc.getAccountInfo(address(String(poolAddress)), { encoding: 'base64' }).send();
    } catch (e) {
      return { ok: false, error: `Solana fetch error: ${e.message}`, code: 3230000 };
    }

    if (!info || !info.value || !info.value.data) {
      return { ok: false, error: `Pool account not found: ${poolAddress}`, code: 3230000 };
    }

    const buf = Buffer.from(info.value.data[0], 'base64');

    if (buf.length < 85) {
      throw new Error(`Invalid Whirlpool account size: ${buf.length}`);
    }

    const liquidityLo = buf.readBigUInt64LE(49);
    const liquidityHi = buf.readBigUInt64LE(57);
    const liquidity = (liquidityHi << 64n) | liquidityLo;

    const sqrtPriceLo = buf.readBigUInt64LE(65);
    const sqrtPriceHi = buf.readBigUInt64LE(73);
    const sqrtPriceX64 = (sqrtPriceHi << 64n) | sqrtPriceLo;

    const tickCurrentIndex = buf.readInt32LE(81);

    const TWO_64 = 2n ** 64n;
    const sqrtPriceFloat = Number(sqrtPriceX64) / Number(TWO_64);
    const decimalAdjustment = Math.pow(10, decimalsA - decimalsB);
    const price = sqrtPriceFloat * sqrtPriceFloat * decimalAdjustment;

    return {
      ok: true,
      poolAddress: String(poolAddress),
      price,
      sqrtPrice: sqrtPriceX64.toString(),
      tickCurrentIndex,
      liquidity: liquidity.toString(),
      decimalsA,
      decimalsB,
    };
  }
}

module.exports = { PoolService };