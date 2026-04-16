'use strict';

const fs = require('fs');
const path = require('path');
const {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
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
const { Uploader } = require('@irys/upload');
const { Solana } = require('@irys/upload-solana');

const TAX_BPS = 5;
const MAX_FEE_U64 = BigInt('18446744073709551615');
const COMMITMENT = 'confirmed';
const IRYS_FUND_SOL = Number(process.env.IRYS_FUND_SOL ?? '0.05');

function pow10(n) {
  return 10n ** BigInt(n);
}

function irysGatewayUrl(id) {
  return `https://gateway.irys.xyz/${id}`;
}

function findRegistryPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from('token_registry')], programId)[0];
}

function decodeRegistry(data) {
  if (!data || data.length < 8 + 1 + 32 + 1) return null;
  let off = 8;
  const bump = data.readUInt8(off); off += 1;
  const authority = new PublicKey(data.slice(off, off + 32)); off += 32;
  const count = data.readUInt8(off); off += 1;
  const mints = [];
  for (let i = 0; i < count; i++) {
    const pk = new PublicKey(data.slice(off, off + 32));
    off += 32;
    if (!pk.equals(PublicKey.default)) mints.push(pk);
  }
  return { bump, authority, count, mints };
}

class TokenCreationService {
  constructor({ connection, wallet, tokenCoreProgramId, apiBaseUrl }) {
    this.connection = connection;
    this.wallet = wallet;
    this.tokenCoreProgramId = tokenCoreProgramId ? new PublicKey(tokenCoreProgramId) : null;
    this.apiBaseUrl = apiBaseUrl || '';
    const { getRpcUrl } = require('../utils/network');
    this.rpcUrl = getRpcUrl();
    this._irys = null;
  }

  async _getIrys() {
    if (this._irys) return this._irys;
    const secretKey = Array.from(this.wallet.secretKey);
    console.log('[Irys] Initializing Irys uploader (mainnet)...');
    const builder = Uploader(Solana).withWallet(secretKey).withRpc(this.rpcUrl);
    this._irys = await builder.mainnet();
    try {
      await this._irys.fund(this._irys.utils.toAtomic(IRYS_FUND_SOL));
      console.log(`[Irys] Funded ${IRYS_FUND_SOL} SOL`);
    } catch (e) {
      console.warn('[Irys] Fund warning (may already be funded):', e.message);
    }
    return this._irys;
  }

  async uploadLogoToIrys(filePath, symbol) {
    const irys = await this._getIrys();
    const fileSize = fs.statSync(filePath).size;
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    console.log(`[Irys] Uploading logo file: ${filePath} (${fileSize} bytes, ${contentType}) for ${symbol}`);
    const receipt = await irys.uploadFile(filePath, {
      tags: [
        { name: 'Content-Type', value: contentType },
        { name: 'token-symbol', value: symbol },
      ],
    });
    const url = irysGatewayUrl(receipt.id);
    console.log(`[Irys] Logo uploaded: ${url}`);
    return url;
  }

