import fs from "fs";
import path from "path";
import { address } from "@solana/kit";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  setDefaultFunder,
  openFullRangePosition,
} from "@orca-so/whirlpools";
import { loadKeypairFromEnv, getWalletBytes } from './load-keypair.mjs';

// ---------------- ENV / CONFIG ----------------
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const POOLS_JSON_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  `orca-pools.${process.env.SOLANA_NETWORK || 'mainnet'}.json`
);

function loadPoolAddresses() {
  if (process.env.ORCA_WHIRLPOOLS) {
    return process.env.ORCA_WHIRLPOOLS.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (!fs.existsSync(POOLS_JSON_PATH)) {
    throw new Error(`Pools file not found: ${POOLS_JSON_PATH}. Run init-pools first.`);
  }
  const data = JSON.parse(fs.readFileSync(POOLS_JSON_PATH, "utf8"));
  if (!data || !Array.isArray(data.results)) {
    throw new Error(`Invalid pools file: ${POOLS_JSON_PATH}`);
  }
  return data.results
    .filter(r => r.ok && r.poolAddress)
    .map(r => r.poolAddress);
}

// UI deposit amounts
const AMOUNT_A_UI = Number(process.env.AMOUNT_A_UI ?? "2000000000000");
const AMOUNT_B_UI = Number(process.env.AMOUNT_B_UI ?? "2000000000000");

// Single-sided optional
const USE_TOKEN_B = (process.env.USE_TOKEN_B ?? "true").toLowerCase() !== "false";

// Your tokens are 5 decimals (override if needed)
const DECIMALS_A = Number(process.env.DECIMALS_A ?? "5");
const DECIMALS_B = Number(process.env.DECIMALS_B ?? "5");

// 50 bps = 0.5%
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "50");

// Some versions require this 4th arg: withTokenMetadataExtension (Token-2022 metadata ext).
const WITH_TOKEN_METADATA_EXTENSION =
  (process.env.WITH_TOKEN_METADATA_EXTENSION ?? "false").toLowerCase() === "true";

//  Burn/Lock destination
// Solana "Incinerator" (no one can sign) — best practice for permanent lock.
const BURN_OWNER =
  process.env.BURN_OWNER ?? "1nc1nerator11111111111111111111111111111111";


function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function readKeypairArray(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error(`Invalid keypair json: ${abs}`);
  return arr;
}

function readKeypairBytes(filePath) {
  const arr = readKeypairArray(filePath);
  const u8 = new Uint8Array(arr);
  return new Uint8Array(u8.buffer.slice(0));
}

function loadWeb3Keypair(filePath) {
  return Keypair.fromSecretKey(new Uint8Array(readKeypairArray(filePath)));
}

function asStr(x) {
  return String(x);
}

function uiToNative(amountUi, decimals) {
  must(Number.isFinite(amountUi) && amountUi > 0, "amountUi must be > 0");
  must(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, "decimals must be 0..18");

  const s = amountUi.toString();
  const [i, f = ""] = s.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);

  const base = BigInt(i || "0");
  const scale = BigInt("1" + "0".repeat(decimals));
  const fracBN = BigInt(frac || "0");

  return base * scale + fracBN;
}

async function lockPositionNftForever({
  connection,
  payerKeypair,
  positionMint, 
}) {
  const mintPk = new PublicKey(positionMint);
  const burnOwnerPk = new PublicKey(BURN_OWNER);

  //  DETECT TOKEN PROGRAM
  const mintAccountInfo = await connection.getAccountInfo(mintPk);
  if (!mintAccountInfo) {
    throw new Error(`Position mint not found: ${positionMint}`);
  }

  const isToken2022 = mintAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID);
  const tokenProgramId = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;

  console.log(`   🔍 Detected Token Program: ${isToken2022 ? 'Token-2022' : 'Legacy SPL'}`);

  // 2️ DERIVE ATAs with correct program ID
  // NOTE: 'true' is passed for allowOwnerOffCurve because Incinerator is an off-curve address.
  
  const payerAta = getAssociatedTokenAddressSync(
    mintPk,
    payerKeypair.publicKey,
    true, // allowOwnerOffCurve (safe to use true)
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const burnAta = getAssociatedTokenAddressSync(
    mintPk,
    burnOwnerPk,
    true, 
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
      0, // decimals
      [],
      tokenProgramId
    )
  );

  const tx = new Transaction().add(...ixs);
  tx.feePayer = payerKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  tx.sign(payerKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });

  await connection.confirmTransaction(sig, "confirmed");
  return { sig, payerAta: payerAta.toBase58(), burnAta: burnAta.toBase58(), burnOwner: BURN_OWNER };
}

