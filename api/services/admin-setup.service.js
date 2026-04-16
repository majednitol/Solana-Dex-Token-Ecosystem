'use strict';

const {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  Keypair,
} = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createInitializeMetadataPointerInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} = require('@solana/spl-token');
const { createInitializeInstruction, createUpdateFieldInstruction, pack } = require('@solana/spl-token-metadata');
const { query } = require('../db/init');
const path = require('path');
const fs = require('fs');

const TAX_BPS = 5;
const MAX_FEE_U64 = BigInt('18446744073709551615');
const COMMITMENT = 'confirmed';

const SEED_TREASURY = Buffer.from('treasury');
const SEED_TREASURY_AUTH = Buffer.from('auth');

const PREDEFINED_TOKENS = [
  { name: 'Nite Treasury Currency', symbol: 'NTC', supply: '120000000000000', logoFile: 'NTC.png', decimals: 5 },
  { name: 'America States Digital Currency', symbol: 'ASDC', supply: '5000000000000', logoFile: 'ASDC.png', decimals: 5 },
  { name: 'Euro Digital Currency', symbol: 'EDC', supply: '5000000000000', logoFile: 'EDC.png', decimals: 5 },
  { name: 'Brazil Digital Currency', symbol: 'RDC', supply: '5000000000000', logoFile: 'RDC.png', decimals: 5 },
  { name: 'Yuan Digital Currency', symbol: 'YDC', supply: '5000000000000', logoFile: 'YDC.png', decimals: 5 },
  { name: 'Swiss Digital Currency', symbol: 'SDC', supply: '5000000000000', logoFile: 'SDC.png', decimals: 5 },
  { name: 'Canadian Digital Currency', symbol: 'CDC', supply: '5000000000000', logoFile: 'CDC.png', decimals: 5 },
  { name: 'Australian Digital Currency', symbol: 'ADC', supply: '5000000000000', logoFile: 'ADC.png', decimals: 5 },
  { name: 'Singapore Digital Currency', symbol: 'SGDC', supply: '5000000000000', logoFile: 'SGDC.png', decimals: 5 },
  { name: 'Dome Coin', symbol: 'DMC', supply: '5000000000000', logoFile: 'DMC.png', decimals: 5 },
  { name: 'British Digital Currency', symbol: 'BDC', supply: '5000000000000', logoFile: 'BDC.png', decimals: 5 },
];

function pow10(n) {
  return 10n ** BigInt(n);
}


class AdminSetupService {
  constructor({ connection, wallet, tokenCreationService }) {
    this.connection = connection;
    this.wallet = wallet;
    this.tokenCreationService = tokenCreationService;
  }

  async getProgramConfig() {
    try {
      const result = await query('SELECT key, value, updated_at FROM program_config ORDER BY key');
      const config = {};
      for (const row of result.rows) {
        config[row.key] = row.value;
      }
      return config;
    } catch {
      return {
        token_core_program_id: '',
      };
    }
  }

  async saveProgramConfig({ token_core_program_id }) {
    const entries = [
      { key: 'token_core_program_id', value: token_core_program_id },
    ];
    for (const e of entries) {
      if (!e.value) continue;
      await query(
        `INSERT INTO program_config (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [e.key, e.value]
      );
    }
    return { ok: true };
  }

  async saveMultisigOwners({ owner1, owner2, owner3 }) {
    const existing = await query('SELECT id FROM multisig_owners LIMIT 1');
    if (existing.rows.length > 0) {
      await query(
        `UPDATE multisig_owners SET owner1 = $1, owner2 = $2, owner3 = $3, updated_at = NOW() WHERE id = $4`,
        [owner1, owner2, owner3, existing.rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO multisig_owners (owner1, owner2, owner3) VALUES ($1, $2, $3)`,
        [owner1, owner2, owner3]
      );
    }
    return { ok: true };
  }

