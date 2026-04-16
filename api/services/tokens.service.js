'use strict';

const { PublicKey } = require('@solana/web3.js');
const {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint, 
} = require('@solana/spl-token');
const { Metaplex } = require('@metaplex-foundation/js');

// Official Metaplex Token Metadata Program
const METADATA_PROGRAM_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'
);

// Enable logs only when needed
const DEBUG = String(process.env.DEBUG_TOKENS_SERVICE || '').toLowerCase() === 'true';
const log = (...args) => (DEBUG ? console.log('[TokensService]', ...args) : undefined);

function cleanStr(s) {
  return String(s || '').replace(/\0/g, '').trim();
}

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}


function getTokenProgramIdForMint(/* mint */) {
  return TOKEN_2022_PROGRAM_ID;
}

class TokensService {
  constructor({ connection, treasuryPubkey, tokensConfig }) {
    if (!connection) throw new Error('TokensService: connection is required');
    if (!treasuryPubkey) throw new Error('TokensService: treasuryPubkey is required');

    this.connection = connection;
    this.treasuryPubkey = new PublicKey(treasuryPubkey);

    this.metaplex = Metaplex.make(connection);

    // Can be empty; registry loader will overwrite after refreshFromChain()
    this.tokensConfig = tokensConfig ? this.#normalizeTokensConfig(tokensConfig) : {};

    // Cache: registry state
    this.registry = {
      programId: null,
      registryPda: null,
      count: 0,
      mints: [],
      authority: null,
      bump: null,
      lastLoadedAt: null,
    };

    log('initialized. treasury=', this.treasuryPubkey.toBase58());
  }

  updateTreasuryPubkey(newPubkey) {
    this.treasuryPubkey = new PublicKey(newPubkey);
    log('treasury updated to', this.treasuryPubkey.toBase58());
  }