// ---------------- Main ----------------
async function main() {
  must(Number.isFinite(AMOUNT_A_UI) && AMOUNT_A_UI > 0, "AMOUNT_A_UI must be > 0");
  must(Number.isFinite(AMOUNT_B_UI) && AMOUNT_B_UI > 0, "AMOUNT_B_UI must be > 0");
  must(Number.isFinite(SLIPPAGE_BPS) && SLIPPAGE_BPS >= 0, "SLIPPAGE_BPS must be >= 0");

  const pools = loadPoolAddresses();
  must(pools.length > 0, "No pool addresses found. Set ORCA_WHIRLPOOLS env or run init-pools first.");

  const networkBanner = (process.env.SOLANA_NETWORK || 'mainnet').toUpperCase();
  console.log(`\n=== ORCA ${networkBanner}: INIT LIQUIDITY + LOCK LP (Position NFT) ===\n`);
  console.log("RPC:", RPC_URL);
  console.log("Pools:", pools.join(", "));
  console.log("AMOUNT_A_UI:", AMOUNT_A_UI, "AMOUNT_B_UI:", AMOUNT_B_UI, "USE_TOKEN_B:", USE_TOKEN_B);
  console.log("DECIMALS_A:", DECIMALS_A, "DECIMALS_B:", DECIMALS_B);
  console.log("SLIPPAGE_BPS:", SLIPPAGE_BPS);
  console.log("WITH_TOKEN_METADATA_EXTENSION:", WITH_TOKEN_METADATA_EXTENSION);
  console.log("LOCK/BURN OWNER:", BURN_OWNER);

  // Orca SDK config
  const orcaNetwork = process.env.ORCA_NETWORK ?? "solanaMainnet";
  await setWhirlpoolsConfig(orcaNetwork);
  await setRpc(RPC_URL);

  // Keep SAME signer instance for orca actions
  const payerBytes = getWalletBytes();
  const signer = await setPayerFromBytes(payerBytes);

  setDefaultFunder(signer);

  const connection = new Connection(RPC_URL, "confirmed");
  const payerKeypair = loadKeypairFromEnv();

  const tokenMaxA = uiToNative(AMOUNT_A_UI, DECIMALS_A);
  const tokenMaxB = uiToNative(AMOUNT_B_UI, DECIMALS_B);

  console.log("tokenMaxA(native):", tokenMaxA.toString());
  if (USE_TOKEN_B) console.log("tokenMaxB(native):", tokenMaxB.toString());

  const results = [];

  for (const poolStr of pools) {
    console.log("\n----------------------------------------");
    console.log("Pool:", poolStr);

    try {
      const poolAddr = address(poolStr);

      const params = USE_TOKEN_B ? { tokenMaxA, tokenMaxB } : { tokenMaxA };

      // 1) Open LP position (adds liquidity)
      const res = await openFullRangePosition(
        poolAddr,
        params,
        SLIPPAGE_BPS,
        WITH_TOKEN_METADATA_EXTENSION
      );

      const lpSig = await res.callback();

      const positionMint = asStr(res.positionMint ?? res.positionAddress);
      if (!res.positionMint) {
        console.warn(
          "SDK did not return positionMint explicitly. Trying fallback from positionAddress."
        );
      }

      console.log("Liquidity added");
      console.log("   LP TX:", lpSig);
      console.log("   positionMint:", positionMint);
      console.log("   init cost (lamports):", asStr(res.initializationCost));

      // 2) LOCK forever (burn/lock position NFT)
      console.log(" Locking Position NFT forever (transfer to incinerator)...");
      
      // const lockRes = await lockPositionNftForever({
      //   connection,
      //   payerKeypair,
      //   positionMint,
      // });

      // console.log("Position NFT locked forever");
      // console.log("   lock tx:", lockRes.sig);
      // console.log("   payer ATA:", lockRes.payerAta);
      // console.log("   burn ATA :", lockRes.burnAta);
      // console.log("   burn owner:", lockRes.burnOwner);

      results.push({
        pool: poolStr,
        ok: true,
        lpTxId: lpSig,
        // lockTxId: lockRes.sig,
        positionMint,
        initializationCostLamports: asStr(res.initializationCost),
        tokenMaxA: tokenMaxA.toString(),
        ...(USE_TOKEN_B ? { tokenMaxB: tokenMaxB.toString() } : {}),
        // burnOwner: lockRes.burnOwner,
        // burnAta: lockRes.burnAta,
      });
    } catch (e) {
      const msg = e?.message || String(e);
      const logs = e?.logs ? `\n   Logs:\n   ${e.logs.join('\n   ')}` : '';
      console.error(" Failed:", msg, logs);
      results.push({ pool: poolStr, ok: false, error: msg });
    }
  }

  const networkLabel = (process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();
  const outPath = `scripts/orca-liquidity.${networkLabel}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ rpc: RPC_URL, results }, null, 2));
  console.log("\nSaved:", outPath);
  console.log("\nDONE\n");
}

main().catch((e) => {
  console.error("init-liquidity failed:", e?.stack ?? e);
  process.exit(1);
});