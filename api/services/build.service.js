'use strict';

const fs = require('fs');
const path = require('path');

const {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  Connection,
} = require('@solana/web3.js');

const { address } = require('@solana/kit');

const {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  setDefaultFunder,
  createConcentratedLiquidityPoolInstructions,
  openFullRangePositionInstructions,
  closePositionInstructions,
  fetchPositionsInWhirlpool,
  harvestPositionInstructions,
  swapInstructions,
  fetchWhirlpoolsByTokenPair,
} = require('@orca-so/whirlpools');

const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

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

function toBigIntLike(x) {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(x);
  if (typeof x === 'string') return BigInt(x);
  throw new Error('amount must be bigint | number | string');
}

function uiToNative(amountUi, decimals) {
  const n = Number(amountUi);
  if (!Number.isFinite(n) || n <= 0) throw new Error('amount must be > 0');
  const s = String(amountUi);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  const base = BigInt(i || '0');
  const scale = BigInt('1' + '0'.repeat(decimals));
  const fracBN = BigInt(frac || '0');
  return base * scale + fracBN;
}

const TRANSFER_FEE_BPS = Number(process.env.TRANSFER_FEE_BPS ?? '5');
const BPS_DENOM = 10_000n;

function ceilDiv(a, b) { return (a + b - 1n) / b; }

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
  if (role.includes('writable') || mode.includes('writable') || access.includes('writable')) return true;
  return false;
}

function kitIxToWeb3Ix(ix, forceWritablePubkeys = new Set()) {
  const programIdStr = ix?.programAddress ?? ix?.programId ?? ix?.program;
  if (!programIdStr) throw new Error('Instruction missing programAddress/programId');
  const programId = new PublicKey(String(programIdStr));
  const keys = (ix.accounts ?? []).map((a) => {
    const pkStr = String(pickPubkeyString(a));
    if (!pkStr) throw new Error('Account meta missing pubkey/address');
    const isSigner = detectSigner(a);
    const isWritable = forceWritablePubkeys.has(pkStr) ? true : detectWritable(a);
    return { pubkey: new PublicKey(pkStr), isSigner, isWritable };
  });
  const dataU8 = ix?.data ?? new Uint8Array();
  return new TransactionInstruction({ programId, keys, data: Buffer.from(dataU8) });
}

function extractEphemeralSigners(kitIxs, userPubkeyStr) {
  const signers = [];
  const seen = new Set();
  seen.add(userPubkeyStr);
  for (const ix of kitIxs) {
    for (const acc of (ix.accounts ?? [])) {
      if (!detectSigner(acc)) continue;
      const addr = String(pickPubkeyString(acc));
      if (seen.has(addr)) continue;
      if (acc.signer && acc.signer.keyPair) {
        signers.push(acc.signer);
        seen.add(addr);
      }
    }
  }
  return signers;
}

async function buildVersionedTx(connection, userPubkey, instructions, ephemeralSigners = []) {
  const computeIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  ];

  const allIxs = [...computeIxs, ...instructions];

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const messageV0 = new TransactionMessage({
    payerKey: userPubkey,
    recentBlockhash: blockhash,
    instructions: allIxs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);

  if (ephemeralSigners.length > 0) {
    const msgBytes = tx.message.serialize();
    for (const kitSigner of ephemeralSigners) {
      const signerAddr = String(kitSigner.address);
      const signerIdx = tx.message.staticAccountKeys.findIndex(
        k => k.toBase58() === signerAddr
      );
      if (signerIdx < 0) continue;

      const sigBuf = await crypto.subtle.sign('Ed25519', kitSigner.keyPair.privateKey, msgBytes);
      tx.signatures[signerIdx] = new Uint8Array(sigBuf);
    }
  }

  const base64 = Buffer.from(tx.serialize()).toString('base64');

  return { base64, blockhash, lastValidBlockHeight };
}

let _boot = null;

