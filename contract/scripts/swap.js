import fs from "fs";
import path from "path";

import { address, createSolanaRpc, mainnet, devnet } from "@solana/kit";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  swapInstructions,
} from "@orca-so/whirlpools";

import { loadKeypairFromEnv, getWalletBytes } from './load-keypair.mjs';

// ================= CONFIG =================
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const POOL =
  process.env.POOL ?? "HtNLDxNNmHjQrk6mWpH5Ku5ab2Q8YCK8psiJMM5Qi7sc";

const INPUT_MINT =
  process.env.INPUT_MINT ?? "AgDXvJ1JPBWj9LTfBcvg86qPDfqL2vMDWX8LycCNvvLY";

const UI_AMOUNT = Number(process.env.AMOUNT ?? "1");
const DECIMALS = Number(process.env.DECIMALS ?? "5");
const SLIPPAGE_BPS = Number(process.env.SLIPPAGE ?? "100");

// ================= HELPERS =================
function uiToNative(amount, decimals) {
  const s = amount.toString();
  const [i, f = ""] = s.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  const scale = BigInt("1" + "0".repeat(decimals));
  return BigInt(i || "0") * scale + BigInt(frac || "0");
}

function readKeypairArray(file) {
  const abs = path.resolve(file);
  const arr = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (!Array.isArray(arr)) throw new Error(`Invalid keypair json: ${abs}`);
  return arr;
}

function readKeypairBytes(file) {
  const arr = readKeypairArray(file);
  const u8 = new Uint8Array(arr);
  return new Uint8Array(u8.buffer.slice(0));
}

function loadKeypair(file) {
  return Keypair.fromSecretKey(new Uint8Array(readKeypairArray(file)));
}

function pickPubkeyString(a) {
  return (
    a?.pubkey?.toString?.() ??
    a?.address?.toString?.() ??
    a?.pubkey ??
    a?.address ??
    a
  );
}

function detectSigner(a) {
  // Handle @solana/kit numeric role (bitmask)
  // Bit 1 (Value 2) indicates Signer.
  if (typeof a.role === "number") {
    return (a.role & 2) !== 0;
  }

  // Handle legacy web3.js or string-based definitions
  const role = String(a?.role ?? "").toLowerCase();
  const mode = String(a?.mode ?? "").toLowerCase();
  const access = String(a?.access ?? "").toLowerCase();
  return Boolean(a?.isSigner) || Boolean(a?.signer) || role.includes("signer") || mode.includes("signer") || access.includes("signer");
}

function detectWritable(a) {
  // Handle @solana/kit numeric role (bitmask)
  // Bit 0 (Value 1) indicates Writable.
  if (typeof a.role === "number") {
    return (a.role & 1) !== 0;
  }

  // Handle legacy checks
  const role = String(a?.role ?? "").toLowerCase();
  const mode = String(a?.mode ?? "").toLowerCase();
  const access = String(a?.access ?? "").toLowerCase();

  if (a?.isWritable !== undefined) return Boolean(a.isWritable);
  if (a?.writable !== undefined) return Boolean(a.writable);
  if (a?.meta?.isWritable !== undefined) return Boolean(a.meta.isWritable);
  if (a?.meta?.writable !== undefined) return Boolean(a.meta.writable);

  if (role.includes("writable")) return true;
  if (mode.includes("writable")) return true;
  if (access.includes("writable")) return true;

  return false;
}

/**
 * Convert Orca/Kit instruction -> web3.js TransactionInstruction
 */
function kitIxToWeb3Ix(ix, forceWritablePubkeys) {
  const programIdStr = ix?.programAddress ?? ix?.programId ?? ix?.program;
  if (!programIdStr) throw new Error("Instruction missing programAddress/programId");

  const programId = new PublicKey(String(programIdStr));

  const keys = (ix.accounts ?? []).map((a) => {
    const pkStr = pickPubkeyString(a);
    if (!pkStr) throw new Error("Account meta missing pubkey/address");

    const pubkeyStr = String(pkStr);
    const isSigner = detectSigner(a);

    // Ensure specific accounts (like pool) are writable if needed,
    // otherwise rely on detectWritable logic.
    const isWritable = forceWritablePubkeys.has(pubkeyStr) ? true : detectWritable(a);

    return {
      pubkey: new PublicKey(pubkeyStr),
      isSigner,
      isWritable,
    };
  });

  const dataU8 = ix?.data ?? new Uint8Array();

  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.from(dataU8),
  });
}

// ================= MAIN =================
async function main() {
  const orcaNetwork = process.env.ORCA_NETWORK ?? "solanaMainnet";
  const isMainnet = orcaNetwork === "solanaMainnet";
  console.log(`\n=== ORCA ${orcaNetwork.toUpperCase()} SWAP (EXECUTE) ===\n`);

  await setWhirlpoolsConfig(orcaNetwork);
  await setRpc(RPC_URL);

  const rpc = createSolanaRpc(isMainnet ? mainnet(RPC_URL) : devnet(RPC_URL));

  // Orca signer used by swap builder
  const signer = await setPayerFromBytes(getWalletBytes());

  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypairFromEnv();

  const amountIn = uiToNative(UI_AMOUNT, DECIMALS);

  console.log("Pool:", POOL);
  console.log("Input mint:", INPUT_MINT);
  console.log("Amount in (native):", amountIn.toString());
  console.log("Slippage (bps):", SLIPPAGE_BPS);

  const { instructions, quote } = await swapInstructions(
    rpc,
    { inputAmount: amountIn, mint: address(INPUT_MINT) },
    address(POOL),
    SLIPPAGE_BPS,
    signer
  );

  console.log("\n--- QUOTE ---");
  console.log("Estimated out:", quote.tokenEstOut?.toString?.() ?? String(quote.tokenEstOut));
  console.log("Min out:", quote.tokenMinOut?.toString?.() ?? String(quote.tokenMinOut));

  // Force whirlpool (pool) account to be writable (safe fallback)
  const forceWritable = new Set([POOL]);

  // Convert kit instructions -> web3 instructions
  const web3Ixs = instructions.map((ix) => kitIxToWeb3Ix(ix, forceWritable));

  const tx = new Transaction().add(...web3Ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  tx.sign(payer);

  console.log("\nSending swap tx...");
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });

  await connection.confirmTransaction(sig, "confirmed");

  console.log("SWAP EXECUTED");
  console.log("TX SIG:", sig);
}

main().catch((e) => {
  console.error("swap failed:", e?.stack ?? e);
  process.exit(1);
});