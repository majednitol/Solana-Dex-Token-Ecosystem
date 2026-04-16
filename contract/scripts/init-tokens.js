/* eslint-disable no-console */

const anchor = require("@coral-xyz/anchor");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const fs = require("fs");
const path = require("path");
const bs58 = require("bs58");

// Token-2022 helpers
const {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} = require("@solana/spl-token");

// Irys (Arweave upload)
const { Uploader } = require("@irys/upload");
const { Solana } = require("@irys/upload-solana");

// Metaplex Program ID
const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// -------------------- CONFIG --------------------
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const COMMITMENT = process.env.SOLANA_COMMITMENT ?? "confirmed";

// Assets folder (logos)
const ASSETS_DIR = path.resolve("assets");

// ALWAYS Token-2022
const TOKEN_PROGRAM_ID_FOR_MINTS = TOKEN_2022_PROGRAM_ID;

// Universal fee: 0.05% = 5 bps
const TAX_BPS = Number(process.env.UNIVERSAL_TAX_BPS ?? "5"); // 5 = 0.05%
const MAX_FEE_U64 = BigInt("18446744073709551615"); // u64::MAX (practically “no cap”)

// Treasury pubkey (where withheld fees are withdrawable; also initial recipient)
const TREASURY_OWNER = new PublicKey(
  process.env.TREASURY_OWNER ?? "B9hBF4uGunmyFU3R8Wuiq2kQVudofVuTqoYc6PzkV85s"
);

// Metaplex metadata toggles
const DO_METADATA = (process.env.DO_METADATA ?? "true").toLowerCase() === "true";
const METADATA_EXTERNAL_URL = process.env.METADATA_EXTERNAL_URL ?? "https://yourdomain.com";

const IRYS_FUND_SOL = Number(process.env.IRYS_FUND_SOL ?? "0.05");

// Token list
const TOKENS = [
  { name: "Nite Treasury Currency", symbol: "NTC", supplyUi: 120_000_000_000_000n, logoFile: "NTC.png", decimals: 5 },
  { name: "America States Digital Currency", symbol: "ASDC", supplyUi: 5_000_000_000_000n, logoFile: "ASDC.png", decimals: 5 },
  { name: "Euro Digital Currency", symbol: "EDC", supplyUi: 5_000_000_000_000n, logoFile: "EDC.png", decimals: 5 },
  { name: "Brazil Digital Currency", symbol: "RDC", supplyUi: 5_000_000_000_000n, logoFile: "RDC.png", decimals: 5 },
  { name: "Yuan Digital Currency", symbol: "YDC", supplyUi: 5_000_000_000_000n, logoFile: "YDC.png", decimals: 5 },
  { name: "Swiss Digital Currency", symbol: "SDC", supplyUi: 5_000_000_000_000n, logoFile: "SDC.png", decimals: 5 },
  { name: "Canadian Digital Currency", symbol: "CDC", supplyUi: 5_000_000_000_000n, logoFile: "CDC.png", decimals: 5 },
  { name: "Australian Digital Currency", symbol: "ADC", supplyUi: 5_000_000_000_000n, logoFile: "ADC.png", decimals: 5 },
  { name: "Singapore Digital Currency", symbol: "SGDC", supplyUi: 5_000_000_000_000n, logoFile: "SGDC.png", decimals: 5 },
  { name: "Dome Coin", symbol: "DMC", supplyUi: 5_000_000_000_000n, logoFile: "DMC.png", decimals: 5 },
  { name: "British Digital Currency", symbol: "BDC", supplyUi: 5_000_000_000_000n, logoFile: "BDC.png", decimals: 5 },
];

// -------------------- Helpers --------------------
const pow10 = (n) => 10n ** BigInt(n);

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function prettyErr(e) {
  return e?.error?.errorMessage || e?.message || e?.toString?.() || String(e);
}