async function boot() {
  if (_boot) return _boot;
  _boot = (async () => {
    const { getRpcUrl, getOrcaWhirlpoolsConfig, wrapRpcUrl } = require('../utils/network');
    const RPC_URL = getRpcUrl();
    const NETWORK = getOrcaWhirlpoolsConfig();

    const kit = await import('@solana/kit');
    const whirlpools = await import('@orca-so/whirlpools');

    await whirlpools.setWhirlpoolsConfig(NETWORK);
    await whirlpools.setRpc(RPC_URL);

    const payerBytes = getWalletBytes();
    const serverSigner = await whirlpools.setPayerFromBytes(payerBytes);
    whirlpools.setDefaultFunder(serverSigner);

    const connection = new Connection(RPC_URL, 'confirmed');

    const rpc = kit.createSolanaRpc(await wrapRpcUrl(RPC_URL));

    return { RPC_URL, NETWORK, rpc, serverSigner, connection, kit, whirlpools };
  })();
  return _boot;
}

function createUserSigner(userPubkeyStr) {
  return {
    address: userPubkeyStr,
    keyPair: null,
    signMessages: () => { throw new Error('Client must sign'); },
    signTransactions: () => { throw new Error('Client must sign'); },
  };
}

class BuildService {
  constructor({ tokensService }) {
    this.tokensService = tokensService;
  }

  async _getMintOwnerProgram(rpc, mintAddress) {
    const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    try {
      const { address: kitAddress } = await import('@solana/kit');
      const acct = await rpc.getAccountInfo(kitAddress(mintAddress), { encoding: 'base64' }).send();
      const owner = acct?.value?.owner ?? '';
      return { isToken2022: String(owner) === TOKEN_2022_PROGRAM };
    } catch (_) {
      return { isToken2022: false };
    }
  }

  resolveMint(input) {
    const s = String(input || '').trim();
    if (!s) throw new Error('mint is required');
    try { return new PublicKey(s).toBase58(); } catch (_) {}
    if (this.tokensService) {
      try { return this.tokensService.getMint(s).toBase58(); } catch (_) {}
    }
    throw new Error(`Could not resolve mint: ${s}`);
  }

  async buildPool({ tokenX, tokenY, tickSpacing, priceXUsd = 1, priceYUsd = 1, userPubkey }) {
    if (!tokenX || !tokenY) throw new Error('tokenX and tokenY required');
    if (!userPubkey) throw new Error('userPubkey required');

    const { connection, rpc, kit, whirlpools } = await boot();
    const userPk = new PublicKey(userPubkey);
    const userSigner = createUserSigner(userPubkey);

    const mintX = this.resolveMint(tokenX);
    const mintY = this.resolveMint(tokenY);

    const mintABuf = Buffer.from(new PublicKey(mintX).toBytes());
    const mintBBuf = Buffer.from(new PublicKey(mintY).toBytes());
    const flipped = Buffer.compare(mintABuf, mintBBuf) > 0;
    const mintA = flipped ? mintY : mintX;
    const mintB = flipped ? mintX : mintY;

    const usedTick = Number.isFinite(Number(tickSpacing)) && Number(tickSpacing) > 0
      ? Number(tickSpacing) : 64;

    const initialPrice = flipped ? priceYUsd / priceXUsd : priceXUsd / priceYUsd;

    const result = await createConcentratedLiquidityPoolInstructions(
      rpc,
      address(mintA),
      address(mintB),
      usedTick,
      initialPrice,
      userSigner
    );

    const kitIxs = result.instructions ?? [];
    const ephemeralSigners = extractEphemeralSigners(kitIxs, userPubkey);
    const web3Ixs = kitIxs.map(ix => kitIxToWeb3Ix(ix));

    const { base64, blockhash, lastValidBlockHeight } = await buildVersionedTx(connection, userPk, web3Ixs, ephemeralSigners);

    return {
      ok: true,
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
      summary: {
        type: 'createPool',
        mintA,
        mintB,
        tickSpacing: usedTick,
        initialPrice,
        poolAddress: result.poolAddress ? String(result.poolAddress) : null,
        initializationCost: result.initializationCost ? String(result.initializationCost) : '0',
      },
    };
  }