  async getMultisigOwners() {
    try {
      const result = await query('SELECT owner1, owner2, owner3, updated_at FROM multisig_owners ORDER BY id DESC LIMIT 1');
      if (result.rows.length > 0) return result.rows[0];
    } catch {}
    return null;
  }

  getPredefinedTokens() {
    return PREDEFINED_TOKENS;
  }

  async getTokensFromDb() {
    try {
      const result = await query('SELECT * FROM tokens ORDER BY id');
      return result.rows;
    } catch {
      return [];
    }
  }

  async saveTokenToDb({ symbol, name, mint_address, decimals, supply, metadata_uri, image_url, tx_signature }) {
    await query(
      `INSERT INTO tokens (symbol, name, mint_address, decimals, supply, metadata_uri, image_url, tx_signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (symbol) DO UPDATE SET
         mint_address = $3, decimals = $4, supply = $5, metadata_uri = $6, image_url = $7, tx_signature = $8`,
      [symbol, name, mint_address, decimals, String(supply), metadata_uri || '', image_url || '', tx_signature || '']
    );
    return { ok: true };
  }

  async saveVaultConfig({ multisig_pda, treasury_authority_pda, program_id, owners, threshold, allowed_programs, tx_signature, skipVerification = false }) {
    if (tx_signature && !skipVerification) {
      let txConfirmed = false;
      for (let attempt = 0; attempt < 3 && !txConfirmed; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000));
        try {
          const txStatus = await this.connection.getSignatureStatus(tx_signature);
          const status = txStatus?.value;
          if (status) {
            if (status.err) {
              const errDetail = JSON.stringify(status.err);
              console.error('[Vault] Transaction failed on-chain:', errDetail);
              throw new Error(`Vault transaction failed on Solana: ${errDetail}`);
            }
            if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
              txConfirmed = true;
              break;
            }
          }
          console.log(`[Vault] Tx status attempt ${attempt + 1}: ${status ? status.confirmationStatus : 'not found yet'}`);
        } catch (e) {
          if (e.message?.includes('Vault transaction failed')) throw e;
          console.warn(`[Vault] Status check attempt ${attempt + 1} error:`, e?.message || String(e));
        }
      }

      if (!txConfirmed) {
        const info = await this.connection.getAccountInfo(new PublicKey(multisig_pda));
        if (info) {
          console.log('[Vault] Account exists on-chain despite status check issues');
          txConfirmed = true;
        } else {
          const txDetail = await this.connection.getTransaction(tx_signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
          if (txDetail?.meta?.err) {
            const logs = txDetail.meta.logMessages || [];
            const errMsg = logs.filter(l => l.includes('Error') || l.includes('failed') || l.includes('Program log:')).join(' | ');
            throw new Error(`Vault transaction failed: ${errMsg || JSON.stringify(txDetail.meta.err)}`);
          }
          throw new Error('Vault transaction was not confirmed on-chain. The account does not exist. Please check your wallet has enough SOL and try again.');
        }
      }
    }

    await query('DELETE FROM multisig_config');
    await query(
      `INSERT INTO multisig_config (multisig_pda, treasury_authority_pda, program_id, owners, threshold, allowed_programs, tx_signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [multisig_pda, treasury_authority_pda, program_id, JSON.stringify(owners), threshold, JSON.stringify(allowed_programs || []), tx_signature || '']
    );
    return { ok: true };
  }

  async getVaultConfig() {
    try {
      const result = await query('SELECT * FROM multisig_config ORDER BY id DESC LIMIT 1');
      if (result.rows.length > 0) {
        const row = result.rows[0];
        try {
          const multisigPda = new PublicKey(row.multisig_pda);
          const info = await this.connection.getAccountInfo(multisigPda);
          if (!info) {
            row._onChainExists = false;
          } else {
            row._onChainExists = true;
          }
        } catch {
          row._onChainExists = false;
        }
        return row;
      }
    } catch {}
    return null;
  }

  async buildTreasuryAtasTransaction({ userPubkey }) {
    const payer = new PublicKey(userPubkey);
    const tokens = await this.getTokensFromDb();
    if (tokens.length === 0) throw new Error('No tokens found in database. Init tokens first.');

    const vault = await this.getVaultConfig();
    if (!vault) throw new Error('No vault config found. Init vault first.');

    const treasuryAuthority = new PublicKey(vault.treasury_authority_pda || vault.treasuryAuthority);

    const existingAtas = await this.getTreasuryWallets();
    const existingMints = new Set(existingAtas.map(a => a.mint_address));

    const tokensNeedAta = tokens.filter(t => !existingMints.has(t.mint_address));
    if (tokensNeedAta.length === 0) {
      return { ok: true, message: 'All treasury ATAs already exist', transactions: [], atas: [] };
    }

    const BATCH_SIZE = 8;
    const transactions = [];
    const ataInfos = [];

    for (let i = 0; i < tokensNeedAta.length; i += BATCH_SIZE) {
      const batch = tokensNeedAta.slice(i, i + BATCH_SIZE);
      const instructions = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ];

      for (const token of batch) {
        const mint = new PublicKey(token.mint_address);
        const ata = getAssociatedTokenAddressSync(mint, treasuryAuthority, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

        const ataInfo = await this.connection.getAccountInfo(ata);
        if (ataInfo) {
          ataInfos.push({
            token_symbol: token.symbol,
            mint_address: token.mint_address,
            treasury_ata: ata.toBase58(),
            already_exists: true,
          });
          continue;
        }

        instructions.push(
          createAssociatedTokenAccountInstruction(
            payer,
            ata,
            treasuryAuthority,
            mint,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );

        ataInfos.push({
          token_symbol: token.symbol,
          mint_address: token.mint_address,
          treasury_ata: ata.toBase58(),
          already_exists: false,
        });
      }

      if (instructions.length <= 2) continue;

      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(COMMITMENT);
      const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(messageV0);
      transactions.push({
        transaction: Buffer.from(tx.serialize()).toString('base64'),
        blockhash,
        lastValidBlockHeight,
        batch_index: Math.floor(i / BATCH_SIZE),
      });
    }

    const alreadyExisting = ataInfos.filter(a => a.already_exists);
    if (alreadyExisting.length > 0) {
      for (const ata of alreadyExisting) {
        await this.saveTreasuryWallet({ ...ata, tx_signature: 'pre-existing' });
      }
    }

    return { ok: true, transactions, atas: ataInfos, saved_existing: alreadyExisting.length };
  }

  async saveTreasuryWallet({ token_symbol, mint_address, treasury_ata, tx_signature }) {
    await query(
      `INSERT INTO treasury_wallets (token_symbol, mint_address, treasury_ata, tx_signature)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (mint_address) DO UPDATE SET
         treasury_ata = $3, tx_signature = $4`,
      [token_symbol, mint_address, treasury_ata, tx_signature || '']
    );
    return { ok: true };
  }

  async getTreasuryWallets() {
    try {
      const result = await query('SELECT * FROM treasury_wallets ORDER BY id');
      return result.rows;
    } catch {
      return [];
    }
  }

  async getSetupStatus() {
    const programs = await this.getProgramConfig();
    const tokens = await this.getTokensFromDb();
    const owners = await this.getMultisigOwners();
    const vault = await this.getVaultConfig();
    const atas = await this.getTreasuryWallets();

    return {
      programs: {
        configured: !!programs.token_core_program_id,
        data: programs,
      },
      tokens: {
        count: tokens.length,
        total: PREDEFINED_TOKENS.length,
        initialized: tokens.map(t => t.symbol),
        data: tokens,
      },
      multisigOwners: {
        configured: !!owners,
        data: owners,
      },
      vault: {
        initialized: vault ? (vault._onChainExists !== false) : false,
        onChainMissing: vault ? (vault._onChainExists === false) : false,
        data: vault,
      },
      treasuryAtas: {
        count: atas.length,
        data: atas,
      },
    };
  }
}

module.exports = { AdminSetupService, PREDEFINED_TOKENS };
