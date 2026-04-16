'use strict';

const fs = require('fs');
const path = require('path');

const { Connection, Keypair, PublicKey, Transaction } = require('@solana/web3.js');

const { address } = require('@solana/kit');

const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

const {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  setDefaultFunder,
  openFullRangePosition,
  
  getPool, 
} = require('@orca-so/whirlpools');

function optEnv(name, def = undefined) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return def;
  return String(v).trim();
}

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

const { getWalletBytes, getWalletKeypair } = require('../utils/wallet');

function readKeypairArray(filePath) {
  try {
    const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const raw = fs.readFileSync(abs, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error(`Invalid keypair json: ${abs}`);
    return arr;
  } catch (_) {
    return Array.from(getWalletBytes());
  }
}

function readKeypairBytes(filePath) {
  const arr = readKeypairArray(filePath);
  const u8 = new Uint8Array(arr);
  return new Uint8Array(u8.buffer.slice(0));
}

function loadWeb3Keypair(filePath) {
  try {
    return Keypair.fromSecretKey(new Uint8Array(readKeypairArray(filePath)));
  } catch (_) {
    return getWalletKeypair();
  }
}

function isLikelyPubkey(s) {
  try {
    new PublicKey(String(s));
    return true;
  } catch {
    return false;
  }
}

function asPkString(x) {
  return new PublicKey(x).toBase58();
}

function toBigint(x) {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(Math.trunc(x));
  if (typeof x === 'string') {
    if (x.includes('.')) throw new Error('amount must be integer (base units) or pass uiAmount+decimals');
    return BigInt(x);
  }
  throw new Error('amount must be bigint | number | string');
}

function uiToNative(amountUi, decimals) {
  must(amountUi !== undefined && amountUi !== null, 'amountUi required');
  const n = Number(amountUi);
  must(Number.isFinite(n) && n > 0, 'amountUi must be > 0');
  must(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, 'decimals must be 0..18');

  const s = String(amountUi);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);

  const base = BigInt(i || '0');
  const scale = BigInt('1' + '0'.repeat(decimals));
  const fracBN = BigInt(frac || '0');

  return base * scale + fracBN;
}