  async _getAvailableTokenBalance(connection, ownerPubkey, mintAddress) {
    const { unpackAccount, getTransferFeeAmount } = require('@solana/spl-token');
    const mintPk = new PublicKey(mintAddress);
    const ownerPk = new PublicKey(ownerPubkey);
    const mintAcct = await connection.getAccountInfo(mintPk);
    const tokenProgram = mintAcct?.owner?.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const ata = getAssociatedTokenAddressSync(mintPk, ownerPk, false, tokenProgram);
    const ataInfo = await connection.getAccountInfo(ata);
    if (!ataInfo) return { available: 0n, total: 0n, withheld: 0n, ata: ata.toBase58() };
    try {
      const tokenAccount = unpackAccount(ata, ataInfo, tokenProgram);
      const total = tokenAccount.amount;
      const feeAmount = getTransferFeeAmount(tokenAccount);
      const withheld = feeAmount ? BigInt(feeAmount.withheldAmount) : 0n;
      const available = total > withheld ? total - withheld : 0n;
      return { available, total, withheld, ata: ata.toBase58() };
    } catch {
      if (ataInfo.data && ataInfo.data.length >= 72) {
        const rawAmount = ataInfo.data.readBigUInt64LE(64);
        return { available: rawAmount, total: rawAmount, withheld: 0n, ata: ata.toBase58() };
      }
      return { available: 0n, total: 0n, withheld: 0n, ata: ata.toBase58() };
    }
  }

