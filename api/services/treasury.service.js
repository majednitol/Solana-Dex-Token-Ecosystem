'use strict';

const {
  PublicKey,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getTransferFeeConfig,
  createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');
const { query } = require('../db/init');
const path = require('path');
const fs = require('fs');

async function buildVersionedTx(connection, payerKey, instructions) {
  const computeIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  ];

  const allIxs = [...computeIxs, ...instructions];
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: allIxs,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  return { tx, blockhash, lastValidBlockHeight };
}

class TreasuryService {
  constructor({ connection, cacheService, tokensService }) {
    if (!connection) throw new Error('TreasuryService: connection required');
    this.connection = connection;
    this.cache = cacheService || null;
    this.tokensService = tokensService || null;
    this.squadsVault = null;
    this.squadsService = null;
  }

  setSquadsVault(vaultAddress, squadsService = null) {
    this.squadsVault = new PublicKey(vaultAddress);
    if (squadsService) this.squadsService = squadsService;
    console.log(`[Treasury] Squads vault set: ${this.squadsVault.toBase58()}`);
  }

  getDepositTarget() {
    return this.squadsVault || null;
  }

  async getMultisigState() {
    if (!this.squadsService) {
      return { initialized: false, notConfigured: true, owners: [], threshold: 0 };
    }
    return this.squadsService.getMultisigState();
  }

  async getBalances() {
    if (this.cache) {
      const cached = await this.cache.get('treasury:balances');
      if (cached) return cached;
    }

    const target = this.getDepositTarget();
    if (!target) return [];

    const tokens = this.tokensService ? this.tokensService.listTokens() : [];
    const atas = tokens.map(token =>
      getAssociatedTokenAddressSync(
        new PublicKey(token.mint),
        target,
        true,
        TOKEN_2022_PROGRAM_ID,
      )
    );

    let accountInfos = [];
    try {
      const CHUNK = 100;
      for (let i = 0; i < atas.length; i += CHUNK) {
        const chunk = atas.slice(i, i + CHUNK);
        const infos = await this.connection.getMultipleAccountsInfo(chunk, 'confirmed');
        accountInfos.push(...infos);
      }
    } catch {
      accountInfos = new Array(atas.length).fill(null);
    }

    const balances = tokens.map((token, i) => {
      const acctInfo = accountInfos[i];
      const ata = atas[i];
      const decimals = token.decimals || 5;

      if (acctInfo && acctInfo.data && acctInfo.data.length >= 72) {
        const rawAmount = acctInfo.data.readBigUInt64LE(64);
        return {
          mint: token.mint.toString(),
          symbol: token.symbol || token.key || '',
          ata: ata.toBase58(),
          balance: Number(rawAmount) / Math.pow(10, decimals),
          rawBalance: rawAmount.toString(),
          decimals,
        };
      }

      return {
        mint: token.mint.toString(),
        symbol: token.symbol || token.key || '',
        ata: ata.toBase58(),
        balance: 0,
        rawBalance: '0',
        decimals,
      };
    });

    if (this.cache) {
      await this.cache.set('treasury:balances', balances, 60);
    }

    return balances;
  }

  async getSquadsVaultBalances() {
    if (!this.squadsVault) {
      return { ok: false, error: 'Squads vault not configured' };
    }

    const tokens = this.tokensService ? this.tokensService.listTokens() : [];
    const atas = tokens.map(token => {
      const mint = new PublicKey(token.mint.toString());
      const tokenProgramId = token.tokenProgram === '2022' ? TOKEN_2022_PROGRAM_ID : require('@solana/spl-token').TOKEN_PROGRAM_ID;
      return getAssociatedTokenAddressSync(mint, this.squadsVault, true, tokenProgramId);
    });

    const fetchAccounts = async () => {
      const CHUNK = 100;
      const all = [];
      for (let i = 0; i < atas.length; i += CHUNK) {
        const infos = await this.connection.getMultipleAccountsInfo(atas.slice(i, i + CHUNK), 'confirmed');
        all.push(...infos);
      }
      return all;
    };
    const [solBalance, accountInfos] = await Promise.all([
      this.connection.getBalance(this.squadsVault),
      fetchAccounts().catch(() => new Array(atas.length).fill(null)),
    ]);

    const balances = [{
      mint: 'SOL',
      balance: solBalance / LAMPORTS_PER_SOL,
      raw: solBalance,
    }];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const acctInfo = accountInfos[i];
      const decimals = token.decimals || 5;

      if (acctInfo && acctInfo.data && acctInfo.data.length >= 72) {
        const rawAmount = acctInfo.data.readBigUInt64LE(64);
        balances.push({
          mint: token.mint.toString(),
          symbol: token.symbol || '',
          ata: atas[i].toBase58(),
          balance: Number(rawAmount) / Math.pow(10, decimals),
          raw: rawAmount.toString(),
          decimals,
        });
      } else {
        balances.push({
          mint: token.mint.toString(),
          symbol: token.symbol || '',
          balance: 0,
          raw: '0',
        });
      }
    }