  async uploadMetadataToIrys(metadata, symbol) {
    const irys = await this._getIrys();
    console.log(`[Irys] Uploading metadata JSON for ${symbol}`);
    const receipt = await irys.upload(JSON.stringify(metadata), {
      tags: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'token-symbol', value: symbol },
      ],
    });
    const url = irysGatewayUrl(receipt.id);
    console.log(`[Irys] Metadata uploaded: ${url}`);
    return url;
  }

  async buildCreateTokenTransaction({ userPubkey, name, symbol, supply, decimals, logoIrysUrl, treasuryVaultPda }) {
    if (!name || !symbol) throw new Error('name and symbol are required');
    if (!supply || supply <= 0) throw new Error('supply must be > 0');
    decimals = decimals ?? 5;

    const payer = new PublicKey(userPubkey);
    const mintDestination = treasuryVaultPda ? new PublicKey(treasuryVaultPda) : payer;
    const mintToVault = !!treasuryVaultPda;
    const supplyBigInt = BigInt(supply);
    const logoUrl = logoIrysUrl || '';

    const metadataJson = {
      name,
      symbol: symbol.toUpperCase(),
      description: `${name} (${symbol.toUpperCase()}) token.`,
      image: logoUrl,
      external_url: 'https://cryptoniteswap.com',
      attributes: [
        { trait_type: 'decimals', value: String(decimals) },
        { trait_type: 'transferFeeBps', value: String(TAX_BPS) },
      ],
    };

    const metadataUrl = await this.uploadMetadataToIrys(metadataJson, symbol);

    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;

    const tokenMetadata = {
      mint,
      name,
      symbol: symbol.toUpperCase(),
      uri: metadataUrl,
      additionalMetadata: [
        ['transferFeeBps', String(TAX_BPS)],
        ['decimals', String(decimals)],
      ],
    };

    const extensions = [ExtensionType.TransferFeeConfig, ExtensionType.MetadataPointer];
    const mintLen = getMintLen(extensions);
    const metadataLen = 2 + 2 + pack(tokenMetadata).length;
    const totalLamports = await this.connection.getMinimumBalanceForRentExemption(mintLen + metadataLen, COMMITMENT);

    const supplyRaw = supplyBigInt * pow10(decimals);

    const tx = new Transaction();

    tx.add(
      SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: mint,
        space: mintLen,
        lamports: totalLamports,
        programId: TOKEN_2022_PROGRAM_ID,
      })
    );

    tx.add(
      createInitializeTransferFeeConfigInstruction(
        mint,
        payer,
        payer,
        TAX_BPS,
        MAX_FEE_U64,
        TOKEN_2022_PROGRAM_ID
      )
    );

    tx.add(
      createInitializeMetadataPointerInstruction(
        mint,
        payer,
        mint,
        TOKEN_2022_PROGRAM_ID
      )
    );

    tx.add(
      createInitializeMintInstruction(
        mint,
        decimals,
        payer,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    tx.add(
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        mint,
        metadata: mint,
        name,
        symbol: symbol.toUpperCase(),
        uri: metadataUrl,
        mintAuthority: payer,
        updateAuthority: payer,
      })
    );

    for (const [key, value] of tokenMetadata.additionalMetadata) {
      tx.add(
        createUpdateFieldInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          metadata: mint,
          updateAuthority: payer,
          field: key,
          value,
        })
      );
    }

    const treasuryAta = getAssociatedTokenAddressSync(
      mint, mintDestination, mintToVault, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tx.add(
      createAssociatedTokenAccountInstruction(
        payer,
        treasuryAta,
        mintDestination,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    tx.add(
      createMintToInstruction(
        mint,
        treasuryAta,
        payer,
        supplyRaw,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    tx.add(
      createSetAuthorityInstruction(
        mint,
        payer,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(COMMITMENT);
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;

    tx.partialSign(mintKp);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      ok: true,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
      mint: mint.toBase58(),
      treasuryAta: treasuryAta.toBase58(),
      symbol: symbol.toUpperCase(),
      name,
      decimals,
      supply: supply.toString(),
      metadataUrl,
      logoUrl,
      transferFeeBps: TAX_BPS,
    };
  }

  async buildUpdateMetadataTransaction({ userPubkey, mintAddress, name, symbol, logoFilePath }) {
    const payer = new PublicKey(userPubkey);
    const mint = new PublicKey(mintAddress);

    const logoIrysUrl = await this.uploadLogoToIrys(logoFilePath, symbol);

    const metadataJson = {
      name,
      symbol: symbol.toUpperCase(),
      description: `${name} (${symbol.toUpperCase()}) token.`,
      image: logoIrysUrl,
      external_url: 'https://cryptoniteswap.com',
      attributes: [
        { trait_type: 'decimals', value: '5' },
        { trait_type: 'transferFeeBps', value: String(TAX_BPS) },
      ],
    };

    const newMetadataUrl = await this.uploadMetadataToIrys(metadataJson, symbol);

    const updateUriIx = createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: payer,
      field: 'uri',
      value: newMetadataUrl,
    });

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash(COMMITMENT);
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;
    tx.add(updateUriIx);

    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return {
      ok: true,
      transaction: serialized,
      blockhash,
      lastValidBlockHeight,
      mintAddress,
      symbol,
      metadataUrl: newMetadataUrl,
      logoUrl: logoIrysUrl,
    };
  }

  async registerMintInRegistry(mintPubkey) {
    if (!this.tokenCoreProgramId) return { skipped: true, error: 'No token-core program' };
    try {
      return await this._registerInRegistry(new PublicKey(mintPubkey));
    } catch (e) {
      return { skipped: true, error: e.message };
    }
  }

  async _registerInRegistry(mintPk) {
    const anchor = require('@coral-xyz/anchor');
    const registryPda = findRegistryPda(this.tokenCoreProgramId);

    const info = await this.connection.getAccountInfo(registryPda, COMMITMENT);
    if (info?.data) {
      const reg = decodeRegistry(info.data);
      if (reg?.mints?.some((m) => m.equals(mintPk))) {
        return { skipped: true, registryPda: registryPda.toBase58() };
      }
    }

    const provider = new anchor.AnchorProvider(
      this.connection,
      new anchor.Wallet(this.wallet),
      { commitment: COMMITMENT }
    );

    const idlPath = path.resolve(__dirname, '..', '..', 'contract', 'target', 'idl', 'token_core_contracts.json');
    let idl;
    try {
      idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
    } catch {
      return { skipped: true, error: 'IDL not found', registryPda: registryPda.toBase58() };
    }

    const program = new anchor.Program(idl, provider);
    const sig = await program.methods
      .registerMint(mintPk)
      .accounts({
        authority: this.wallet.publicKey,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: COMMITMENT });

    return { skipped: false, signature: sig, registryPda: registryPda.toBase58() };
  }
}

module.exports = { TokenCreationService };