  async buildLiquidity({
    poolAddress, tokenX, tokenY,
    amountXUi, amountYUi, decimalsX = 5, decimalsY = 5,
    slippageBps = 50,
    userPubkey,
  }) {
    if (!poolAddress) throw new Error('poolAddress required');
    if (!tokenX || !tokenY) throw new Error('tokenX and tokenY required');
    if (!userPubkey) throw new Error('userPubkey required');

    const { connection, rpc } = await boot();
    const userPk = new PublicKey(userPubkey);
    const userSigner = createUserSigner(userPubkey);

    const mintX = this.resolveMint(tokenX);
    const mintY = this.resolveMint(tokenY);

    const amountXNative = uiToNative(amountXUi, Number(decimalsX));
    const amountYNative = uiToNative(amountYUi, Number(decimalsY));

    const [balX, balY] = await Promise.all([
      this._getAvailableTokenBalance(connection, userPubkey, mintX),
      this._getAvailableTokenBalance(connection, userPubkey, mintY),
    ]);

    const shortages = [];
    if (balX.available < amountXNative) {
      const shortfall = amountXNative - balX.available;
      const shortfallUi = Number(shortfall) / Math.pow(10, Number(decimalsX));
      const availableUi = Number(balX.available) / Math.pow(10, Number(decimalsX));
      shortages.push(`${tokenX}: need ${amountXUi} but only ${availableUi.toFixed(Number(decimalsX))} available (short by ${shortfallUi.toFixed(Number(decimalsX))})${balX.withheld > 0n ? ` — ${(Number(balX.withheld) / Math.pow(10, Number(decimalsX))).toFixed(Number(decimalsX))} withheld as transfer fee` : ''}`);
    }
    if (balY.available < amountYNative) {
      const shortfall = amountYNative - balY.available;
      const shortfallUi = Number(shortfall) / Math.pow(10, Number(decimalsY));
      const availableUi = Number(balY.available) / Math.pow(10, Number(decimalsY));
      shortages.push(`${tokenY}: need ${amountYUi} but only ${availableUi.toFixed(Number(decimalsY))} available (short by ${shortfallUi.toFixed(Number(decimalsY))})${balY.withheld > 0n ? ` — ${(Number(balY.withheld) / Math.pow(10, Number(decimalsY))).toFixed(Number(decimalsY))} withheld as transfer fee` : ''}`);
    }
    if (shortages.length > 0) {
      const err = new Error(`Insufficient token balance: ${shortages.join('; ')}`);
      err.statusCode = 400;
      err.code = 'INSUFFICIENT_BALANCE';
      err.balances = {
        tokenX: { available: Number(balX.available) / Math.pow(10, Number(decimalsX)), withheld: Number(balX.withheld) / Math.pow(10, Number(decimalsX)) },
        tokenY: { available: Number(balY.available) / Math.pow(10, Number(decimalsY)), withheld: Number(balY.withheld) / Math.pow(10, Number(decimalsY)) },
      };
      throw err;
    }

    const mintXBuf = Buffer.from(new PublicKey(mintX).toBytes());
    const mintYBuf = Buffer.from(new PublicKey(mintY).toBytes());
    const flipped = Buffer.compare(mintXBuf, mintYBuf) > 0;

    const tokenMaxA = flipped
      ? uiToNative(amountYUi, Number(decimalsY))
      : uiToNative(amountXUi, Number(decimalsX));
    const tokenMaxB = flipped
      ? uiToNative(amountXUi, Number(decimalsX))
      : uiToNative(amountYUi, Number(decimalsY));

    const mintXInfo = await this._getMintOwnerProgram(rpc, mintX);
    const mintYInfo = await this._getMintOwnerProgram(rpc, mintY);
    const hasMetadataExt = mintXInfo.isToken2022 || mintYInfo.isToken2022;

    const result = await openFullRangePositionInstructions(
      rpc,
      address(String(poolAddress)),
      { tokenMaxA, tokenMaxB },
      Number(slippageBps),
      hasMetadataExt,
      userSigner
    );

    const kitIxs = result.instructions ?? [];
    const ephemeralSigners = extractEphemeralSigners(kitIxs, userPubkey);
    const web3Ixs = kitIxs.map(ix => kitIxToWeb3Ix(ix));

    const { base64, blockhash, lastValidBlockHeight } = await buildVersionedTx(connection, userPk, web3Ixs, ephemeralSigners);

    return {
      ok: true,
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
      summary: {
        type: 'addLiquidity',
        poolAddress: String(poolAddress),
        mintX,
        mintY,
        amountXUi: String(amountXUi),
        amountYUi: String(amountYUi),
        tokenMaxA: tokenMaxA.toString(),
        tokenMaxB: tokenMaxB.toString(),
        positionMint: result.positionMint ? String(result.positionMint) : null,
        initializationCost: result.initializationCost ? String(result.initializationCost) : '0',
      },
    };
  }