function loadKeypairJson(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const secret = JSON.parse(fs.readFileSync(abs, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadPayerKeypair() {
  const fp = process.env.WALLET_KEYPAIR_PATH;
  const b58 = process.env.SOLANA_PRIVATE_KEY_BASE58;
  const jsonArr = process.env.WALLET_SECRET_KEY_JSON;

  if (fp) return loadKeypairJson(fp);
  if (b58) return Keypair.fromSecretKey(bs58.decode(b58));
  if (jsonArr) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(jsonArr)));

  //  DEV FALLBACK (remove in prod)
  const HARDCODED = Uint8Array.from([173,210,207,217,23,197,226,75,254,3,56,205,25,198,125,193,59,0,86,39,228,241,2,24,195,102,86,222,138,27,18,130,150,206,241,140,251,178,19,29,148,10,102,234,120,215,104,116,97,116,74,0,173,200,76,151,139,38,47,161,206,132,58,198]);

  console.warn("⚠️ Using hardcoded payer key (DEV ONLY)");
  return Keypair.fromSecretKey(HARDCODED);
}

function ataForProgram(owner, mint, tokenProgramId) {
  return getAssociatedTokenAddressSync(mint, owner, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
}

async function ensureSolBalance(connection, pubkey, minSol = 0.2) {
  const bal = await connection.getBalance(pubkey, COMMITMENT);
  const sol = bal / LAMPORTS_PER_SOL;
  if (sol >= minSol) return;

  console.log(`⚠️ Low SOL balance (${sol.toFixed(4)}). Airdropping ${minSol} SOL -> ${pubkey.toBase58()}`);
  const sig = await connection.requestAirdrop(pubkey, Math.ceil(minSol * LAMPORTS_PER_SOL));
  await connection.confirmTransaction(sig, COMMITMENT);
}

// ---------- Irys ----------
function irysGatewayUrl(id) {
  return `https://gateway.irys.xyz/${id}`;
}

async function getIrys(payerSecretKeyU8) {
  const builder = Uploader(Solana).withWallet(Array.from(payerSecretKeyU8)).withRpc(RPC);
  const irys = await builder.mainnet();
  console.log('[Irys] Initialized on mainnet');
  await irys.fund(irys.utils.toAtomic(IRYS_FUND_SOL));
  return irys;
}

async function uploadLogoToArweave(irys, filePath, symbol) {
  const receipt = await irys.uploadFile(filePath, {
    tags: [
      { name: "Content-Type", value: "image/png" },
      { name: "token-symbol", value: symbol },
    ],
  });
  return irysGatewayUrl(receipt.id);
}

async function uploadMetadataToArweave(irys, metadata, symbol) {
  const receipt = await irys.upload(JSON.stringify(metadata), {
    tags: [
      { name: "Content-Type", value: "application/json" },
      { name: "token-symbol", value: symbol },
    ],
  });
  return irysGatewayUrl(receipt.id);
}

// ---------- Metaplex (Umi -> web3 ix) ----------
function toWeb3JsInstruction(umiIx) {
  return new TransactionInstruction({
    keys: umiIx.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey.toString()),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    programId: new PublicKey(umiIx.programId.toString()),
    data: Buffer.from(umiIx.data),
  });
}

async function getCreateMetadataInstruction({ mint, payer, name, symbol, uri, decimals }) {
  const { createUmi } = await import("@metaplex-foundation/umi-bundle-defaults");
  const { signerIdentity, createSignerFromKeypair, publicKey, percentAmount } = await import("@metaplex-foundation/umi");
  const { mplTokenMetadata, createV1, TokenStandard } = await import("@metaplex-foundation/mpl-token-metadata");

  const umi = createUmi(RPC).use(mplTokenMetadata());
  const umiKeypair = umi.eddsa.createKeypairFromSecretKey(payer.secretKey);
  const signer = createSignerFromKeypair(umi, umiKeypair);
  umi.use(signerIdentity(signer));

  const builder = createV1(umi, {
    mint: publicKey(mint.toBase58()),
    authority: signer,
    payer: signer,
    name,
    symbol,
    uri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
    decimals,
    isMutable: true,
  });

  const umiInstructions = builder.getInstructions();
  if (umiInstructions.length === 0) throw new Error("No instructions generated by Metaplex");

  return toWeb3JsInstruction(umiInstructions[0]);
}

// ---------- Token-2022 mint with universal fee ----------
async function createToken2022MintWithFee({
  connection,
  payerKp,
  name,
  symbol,
  decimals,
  supplyUi,
  metadataUri,
}) {
  must(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, "decimals must be 0..18");
  must(typeof supplyUi === "bigint" && supplyUi > 0n, "supplyUi must be bigint > 0");

  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  // TransferFeeConfig extension on mint
  const extensions = [ExtensionType.TransferFeeConfig];
  const mintLen = getMintLen(extensions);
  const rentLamports = await connection.getMinimumBalanceForRentExemption(mintLen, COMMITMENT);

  const supplyRaw = supplyUi * pow10(decimals);

  // Fee config authorities (withheld fees)
  const transferFeeConfigAuthority = TREASURY_OWNER;
  const withdrawWithheldAuthority = TREASURY_OWNER;

  const tx = new Transaction();

  // 1) Create mint account owned by Token-2022
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payerKp.publicKey,
      newAccountPubkey: mint,
      space: mintLen,
      lamports: rentLamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  // 2) Initialize transfer fee config (0.05% = 5 bps)
  tx.add(
    createInitializeTransferFeeConfigInstruction(
      mint,
      transferFeeConfigAuthority,
      withdrawWithheldAuthority,
      TAX_BPS,
      MAX_FEE_U64,
      TOKEN_2022_PROGRAM_ID
    )
  );

  // 3) Initialize mint
  tx.add(
    createInitializeMintInstruction(
      mint,
      decimals,
      payerKp.publicKey, // mint authority initially = payer
      null, // freeze authority = null
      TOKEN_2022_PROGRAM_ID
    )
  );

  // 4) Create Metaplex metadata (off-chain instruction, on-chain account)
  if (metadataUri) {
    const metaIx = await getCreateMetadataInstruction({
      mint,
      payer: payerKp,
      name,
      symbol,
      uri: metadataUri,
      decimals,
    });
    tx.add(metaIx);
  }

  // 5) Create treasury ATA (Token-2022 ATA)
  const treasuryAta = ataForProgram(TREASURY_OWNER, mint, TOKEN_2022_PROGRAM_ID);
  tx.add(
    createAssociatedTokenAccountInstruction(
      payerKp.publicKey,
      treasuryAta,
      TREASURY_OWNER,
      mint,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  // 6) Mint full supply to treasury
  tx.add(
    createMintToInstruction(
      mint,
      treasuryAta,
      payerKp.publicKey,
      supplyRaw,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  // 7) Renounce mint authority (fixed supply)
  tx.add(
    createSetAuthorityInstruction(
      mint,
      payerKp.publicKey,
      AuthorityType.MintTokens,
      null,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payerKp, mintKp], {
    commitment: COMMITMENT,
    skipPreflight: false,
  });

  return {
    mint: mint.toBase58(),
    tokenProgramId: TOKEN_2022_PROGRAM_ID.toBase58(),
    treasuryAta: treasuryAta.toBase58(),
    signature: sig,
    decimals,
    supplyRaw: supplyRaw.toString(),
  };
}

// ---------- Registry helpers ----------
function findRegistryPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from("token_registry")], programId)[0];
}

// Anchor layout:
// discriminator(8) + bump(1) + authority(32) + count(1) + mints(MAX*32)
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

// Ensure registry exists (one-time init)
async function ensureRegistryInitialized({ connection, payerKp, program }) {
  const registryPda = findRegistryPda(program.programId);

  const info = await connection.getAccountInfo(registryPda, "confirmed");
  if (info) {
    console.log("0) Token registry already exists:", registryPda.toBase58());
    return registryPda;
  }

  console.log("0) Initializing token registry (one-time):", registryPda.toBase58());
  await program.methods
    .initializeRegistry(TREASURY_OWNER)
    .accounts({
      authority: payerKp.publicKey,
      registry: registryPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: COMMITMENT });

  console.log("Registry initialized");
  return registryPda;
}

//  Register mint idempotently (client-side precheck + on-chain idempotent)
async function registerMintIdempotent({ connection, program, registryPda, payerKp, mintPk }) {
  // 1) Read registry and skip if already exists
  const info = await connection.getAccountInfo(registryPda, "confirmed");
  if (info?.data) {
    const reg = decodeRegistry(info.data);
    if (reg?.mints?.some((m) => m.equals(mintPk))) {
      console.log("   3.1) Mint already registered (skip):", mintPk.toBase58());
      return { skipped: true };
    }
  }

  // 2) Call on-chain register_mint (your Rust now returns Ok if duplicate)
  console.log("   3.1) Registering mint into registry...");
  const sig = await program.methods
    .registerMint(mintPk)
    .accounts({
      authority: payerKp.publicKey,
      registry: registryPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: COMMITMENT });

  console.log("   Mint registered. TX:", sig);
  return { skipped: false, signature: sig };
}

// -------------------- MAIN --------------------
(async () => {
  must(Number.isInteger(TAX_BPS) && TAX_BPS >= 0 && TAX_BPS <= 10_000, "UNIVERSAL_TAX_BPS must be 0..10000");
  must(fs.existsSync(ASSETS_DIR), `Assets dir not found: ${ASSETS_DIR}`);

  const connection = new Connection(RPC, COMMITMENT);
  const payerKp = loadPayerKeypair();

  console.log("\n==============================");
  console.log("CREATE TOKENS (TOKEN-2022 ONLY)");
  console.log("==============================");
  console.log("RPC:", RPC);
  console.log("Commitment:", COMMITMENT);
  console.log("Payer:", payerKp.publicKey.toBase58());
  console.log("Treasury:", TREASURY_OWNER.toBase58());
  console.log("Token Program:", TOKEN_PROGRAM_ID_FOR_MINTS.toBase58());
  console.log("Universal Fee BPS:", TAX_BPS, "(0.05% = 5 bps)");
  console.log("DO_METADATA:", DO_METADATA);
  console.log("==============================\n");

  await ensureSolBalance(connection, payerKp.publicKey, 0.5);

  // Irys uploader
  const irys = await getIrys(payerKp.secretKey);

  // Anchor provider + program (registry only)
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payerKp), { commitment: COMMITMENT });
  anchor.setProvider(provider);

  const tokenCoreProgram = anchor.workspace.TokenCoreContracts;
  must(tokenCoreProgram, "Anchor workspace program TokenCoreContracts not found (check Anchor.toml name).");

  // Ensure registry exists
  const registryPda = await ensureRegistryInitialized({ connection, payerKp, program: tokenCoreProgram });

  const minted = [];

  for (const t of TOKENS) {
    console.log(`\n==============================`);
    console.log(`TOKEN: ${t.symbol} | ${t.name}`);
    console.log(`==============================`);

    try {
      // 1) Upload logo
      const logoPath = path.join(ASSETS_DIR, t.logoFile);
      must(fs.existsSync(logoPath), `Missing logo file: ${logoPath}`);

      console.log("1) Uploading logo to Irys...");
      const imageUrl = await uploadLogoToArweave(irys, logoPath, t.symbol);
      console.log("   imageUrl:", imageUrl);

      // 2) Upload metadata JSON
      let metadataUri = null;
      if (DO_METADATA) {
        console.log("2) Uploading metadata JSON to Irys...");
        const metadataJson = {
          name: t.name,
          symbol: t.symbol,
          description: `${t.name} (${t.symbol}) token.`,
          image: imageUrl,
          external_url: METADATA_EXTERNAL_URL,
        };
        metadataUri = await uploadMetadataToArweave(irys, metadataJson, t.symbol);
        console.log("   metadataUri:", metadataUri);
      } else {
        console.log("2) Metadata upload skipped (DO_METADATA=false).");
      }

      // 3) Mint (Token-2022 + TransferFeeConfig)
      console.log("3) Creating Token-2022 mint with UNIVERSAL TransferFeeConfig (0.05%)...");
      const out = await createToken2022MintWithFee({
        connection,
        payerKp,
        name: t.name,
        symbol: t.symbol,
        decimals: t.decimals,
        supplyUi: t.supplyUi,
        metadataUri,
      });

      console.log("   Mint:", out.mint);
      console.log("   Token Program:", out.tokenProgramId);
      console.log("   Treasury ATA:", out.treasuryAta);
      console.log("   Mint TX:", out.signature);

      // 3.1) Register mint in your on-chain registry PDA (idempotent)
      await registerMintIdempotent({
        connection,
        program: tokenCoreProgram,
        registryPda,
        payerKp,
        mintPk: new PublicKey(out.mint),
      });

      minted.push({
        symbol: t.symbol,
        name: t.name,
        mint: out.mint,
        tokenProgramId: out.tokenProgramId,
        treasuryAta: out.treasuryAta,
        decimals: out.decimals,
        supplyRaw: out.supplyRaw,
        metadataUri,
        imageUrl,
        universalTransferFeeBps: TAX_BPS,
      });
    } catch (e) {
      console.error(`Failed for ${t.symbol}:`, prettyErr(e));
      throw e;
    }
  }

  console.log("\n==============================");
  console.log("DONE");
  console.log("==============================\n");

  console.table(
    minted.map((m) => ({
      symbol: m.symbol,
      mint: m.mint,
      program: "TOKEN_2022",
      feeBps: m.universalTransferFeeBps,
    }))
  );

  const outPath = path.resolve("minted.tokens.json");
  fs.writeFileSync(outPath, JSON.stringify(minted, null, 2), "utf8");
  console.log("Saved:", outPath);

  console.log("\nNext steps:");
  console.log("1) Use minted.tokens.json mints in scripts/init-pools.ts (TOKENS map)");
  console.log("2) Recreate pools + add liquidity using these Token-2022 mints");
  console.log("3) Your API should read ONLY from registry PDA + Metaplex metadata");
})().catch((e) => {
  console.error("FATAL:", prettyErr(e));
  process.exit(1);
});