    return { ok: true, vault: this.squadsVault.toBase58(), balances };
  }

  async ensureVaultAtas(mints, payer) {
    const target = this.getDepositTarget();
    if (!target) throw new Error('No deposit target configured');

    const payerPubkey = new PublicKey(payer);
    const created = [];
    const existing = [];
    const ixs = [];

    const mintPks = mints.map(m => new PublicKey(m));
    const ataAddresses = mintPks.map(mint =>
      getAssociatedTokenAddressSync(mint, target, true, TOKEN_2022_PROGRAM_ID)
    );

    const CHUNK = 100;
    const accountInfos = [];
    for (let i = 0; i < ataAddresses.length; i += CHUNK) {
      const infos = await this.connection.getMultipleAccountsInfo(ataAddresses.slice(i, i + CHUNK), 'confirmed');
      accountInfos.push(...infos);
    }

    for (let i = 0; i < mints.length; i++) {
      const mintStr = mints[i];
      const ata = ataAddresses[i];
      if (accountInfos[i]) {
        existing.push({ mint: mintStr, ata: ata.toBase58() });
      } else {
        ixs.push(createAssociatedTokenAccountInstruction(payerPubkey, ata, target, mintPks[i], TOKEN_2022_PROGRAM_ID));
        created.push({ mint: mintStr, ata: ata.toBase58() });
      }
    }

    if (ixs.length === 0) {
      return { ok: true, created: [], existing, message: 'All ATAs exist' };
    }

    const { tx, blockhash, lastValidBlockHeight } = await buildVersionedTx(this.connection, payerPubkey, ixs);
    const serialized = Buffer.from(tx.serialize()).toString('base64');

    console.log(`[Treasury] Built vault ATA creation for ${created.length} mints`);

    return { ok: true, created, existing, transaction: serialized, blockhash, lastValidBlockHeight };
  }

  async getFeeHistory({ token, feeType, from, to, limit, offset } = {}) {
    let sql = 'SELECT * FROM fee_events WHERE amount > 0';
    const params = [];
    let idx = 1;

    if (token) {
      sql += ` AND (token_mint = $${idx} OR token_symbol = $${idx})`;
      params.push(token);
      idx++;
    }
    if (feeType) {
      sql += ` AND fee_type = $${idx}`;
      params.push(feeType);
      idx++;
    }
    if (from) {
      sql += ` AND created_at >= $${idx}`;
      params.push(new Date(from));
      idx++;
    }
    if (to) {
      sql += ` AND created_at <= $${idx}`;
      params.push(new Date(to));
      idx++;
    }

    sql += ' ORDER BY created_at DESC';

    const lim = Math.min(Number(limit) || 100, 500);
    const off = Number(offset) || 0;
    sql += ` LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(lim, off);

    const result = await query(sql, params);
    return result.rows;
  }

  async recordFeeEvent({ tokenMint, tokenSymbol, amount, feeType, txSignature }) {
    const result = await query(
      `INSERT INTO fee_events (token_mint, token_symbol, amount, fee_type, tx_signature)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [tokenMint, tokenSymbol || '', amount, feeType, txSignature || ''],
    );

    const event = result.rows[0];

    if (this.cache) {
      await this.cache.publish('fees:collected', {
        type: 'fee_event',
        ...event,
      });
      await this.cache.del('treasury:balances');
      this.getBalances().then(balances => {
        if (this.cache) this.cache.set('treasury:balances', balances, 60).catch(() => {});
      }).catch(() => {});
    }

    return event;
  }

  async collectPoolFees() {
    const results = [];
    try {
      const {
        setWhirlpoolsConfig,
        setRpc,
        setPayerFromBytes,
        setDefaultFunder,
        harvestPosition,
      } = await import('@orca-so/whirlpools');

      const { getRpcUrl, getOrcaWhirlpoolsConfig } = require('../utils/network');
      const rpc = getRpcUrl();
      const network = getOrcaWhirlpoolsConfig();

      await setWhirlpoolsConfig(network);
      await setRpc(rpc);

      const { getWalletBytes } = require('../utils/wallet');
      const raw = Array.from(getWalletBytes());
      console.log('[Treasury] Wallet loaded for pool harvest');
      const signer = await setPayerFromBytes(new Uint8Array(raw));
      setDefaultFunder(signer);

      const { PublicKey } = require('@solana/web3.js');
      const conn = this.connection;
      const walletPubkey = require('@solana/web3.js').Keypair.fromSecretKey(new Uint8Array(raw)).publicKey;
      const ORCA_WHIRLPOOL_PROGRAM = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');

      const poolRows = await query(`SELECT pool_address FROM pools WHERE pool_address IS NOT NULL`);
      const knownPools = poolRows.rows.map(r => r.pool_address);

      const positionMints = [];
      for (const poolAddress of knownPools) {
        try {
          const positionAccounts = await conn.getProgramAccounts(ORCA_WHIRLPOOL_PROGRAM, {
            filters: [
              { dataSize: 216 },
              { memcmp: { offset: 8, bytes: poolAddress } },
            ],
          });

          for (const pos of positionAccounts) {
            const data = pos.account.data;
            const positionMint = new PublicKey(data.slice(40, 72)).toBase58();

            try {
              const largest = await conn.getTokenLargestAccounts(new PublicKey(positionMint));
              for (const acct of largest.value) {
                if (acct.uiAmount === 1) {
                  const acctInfo = await conn.getParsedAccountInfo(acct.address);
                  const owner = acctInfo.value?.data?.parsed?.info?.owner;
                  if (owner === walletPubkey.toBase58()) {
                    positionMints.push(positionMint);
                  }
                }
              }
            } catch (_) {}
          }
        } catch (poolErr) {
          console.warn(`[Treasury] Could not scan positions for pool ${poolAddress.slice(0, 8)}...: ${poolErr.message}`);
        }
      }

      console.log(`[Treasury] Found ${positionMints.length} Orca position(s) owned by wallet`);

      if (positionMints.length === 0) {
        console.log('[Treasury] No liquidity positions found — skipping pool harvest');
        return { ok: true, harvested: 0, skipped: true, results };
      }

      const isRateLimit = (err) => {
        const msg = String(err?.message || err).toLowerCase();
        return msg.includes('429') || msg.includes('too many requests') || err?.statusCode === 429;
      };

      const withRetry = async (fn, label, retries = 3) => {
        for (let attempt = 0; attempt < retries; attempt++) {
          try {
            return await fn();
          } catch (e) {
            if (isRateLimit(e) && attempt < retries - 1) {
              const delay = 5000 * Math.pow(2, attempt);
              console.warn(`[Treasury] ${label} rate limited, retry ${attempt + 1}/${retries} in ${delay / 1000}s`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw e;
          }
        }
      };

      let totalHarvested = 0;
      for (const positionMint of positionMints) {
        try {
          const harvestResult = await withRetry(
            () => harvestPosition(positionMint),
            `harvestPosition(${positionMint.slice(0, 8)})`
          );
          const feeA = harvestResult.feesQuote.feeOwedA;
          const feeB = harvestResult.feesQuote.feeOwedB;

          if (feeA === 0n && feeB === 0n) {
            console.log(`[Treasury] Position ${positionMint.slice(0, 8)}... no fees owed — skipping`);
            continue;
          }

          console.log(`[Treasury] Position ${positionMint.slice(0, 8)}... feeA=${feeA.toString()} feeB=${feeB.toString()} — sending harvest tx`);

          const txSig = await withRetry(
            () => harvestResult.callback(),
            `callback(${positionMint.slice(0, 8)})`
          );
          const sigStr = typeof txSig === 'string' ? txSig : String(txSig);
          console.log(`[Treasury] Harvest tx sent: ${sigStr}`);

          await new Promise(r => setTimeout(r, 3000));

          const txDetail = await withRetry(
            () => conn.getParsedTransaction(sigStr, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }),
            `getParsedTransaction(${sigStr.slice(0, 8)})`
          );

          if (txDetail?.meta) {
            const pre = txDetail.meta.preTokenBalances || [];
            const post = txDetail.meta.postTokenBalances || [];
            const walletStr = walletPubkey.toBase58();

            for (const postBal of post) {
              const postAmount = parseFloat(postBal.uiTokenAmount?.uiAmountString || '0');
              const preBal = pre.find(
                (p) => p.accountIndex === postBal.accountIndex && p.mint === postBal.mint
              );
              const preAmount = preBal ? parseFloat(preBal.uiTokenAmount?.uiAmountString || '0') : 0;
              const diff = postAmount - preAmount;

              if (diff > 0 && postBal.owner === walletStr) {
                let symbol = 'POOL';
                if (this.tokensService) {
                  const tokens = this.tokensService.listTokens();
                  const t = tokens.find((tk) => tk.mint?.toString() === postBal.mint);
                  if (t) symbol = t.symbol || t.key || 'POOL';
                }
                const event = await this.recordFeeEvent({
                  tokenMint: postBal.mint,
                  tokenSymbol: symbol,
                  amount: parseFloat(diff.toFixed(6)),
                  feeType: 'POOL_FEE',
                  txSignature: sigStr,
                });
                console.log(`[Treasury] Pool fee collected for ${symbol}: ${diff.toFixed(6)}, tx=${sigStr}`);
                results.push(event);
                totalHarvested++;
              }
            }
          } else {
            console.warn(`[Treasury] Could not parse harvest tx ${sigStr} — fee event not recorded`);
          }

          await new Promise(r => setTimeout(r, 2000));
        } catch (posErr) {
          console.warn(`[Treasury] Harvest failed for position ${positionMint.slice(0, 8)}...: ${posErr.message}`);
        }
      }

      return { ok: true, harvested: totalHarvested, skipped: totalHarvested === 0, results };
    } catch (e) {
      console.error('[Treasury] Pool fee collection error:', e.message);
      return { ok: false, error: e.message, results };
    }
  }

  async findAccountsWithWithheldFees(mintAddress) {
    const mint = new PublicKey(mintAddress);
    const accounts = [];
    try {
      const largest = await this.connection.getTokenLargestAccounts(mint);
      const { getAccount, getTransferFeeAmount } = require('@solana/spl-token');
      for (const acct of largest.value) {
        try {
          const acctInfo = await getAccount(this.connection, acct.address, 'confirmed', TOKEN_2022_PROGRAM_ID);
          const fee = getTransferFeeAmount(acctInfo);
          if (fee && Number(fee.withheldAmount) > 0) {
            accounts.push(acct.address);
          }
        } catch {}
      }
    } catch (e) {
      console.warn(`[Treasury] Could not scan accounts for ${mintAddress}:`, e.message);
    }
    return accounts;
  }

  async withdrawTransferFees(mintAddress) {
    try {
      const { Keypair, Transaction } = require('@solana/web3.js');
      const {
        createHarvestWithheldTokensToMintInstruction,
        createWithdrawWithheldTokensFromMintInstruction,
      } = require('@solana/spl-token');

      const mint = new PublicKey(mintAddress);

      let symbol = '';
      let decimals = 5;
      if (this.tokensService) {
        const tokens = this.tokensService.listTokens();
        const t = tokens.find((tk) => tk.mint.toString() === mintAddress);
        if (t) {
          symbol = t.symbol || t.key || '';
          decimals = t.decimals || 5;
        }
      }

      const mintInfo = await getMint(this.connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
      const feeConfig = getTransferFeeConfig(mintInfo);
      const mintWithheld = feeConfig?.withheldAmount ? Number(feeConfig.withheldAmount) : 0;

      const accountsWithFees = await this.findAccountsWithWithheldFees(mintAddress);

      if (mintWithheld <= 0 && accountsWithFees.length === 0) {
        return { ok: true, mint: mintAddress, symbol, amount: 0, skipped: true, reason: 'No fees to collect' };
      }

      const { getWalletBytes, getWalletKeypair } = require('../utils/wallet');
      const payer = getWalletKeypair();

      if (accountsWithFees.length > 0) {
        console.log(`[Treasury] Harvesting withheld fees from ${accountsWithFees.length} account(s) for ${symbol || mintAddress}...`);
        const harvestIx = createHarvestWithheldTokensToMintInstruction(
          mint, accountsWithFees, TOKEN_2022_PROGRAM_ID,
        );
        const harvestTx = new Transaction().add(harvestIx);
        harvestTx.feePayer = payer.publicKey;
        harvestTx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
        const harvestSig = await this.connection.sendTransaction(harvestTx, [payer], {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
        await this.connection.confirmTransaction(harvestSig, 'confirmed');
        console.log(`[Treasury] Harvested fees to mint for ${symbol || mintAddress}: tx=${harvestSig}`);
      }

      const updatedMintInfo = await getMint(this.connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID);
      const updatedFeeConfig = getTransferFeeConfig(updatedMintInfo);
      const withheldAmount = updatedFeeConfig?.withheldAmount
        ? Number(updatedFeeConfig.withheldAmount) / Math.pow(10, decimals)
        : 0;

      if (withheldAmount <= 0) {
        return { ok: true, mint: mintAddress, symbol, amount: 0, skipped: true, reason: 'No withheld fees after harvest' };
      }

      const depositTarget = this.getDepositTarget();
      if (!depositTarget) {
        return { ok: false, mint: mintAddress, error: 'No deposit target configured (set Squads vault)' };
      }

      const destinationAta = getAssociatedTokenAddressSync(
        mint, depositTarget, true, TOKEN_2022_PROGRAM_ID,
      );

      const ix = createWithdrawWithheldTokensFromMintInstruction(
        mint, destinationAta, payer.publicKey, [], TOKEN_2022_PROGRAM_ID,
      );

      const tx = new Transaction().add(ix);
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;

      const sig = await this.connection.sendTransaction(tx, [payer], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      await this.connection.confirmTransaction(sig, 'confirmed');

      const event = await this.recordFeeEvent({
        tokenMint: mintAddress,
        tokenSymbol: symbol,
        amount: withheldAmount,
        feeType: 'TRANSFER_FEE',
        txSignature: sig,
      });

      console.log(`[Treasury] Withdrew transfer fees for ${symbol || mintAddress}: ${withheldAmount}, tx=${sig}`);

      return { ok: true, mint: mintAddress, symbol, amount: withheldAmount, txSignature: sig, event };
    } catch (e) {
      console.error(`[Treasury] Transfer fee withdrawal error for ${mintAddress}:`, e.message);
      return { ok: false, mint: mintAddress, error: e.message };
    }
  }

  async withdrawAllTransferFees() {
    const tokens = this.tokensService ? this.tokensService.listTokens() : [];
    const CONCURRENCY = 2;
    const results = new Array(tokens.length);

    for (let i = 0; i < tokens.length; i += CONCURRENCY) {
      const batch = tokens.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(token => this.withdrawTransferFees(token.mint.toString()))
      );
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        const token = batch[j];
        const mintAddr = token.mint.toString();
        if (s.status === 'fulfilled') {
          results[i + j] = s.value;
          if (!s.value.skipped) {
            console.log(`[Treasury] Transfer fee result for ${token.symbol || mintAddr}: ${s.value.ok ? `collected ${s.value.amount}` : s.value.error}`);
          }
        } else {
          results[i + j] = { ok: false, mint: mintAddr, error: s.reason?.message || 'Unknown error' };
          console.error(`[Treasury] Transfer fee failed for ${token.symbol || mintAddr}: ${s.reason?.message}`);
        }
      }
    }

    const collected = results.filter((r) => r.ok && !r.skipped);
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.ok).length;

    console.log(`[Treasury] Transfer fees summary: ${collected.length} collected, ${skipped} skipped (no fees), ${failed} failed`);

    return { ok: true, total: results.length, succeeded: collected.length, skipped, failed, results };
  }

  async getVaultValuation(priceService) {
    if (!priceService) return { ok: false, error: 'PriceService not available' };

    const balances = await this.getBalances();
    const tokens = this.tokensService ? this.tokensService.listTokens() : [];

    const avgMap = {};
    for (const token of tokens) {
      try {
        const avg = await priceService.get365DayAveragePrice(token.symbol);
        if (avg && avg.vwap > 0) {
          avgMap[token.symbol] = avg.vwap;
        }
      } catch (_) {}
    }

    let totalValue = 0;
    const holdings = balances.map(b => {
      const price = avgMap[b.symbol] || 0;
      const value = b.balance * price;
      totalValue += value;
      return { symbol: b.symbol, balance: b.balance, avgPrice365d: price, value };
    });

    return { ok: true, totalValue, holdings };
  }

  async shouldBuy(tokenSymbol, priceService) {
    if (!priceService) return { shouldBuy: false, reason: 'No price service' };

    try {
      const latest = await priceService.getLatestPrice(tokenSymbol);
      if (!latest) return { shouldBuy: false, reason: 'No price data' };

      const avgResult = await priceService.get365DayAveragePrice(tokenSymbol);

      if (!avgResult.vwap || avgResult.dataPoints < 10) {
        return { shouldBuy: false, reason: 'Insufficient price history', dataPoints: avgResult.dataPoints };
      }

      const currentPrice = latest.price;
      const averagePrice = avgResult.vwap;
      const shouldBuy = currentPrice < averagePrice;
      const deviation = averagePrice > 0 ? ((currentPrice - averagePrice) / averagePrice) * 100 : 0;

      return {
        shouldBuy,
        currentPrice,
        averagePrice,
        deviation: parseFloat(deviation.toFixed(2)),
        dataPoints: avgResult.dataPoints,
        reason: shouldBuy ? 'Current price below 365-day average' : 'Current price at or above 365-day average',
      };
    } catch (e) {
      return { shouldBuy: false, reason: e.message };
    }
  }
}

module.exports = { TreasuryService };