function getPositionNftTokenProgramId(withTokenMetadataExtension) {
  return withTokenMetadataExtension ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

async function lockPositionNftForever({ connection, payerKeypair, positionMint, withTokenMetadataExtension }) {
  const BURN_OWNER = optEnv('BURN_OWNER', '1nc1nerator11111111111111111111111111111111');

  const mintPk = new PublicKey(positionMint);
  const burnOwnerPk = new PublicKey(BURN_OWNER);

  const tokenProgramId = getPositionNftTokenProgramId(withTokenMetadataExtension);

  const payerAta = getAssociatedTokenAddressSync(
    mintPk,
    payerKeypair.publicKey,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const burnAta = getAssociatedTokenAddressSync(
    mintPk,
    burnOwnerPk,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const ixs = [];

  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(
      payerKeypair.publicKey,
      burnAta,
      burnOwnerPk,
      mintPk,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  ixs.push(
    createTransferCheckedInstruction(
      payerAta,
      mintPk,
      burnAta,
      payerKeypair.publicKey,
      1n,
      0,
      [],
      tokenProgramId
    )
  );

  const tx = new Transaction().add(...ixs);
  tx.feePayer = payerKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(payerKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });

  await connection.confirmTransaction(sig, 'confirmed');

  return {
    ok: true,
    lockTxId: sig,
    burnOwner: BURN_OWNER,
    payerAta: payerAta.toBase58(),
    burnAta: burnAta.toBase58(),
    tokenProgramId: tokenProgramId.toBase58(),
  };
}


let _orcaBoot = null;

async function bootOrca() {
  if (_orcaBoot) return _orcaBoot;

  _orcaBoot = (async () => {
    const { getRpcUrl, getOrcaWhirlpoolsConfig } = require('../utils/network');
    const rpcUrl = getRpcUrl();
    const commitment = optEnv('SOLANA_COMMITMENT', 'confirmed');
    const network = getOrcaWhirlpoolsConfig();

    await setWhirlpoolsConfig(network);
    await setRpc(rpcUrl);

    const payerBytes = getWalletBytes();
    const signer = await setPayerFromBytes(payerBytes);

    setDefaultFunder(signer);

    const connection = new Connection(rpcUrl, commitment);
    const payerKeypair = getWalletKeypair();

    return { rpcUrl, commitment, network, signer, connection, payerKeypair };
  })();

  return _orcaBoot;
}

/** =================== SERVICE =================== */
class LiquidityService {
  constructor({ connection, tokensService } = {}) {
    this.connection = connection || null;
    this.tokensService = tokensService || null;
  }

  resolveMint(token) {
    must(token, 'token is required');
    const s = String(token).trim();

    if (this.tokensService) {
      try {
        const mint = this.tokensService.getMint(s);
        return mint.toBase58();
      } catch (_) {}
    }

    must(isLikelyPubkey(s), `Invalid token (not tokenKey, not mint pubkey): ${s}`);
    return asPkString(s);
  }

  async addLiquidity({
    poolAddress,
    tokenX,
    tokenY,
    amountXUi,
    amountYUi,
    decimalsX,
    decimalsY,
    tokenMaxX,
    tokenMaxY,
    slippageBps = 50,
    withTokenMetadataExtension = null,
    lockPosition = true,
    useTokenY = true,
  }) {
    // ... validation ...
    must(poolAddress, 'poolAddress required');
    must(tokenX && tokenY, 'tokenX and tokenY required');

    const { connection, payerKeypair, rpcUrl, network } = await bootOrca();

    const mintX = this.resolveMint(tokenX); 
    const mintY = this.resolveMint(tokenY);

    console.log(`[LiquidityService] Preparing TX for Pool: ${poolAddress}`);
    console.log(`[LiquidityService] Input TokenX: ${mintX} Amount: ${amountXUi}`);
    console.log(`[LiquidityService] Input TokenY: ${mintY} Amount: ${amountYUi}`);

    const mintXBuf = Buffer.from(new PublicKey(mintX).toBytes());
    const mintYBuf = Buffer.from(new PublicKey(mintY).toBytes());
    const flipped = Buffer.compare(mintXBuf, mintYBuf) > 0;
    if (flipped) {
      console.log(`[LiquidityService] Mint order flipped: tokenX maps to pool's tokenB`);
    }

    let tokenMaxA;
    let tokenMaxB;

    if (tokenMaxX !== undefined || tokenMaxY !== undefined) {
      must(tokenMaxX !== undefined, 'tokenMaxX required when using native mode');
      if (useTokenY) {
        must(tokenMaxY !== undefined, 'tokenMaxY required when useTokenY=true');
        tokenMaxA = flipped ? toBigint(tokenMaxY) : toBigint(tokenMaxX);
        tokenMaxB = flipped ? toBigint(tokenMaxX) : toBigint(tokenMaxY);
      } else {
        tokenMaxA = toBigint(tokenMaxX);
      }
    } else {
      must(amountXUi !== undefined, 'amountXUi required (or use tokenMaxX native)');
      must(Number.isInteger(Number(decimalsX)), 'decimalsX required in UI mode');

      if (useTokenY) {
        must(amountYUi !== undefined, 'amountYUi required when useTokenY=true');
        must(Number.isInteger(Number(decimalsY)), 'decimalsY required in UI mode');
        tokenMaxA = flipped
          ? uiToNative(amountYUi, Number(decimalsY))
          : uiToNative(amountXUi, Number(decimalsX));
        tokenMaxB = flipped
          ? uiToNative(amountXUi, Number(decimalsX))
          : uiToNative(amountYUi, Number(decimalsY));
      } else {
        tokenMaxA = uiToNative(amountXUi, Number(decimalsX));
      }
    }

    const params = useTokenY ? { tokenMaxA, tokenMaxB } : { tokenMaxA };

    let useMetadataExt = withTokenMetadataExtension;
    if (useMetadataExt === null || useMetadataExt === undefined) {
      const TOKEN_2022_PROG = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
      try {
        const { connection: conn } = await bootOrca();
        const mintXAcct = await conn.getAccountInfo(new PublicKey(mintX));
        const mintYAcct = await conn.getAccountInfo(new PublicKey(mintY));
        useMetadataExt = (mintXAcct?.owner?.toBase58() === TOKEN_2022_PROG) || (mintYAcct?.owner?.toBase58() === TOKEN_2022_PROG);
      } catch (_) {
        useMetadataExt = false;
      }
    }

    console.log(`[LiquidityService] Calling openFullRangePosition...`);
    console.log(`[LiquidityService] withTokenMetadataExtension: ${useMetadataExt}`);

    let res;
    try {
      res = await openFullRangePosition(
        address(String(poolAddress)),
        params,
        Number(slippageBps),
        Boolean(useMetadataExt)
      );
    } catch (orcaError) {
        // Capture full error structure
        console.error("[LiquidityService] Orca SDK Error:", orcaError);
        const errMsg = orcaError?.message || JSON.stringify(orcaError, Object.getOwnPropertyNames(orcaError));
        throw new Error(`Orca SDK failed: ${errMsg}`);
    }

    const lpTxId = await res.callback();

    const positionMint = String(res.positionMint ?? res.positionAddress ?? '');
    
    // ... (Lock logic) ...
    let lockResult = null;
    if (lockPosition && positionMint) {
      try {
        lockResult = await lockPositionNftForever({
          connection,
          payerKeypair,
          positionMint,
          withTokenMetadataExtension: Boolean(useMetadataExt),
        });
      } catch (lockErr) {
         console.error("[LiquidityService] Lock failed:", lockErr);
 
         lockResult = { ok: false, error: lockErr.message };
      }
    }

    return {
      ok: true,
      network,
      rpc: rpcUrl,
      poolAddress: String(poolAddress),
      tokenX: { input: String(tokenX), mint: mintX },
      tokenY: { input: String(tokenY), mint: mintY },
      slippageBps: Number(slippageBps),
      withTokenMetadataExtension: Boolean(useMetadataExt),
      useTokenY: Boolean(useTokenY),
      tokenMaxA: tokenMaxA.toString(),
      ...(useTokenY ? { tokenMaxB: tokenMaxB.toString() } : {}),
      lpTxId,
      positionMint,
      initializationCostLamports: String(res.initializationCost ?? ''),
      lock: lockResult,
    };
  }
}

module.exports = { LiquidityService };