  #normalizeTokensConfig(tokensConfig) {
    const out = {};
    for (const [key, t] of Object.entries(tokensConfig || {})) {
      if (!t || !t.mint) throw new Error(`TokensService: token ${key} missing mint`);
      out[key] = {
        key,
        mint: new PublicKey(t.mint),
        decimals: Number(t.decimals ?? 0),
        symbol: String(t.symbol ?? key),
        name: String(t.name ?? key),
        uri: t.uri ? String(t.uri) : undefined,
        image: t.image ? String(t.image) : undefined,
      };
    }
    return out;
  }

  listTokens() {
    return Object.values(this.tokensConfig);
  }

  getToken(tokenKey) {
    const t = this.tokensConfig[tokenKey];
    if (!t) throw new Error(`TokensService: unknown tokenKey: ${tokenKey}`);
    return t;
  }

  getMint(tokenKey) {
    const token = this.getToken(tokenKey);
    return token.mint;
  }

  getTreasuryAta(tokenKey) {
    const mint = this.getMint(tokenKey);
    const tokenProgramId = getTokenProgramIdForMint(mint);

    return getAssociatedTokenAddressSync(
      mint,
      this.treasuryPubkey,
      true,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }

  getTreasuryAtaForMint(mintPubkey, tokenProgramId) {
    return getAssociatedTokenAddressSync(
      mintPubkey,
      this.treasuryPubkey,
      true,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  }

  getAllTreasuryAtas() {
    const map = {};
    for (const t of this.listTokens()) {
      const tokenProgramId = getTokenProgramIdForMint(t.mint);
      map[t.key] = getAssociatedTokenAddressSync(
        t.mint,
        this.treasuryPubkey,
        true,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
    }
    return map;
  }

  async getTreasuryBalances() {
    return this.getOwnerBalances(this.treasuryPubkey);
  }

  getRegistryState() {
    return this.registry;
  }

  async refreshFromChain(args) {
    return this.loadFromRegistry(args);
  }

  async loadFromDatabase() {
    try {
      const { query } = require('../db/init');
      const result = await query('SELECT * FROM tokens ORDER BY id');
      if (!result.rows || result.rows.length === 0) return { count: 0 };

      const newConfig = {};
      for (const row of result.rows) {
        const key = row.symbol;
        newConfig[key] = {
          key,
          mint: new PublicKey(row.mint_address),
          decimals: row.decimals || 5,
          symbol: row.symbol,
          name: row.name || row.symbol,
          uri: row.metadata_uri || undefined,
          image: row.image_url || undefined,
        };
      }
      this.tokensConfig = { ...newConfig, ...this.tokensConfig };
      return { count: result.rows.length, source: 'database' };
    } catch {
      return { count: 0, source: 'database', error: 'DB not available' };
    }
  }

  getTokenMetadataPda(mint) {
    const mintPk = new PublicKey(mint);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
      METADATA_PROGRAM_ID
    );
    return pda;
  }

  async fetchMetaplexMetadataFields(mint) {
    const mintPk = new PublicKey(mint);

    try {
      const nft = await this.metaplex.nfts().findByMint({ mintAddress: mintPk });

      const name = cleanStr(nft?.name);
      const symbol = cleanStr(nft?.symbol);
      const uri = cleanStr(nft?.uri);

      let image;
      if (uri) {
        try {
          const j = await this.metaplex.nfts().loadJson(uri);
          image = j?.image ? String(j.image) : undefined;
        } catch {
          const j = await safeFetchJson(uri);
          image = j?.image ? String(j.image) : undefined;
        }
      }

      return { name, symbol, uri, image };
    } catch (e) {
      log('metaplex fetch failed mint=', mintPk.toBase58(), 'err=', e?.message || e);
      return null;
    }
  }

  //  Token-2022 safe decimals read
  async getMintDecimals(mintPk) {
    try {
      const mintInfo = await getMint(
        this.connection,
        mintPk,
        'confirmed',
        TOKEN_2022_PROGRAM_ID
      );
      return Number(mintInfo.decimals ?? 0);
    } catch (e) {
      log('getMintDecimals failed mint=', mintPk.toBase58(), 'err=', e?.message || e);
      return 0;
    }
  }

  // ---------------- Registry loader ----------------

  async loadFromRegistry({
    tokenCoreProgramId,
    registrySeed = 'token_registry',
    populateNamesFromMetaplex = true,
    maxTokens = 50,
  }) {
    if (!tokenCoreProgramId) throw new Error('loadFromRegistry: tokenCoreProgramId required');

    const programId = new PublicKey(tokenCoreProgramId);
    const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from(registrySeed)], programId);

    const accInfo = await this.connection.getAccountInfo(registryPda, 'confirmed');

    if (!accInfo) {
      throw new Error(
        `Token registry not found at ${registryPda.toBase58()} (seed="${registrySeed}"). Did you run initialize_registry?`
      );
    }

    // Anchor layout:
    // discriminator(8) + bump(1) + authority(32) + count(1) + mints(MAX*32)
    const data = accInfo.data;
    if (data.length < 8 + 1 + 32 + 1) {
      throw new Error('Registry account data too small (unexpected)');
    }

    let offset = 8;
    const bump = data.readUInt8(offset);
    offset += 1;

    const authority = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    const count = data.readUInt8(offset);
    offset += 1;

    //  Safety: cap count + validate length
    const safeCount = Math.min(count, maxTokens);
    const needed = 8 + 1 + 32 + 1 + safeCount * 32;
    if (data.length < needed) {
      throw new Error('Registry account data length mismatch');
    }

    const mints = [];
    for (let i = 0; i < safeCount; i++) {
      const pk = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      if (!pk.equals(PublicKey.default)) mints.push(pk);
    }

    this.registry = {
      programId,
      registryPda,
      count: safeCount,
      mints,
      authority,
      bump,
      lastLoadedAt: new Date().toISOString(),
    };

    const mintPks = mints.map(m => new PublicKey(m));
    const CHUNK = 100;
    const allMintInfos = [];
    for (let i = 0; i < mintPks.length; i += CHUNK) {
      const chunk = mintPks.slice(i, i + CHUNK);
      const infos = await this.connection.getMultipleAccountsInfo(chunk, 'confirmed');
      allMintInfos.push(...infos);
    }

    const tmp = mints.map((mint, i) => {
      let decimals = 0;
      const info = allMintInfos[i];
      if (info && info.data && info.data.length >= 45) {
        decimals = info.data[44];
      }
      return {
        _fallbackKey: `T${i + 1}`,
        mint,
        decimals,
        symbol: `T${i + 1}`,
        name: `T${i + 1}`,
        uri: undefined,
        image: undefined,
      };
    });

    if (populateNamesFromMetaplex) {
      const metaResults = await Promise.allSettled(
        tmp.map(t => this.fetchMetaplexMetadataFields(t.mint))
      );
      for (let i = 0; i < tmp.length; i++) {
        const result = metaResults[i];
        if (result.status !== 'fulfilled' || !result.value) continue;
        const meta = result.value;
        const name = cleanStr(meta.name);
        const symbol = cleanStr(meta.symbol);
        const uri = cleanStr(meta.uri);

        if (name) tmp[i].name = name;
        if (symbol) tmp[i].symbol = symbol;
        if (uri) tmp[i].uri = uri;
        if (meta.image) tmp[i].image = String(meta.image);
      }
    }

    // Rebuild tokensConfig strictly from registry
    const newConfig = {};
    for (const t of tmp) {
      const baseKey = t.symbol && t.symbol !== t._fallbackKey ? t.symbol : t._fallbackKey;

      let finalKey = baseKey;
      if (newConfig[finalKey]) {
        let n = 2;
        while (newConfig[`${baseKey}_${n}`]) n += 1;
        finalKey = `${baseKey}_${n}`;
      }

      newConfig[finalKey] = {
        key: finalKey,
        mint: t.mint,
        decimals: t.decimals,
        symbol: t.symbol || finalKey,
        name: t.name || finalKey,
        uri: t.uri,
        image: t.image,
      };
    }

    this.tokensConfig = newConfig;

    log('loaded tokens from registry:', Object.keys(this.tokensConfig));
    return {
      registryPda: registryPda.toBase58(),
      authority: authority.toBase58(),
      count: safeCount,
      mints: mints.map((m) => m.toBase58()),
    };
  }

  async getOwnerBalances(owner) {
    const ownerPk = new PublicKey(owner);
    const tokens = this.listTokens();

    const atas = tokens.map(t => {
      const tokenProgramId = getTokenProgramIdForMint(t.mint);
      return getAssociatedTokenAddressSync(
        t.mint,
        ownerPk,
        true,
        tokenProgramId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
    });

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

    const results = {};
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const ata = atas[i];
      const acctInfo = accountInfos[i];

      let amount = '0';
      let uiAmount = 0;
      let decimals = t.decimals ?? 0;

      let withheldAmount = '0';
      let availableUiAmount = 0;

      if (acctInfo && acctInfo.data && acctInfo.data.length >= 72) {
        const rawAmount = acctInfo.data.readBigUInt64LE(64);
        amount = rawAmount.toString();
        decimals = t.decimals || 5;
        uiAmount = Number(rawAmount) / Math.pow(10, decimals);
        availableUiAmount = uiAmount;

        try {
          const { unpackAccount, getTransferFeeAmount } = require('@solana/spl-token');
          const tokenProgramId = getTokenProgramIdForMint(t.mint);
          const tokenAccount = unpackAccount(ata, acctInfo, tokenProgramId);
          const feeAmount = getTransferFeeAmount(tokenAccount);
          if (feeAmount && feeAmount.withheldAmount > 0n) {
            withheldAmount = feeAmount.withheldAmount.toString();
            const available = rawAmount > feeAmount.withheldAmount ? rawAmount - feeAmount.withheldAmount : 0n;
            availableUiAmount = Number(available) / Math.pow(10, decimals);
          }
        } catch {}
      }

      results[t.key] = {
        key: t.key,
        mint: t.mint.toBase58(),
        ata: ata.toBase58(),
        amount,
        uiAmount,
        availableUiAmount,
        withheldAmount,
        decimals,
        symbol: t.symbol,
        name: t.name,
        uri: t.uri,
        image: t.image,
      };
    }

    return results;
  }
}

module.exports = { TokensService };