  async buildRemoveLiquidity({ positionMint, slippageBps = 50, userPubkey, vaultAddress, tokenMintA, tokenMintB }) {
    if (!positionMint) throw new Error('positionMint required');
    if (!userPubkey) throw new Error('userPubkey required');

    const { connection, rpc } = await boot();
    const userPk = new PublicKey(userPubkey);
    const userSigner = createUserSigner(userPubkey);

    const result = await closePositionInstructions(
      rpc,
      address(String(positionMint)),
      Number(slippageBps),
      userSigner
    );

    const kitIxs = result.instructions ?? [];
    const ephemeralSigners = extractEphemeralSigners(kitIxs, userPubkey);
    const web3Ixs = kitIxs.map(ix => kitIxToWeb3Ix(ix));

    let vaultAtaAStr = null;
    let vaultAtaBStr = null;
    let resolvedMintA = tokenMintA || null;
    let resolvedMintB = tokenMintB || null;

    if (vaultAddress) {
      if (!resolvedMintA || !resolvedMintB) {
        try {
          const { fetchPosition, fetchWhirlpool } = require('@orca-so/whirlpools-client');
          const { address: kitAddress } = require('@solana/kit');
          const positionPdaSeeds = [Buffer.from('position'), new PublicKey(String(positionMint)).toBytes()];
          const WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
          const [positionPda] = PublicKey.findProgramAddressSync(positionPdaSeeds, WHIRLPOOL_PROGRAM_ID);
          const positionAccount = await fetchPosition(rpc, kitAddress(positionPda.toBase58()));
          if (positionAccount?.data?.whirlpool) {
            const wp = await fetchWhirlpool(rpc, kitAddress(String(positionAccount.data.whirlpool)));
            resolvedMintA = String(wp.data.tokenMintA);
            resolvedMintB = String(wp.data.tokenMintB);
          }
        } catch (e) {
          console.warn('[buildRemoveLiquidity] Could not resolve mints from chain:', e.message);
        }
      }

      if (resolvedMintA && resolvedMintB) {
        const vaultPk = new PublicKey(vaultAddress);
        const tokenEstA = BigInt(result.quote?.tokenEstA?.toString?.() ?? '0')
          + BigInt(result.feesQuote?.feeOwedA?.toString?.() ?? '0');
        const tokenEstB = BigInt(result.quote?.tokenEstB?.toString?.() ?? '0')
          + BigInt(result.feesQuote?.feeOwedB?.toString?.() ?? '0');
        const mintAmounts = [
          { mint: resolvedMintA, amount: tokenEstA },
          { mint: resolvedMintB, amount: tokenEstB },
        ];
        const seen = new Set();
        for (const { mint: mintStr, amount: transferAmount } of mintAmounts) {
          if (seen.has(mintStr)) continue;
          seen.add(mintStr);
          if (transferAmount <= 0n) continue;
          const mintPk = new PublicKey(mintStr);
          const mintAcct = await connection.getAccountInfo(mintPk);
          if (!mintAcct) continue;
          const tokenProgram = mintAcct.owner.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58()
            ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
          const userAta = getAssociatedTokenAddressSync(mintPk, userPk, false, tokenProgram);
          const vaultAta = getAssociatedTokenAddressSync(mintPk, vaultPk, true, tokenProgram);
          if (mintStr === resolvedMintA) vaultAtaAStr = vaultAta.toBase58();
          if (mintStr === resolvedMintB) vaultAtaBStr = vaultAta.toBase58();
          web3Ixs.push(
            createAssociatedTokenAccountIdempotentInstruction(
              userPk, vaultAta, vaultPk, mintPk, tokenProgram
            )
          );
          const mintInfo = require('@solana/spl-token').MintLayout.decode(mintAcct.data);
          web3Ixs.push(
            createTransferCheckedInstruction(
              userAta, mintPk, vaultAta, userPk, transferAmount, mintInfo.decimals, [], tokenProgram
            )
          );
        }
      }
    }

    const { base64, blockhash, lastValidBlockHeight } = await buildVersionedTx(connection, userPk, web3Ixs, ephemeralSigners);

    return {
      ok: true,
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
      vaultAddress: vaultAddress || null,
      summary: {
        type: 'removeLiquidity',
        positionMint: String(positionMint),
        tokenEstA: result.quote?.tokenEstA?.toString?.() ?? String(result.quote?.tokenEstA ?? '0'),
        tokenEstB: result.quote?.tokenEstB?.toString?.() ?? String(result.quote?.tokenEstB ?? '0'),
        feeOwedA: result.feesQuote?.feeOwedA?.toString?.() ?? '0',
        feeOwedB: result.feesQuote?.feeOwedB?.toString?.() ?? '0',
        vaultAtaA: vaultAtaAStr,
        vaultAtaB: vaultAtaBStr,
      },
    };
  }

  async buildCollectFees({ positionMint, userPubkey }) {
    if (!positionMint) throw new Error('positionMint required');
    if (!userPubkey) throw new Error('userPubkey required');

    const { connection, rpc } = await boot();
    const userPk = new PublicKey(userPubkey);
    const userSigner = createUserSigner(userPubkey);

    const result = await harvestPositionInstructions(
      rpc,
      address(String(positionMint)),
      userSigner
    );

    const kitIxs = result.instructions ?? [];
    const ephemeralSigners = extractEphemeralSigners(kitIxs, userPubkey);
    const web3Ixs = kitIxs.map(ix => kitIxToWeb3Ix(ix));

    const { base64, blockhash, lastValidBlockHeight } = await buildVersionedTx(connection, userPk, web3Ixs, ephemeralSigners);

    return {
      ok: true,
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
      summary: {
        type: 'collectFees',
        positionMint: String(positionMint),
        feeOwedA: result.feesQuote?.feeOwedA?.toString?.() ?? '0',
        feeOwedB: result.feesQuote?.feeOwedB?.toString?.() ?? '0',
      },
    };
  }

  async getPositionFees({ poolAddress, userPubkey }) {
    if (!poolAddress) throw new Error('poolAddress required');

    const { rpc } = await boot();
    const splToken = require('@solana/spl-token');

    const positions = await fetchPositionsInWhirlpool(rpc, address(String(poolAddress)));

    let totalFeeA = 0n;
    let totalFeeB = 0n;
    const positionFees = [];

    for (const pos of positions) {
      const data = pos.data ?? pos;
      const mint = data.positionMint ? String(data.positionMint) : null;
      if (!mint) continue;

      if (userPubkey) {
        try {
          const { connection } = await boot();
          const mintPk = new PublicKey(mint);
          const userPk = new PublicKey(userPubkey);
          const mintAcct = await connection.getAccountInfo(mintPk);
          const tokenProgram = mintAcct?.owner?.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
            ? splToken.TOKEN_2022_PROGRAM_ID
            : splToken.TOKEN_PROGRAM_ID;
          const ata = splToken.getAssociatedTokenAddressSync(mintPk, userPk, true, tokenProgram);
          const info = await connection.getAccountInfo(ata);
          if (!info) continue;
          const decoded = splToken.AccountLayout.decode(info.data);
          const owner = new PublicKey(decoded.owner).toBase58();
          if (owner !== userPubkey) continue;
        } catch (_) {
          continue;
        }
      }

      try {
        const userSigner = userPubkey ? createUserSigner(userPubkey) : undefined;
        const harvestResult = await harvestPositionInstructions(
          rpc,
          address(mint),
          userSigner
        );
        const feeA = BigInt(harvestResult.feesQuote?.feeOwedA ?? 0);
        const feeB = BigInt(harvestResult.feesQuote?.feeOwedB ?? 0);
        totalFeeA += feeA;
        totalFeeB += feeB;
        positionFees.push({
          positionMint: mint,
          feeOwedA: feeA.toString(),
          feeOwedB: feeB.toString(),
        });
      } catch (_) {}
    }

    return {
      ok: true,
      poolAddress,
      totalFeeOwedA: totalFeeA.toString(),
      totalFeeOwedB: totalFeeB.toString(),
      positions: positionFees,
    };
  }

  async getPositionsForPool({ poolAddress, userPubkey }) {
    if (!poolAddress) throw new Error('poolAddress required');

    const { rpc, kit } = await boot();
    const splToken = require('@solana/spl-token');

    const positions = await fetchPositionsInWhirlpool(rpc, address(String(poolAddress)));

    const result = [];
    for (const pos of positions) {
      const data = pos.data ?? pos;
      const mint = data.positionMint ? String(data.positionMint) : null;
      if (!mint) continue;

      let owner = null;
      if (userPubkey) {
        try {
          const { connection } = await boot();
          const mintPk = new PublicKey(mint);
          const userPk = new PublicKey(userPubkey);
          const mintAcct = await connection.getAccountInfo(mintPk);
          const tokenProgram = mintAcct?.owner?.toBase58() === splToken.TOKEN_2022_PROGRAM_ID.toBase58()
            ? splToken.TOKEN_2022_PROGRAM_ID
            : splToken.TOKEN_PROGRAM_ID;
          const ata = splToken.getAssociatedTokenAddressSync(mintPk, userPk, true, tokenProgram);
          const info = await connection.getAccountInfo(ata);
          if (!info) continue;
          const decoded = splToken.AccountLayout.decode(info.data);
          owner = new PublicKey(decoded.owner).toBase58();
          if (owner !== userPubkey) continue;
        } catch (_) {
          continue;
        }
      }

      result.push({
        positionMint: mint,
        whirlpool: data.whirlpool ? String(data.whirlpool) : null,
        liquidity: data.liquidity?.toString?.() ?? String(data.liquidity ?? '0'),
        tickLowerIndex: data.tickLowerIndex,
        tickUpperIndex: data.tickUpperIndex,
        owner,
      });
    }

    return { ok: true, positions: result, count: result.length };
  }

  async buildSwap({ mintIn, mintOut, amountIn, slippageBps = 50, userPubkey }) {
    if (!mintIn || !mintOut) throw new Error('mintIn and mintOut required');
    if (amountIn === undefined) throw new Error('amountIn required');
    if (!userPubkey) throw new Error('userPubkey required');

    const { connection, rpc, kit, whirlpools } = await boot();
    const userPk = new PublicKey(userPubkey);
    const userSigner = createUserSigner(userPubkey);

    const resolvedMintIn = this.resolveMint(mintIn);
    const resolvedMintOut = this.resolveMint(mintOut);
    const amt = toBigIntLike(amountIn);

    const mintInAddr = kit.address(resolvedMintIn);
    const mintOutAddr = kit.address(resolvedMintOut);

    const pools = await whirlpools.fetchWhirlpoolsByTokenPair(rpc, mintInAddr, mintOutAddr);
    if (!pools || pools.length === 0) {
      throw new Error('No Orca pools found for this mint pair.');
    }

    let best = null;
    for (const p of pools) {
      const poolAddress = p.address ?? p.poolAddress ?? p.whirlpoolAddress;
      if (!poolAddress) continue;
      try {
        const { instructions, quote } = await swapInstructions(
          rpc,
          { inputAmount: amt, mint: mintInAddr },
          poolAddress,
          Number(slippageBps),
          userSigner
        );
        const estOut = BigInt(quote.tokenEstOut ?? quote.estimatedAmountOut ?? 0n);
        if (!best || estOut > best.estOut) {
          best = { poolAddress, tickSpacing: p.tickSpacing, quote, instructions, estOut };
        }
      } catch (_) {}
    }

    if (!best) throw new Error('Found pools, but none could produce a quote.');

    const forceWritable = new Set([String(best.poolAddress)]);
    const web3Ixs = best.instructions.map(ix => kitIxToWeb3Ix(ix, forceWritable));

    const tokenEstOutGross = BigInt(best.quote.tokenEstOut ?? best.quote.estimatedAmountOut ?? 0n);
    const tokenMinOutGross = BigInt(best.quote.tokenMinOut ?? best.quote.otherAmountThreshold ?? 0n);

    const { base64, blockhash, lastValidBlockHeight } = await buildVersionedTx(connection, userPk, web3Ixs);

    const tokenEstOutNet = applyTransferFeeNet(tokenEstOutGross, TRANSFER_FEE_BPS);
    const tokenMinOutNet = applyTransferFeeNet(tokenMinOutGross, TRANSFER_FEE_BPS);

    return {
      ok: true,
      transaction: base64,
      blockhash,
      lastValidBlockHeight,
      summary: {
        type: 'swap',
        pool: String(best.poolAddress),
        mintIn: resolvedMintIn,
        mintOut: resolvedMintOut,
        amountIn: amt.toString(),
        feeBps: TRANSFER_FEE_BPS,
        quote: {
          tokenEstOutGross: tokenEstOutGross.toString(),
          tokenEstOutNet: tokenEstOutNet.toString(),
          tokenMinOutGross: tokenMinOutGross.toString(),
          tokenMinOutNet: tokenMinOutNet.toString(),
        },
      },
    };
  }
}

module.exports = { BuildService };
