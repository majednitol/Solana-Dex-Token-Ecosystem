import fs from "fs";
import path from "path";
import { Connection, Keypair } from "@solana/web3.js";
import { address } from "@solana/kit";

import {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  setDefaultFunder,
  harvestAllPositionFees,
  harvestPosition,
} from "@orca-so/whirlpools";
import { loadKeypairFromEnv, getWalletBytes } from './load-keypair.mjs';

// ---------------- ENV / CONFIG ----------------
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const NETWORK = process.env.ORCA_NETWORK ?? "solanaMainnet";

const TARGET_POSITION = process.env.TARGET_POSITION || "H2wsppfAu3FDbUy198Yw4vdjnF1fDCLutwjytYqDFscv";

// ---------------- Helpers ----------------
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

// ---------------- Main ----------------
async function main() {
  console.log("\n=== ORCA: HARVEST FEES & REWARDS ===\n");
  console.log("RPC:", RPC_URL);
  console.log("Network:", NETWORK);
  if (TARGET_POSITION) {
    console.log("Target Position:", TARGET_POSITION);
  } else {
    console.log("Mode: Harvest ALL owned positions");
  }

  // 1. Orca SDK Config
  await setWhirlpoolsConfig(NETWORK);
  await setRpc(RPC_URL);

  // 2. Setup Signer
  const payerBytes = getWalletBytes();
  const signer = await setPayerFromBytes(payerBytes);
  setDefaultFunder(signer);

  const payerKeypair = loadKeypairFromEnv();
  console.log("Signer Public Key:", payerKeypair.publicKey.toBase58());

  try {
    if (TARGET_POSITION) {
      // --- Harvest Single Position ---
      console.log(`\nHarvesting single position: ${TARGET_POSITION}...`);
      
      const { 
        callback: harvestCallback, 
        feesQuote, 
        rewardsQuote 
      } = await harvestPosition(address(TARGET_POSITION));

      // Log quotes
      console.log("   Quotes:");
      console.log(`   - Fee A: ${feesQuote.feeOwedA}`);
      console.log(`   - Fee B: ${feesQuote.feeOwedB}`);
      
      if (rewardsQuote && rewardsQuote.rewards) {
        rewardsQuote.rewards.forEach((r, i) => {
          if (r.rewardsOwed > 0n) {
            console.log(`   - Reward ${i}: ${r.rewardsOwed}`);
          }
        });
      }

      // Execute
      const harvestSig = await harvestCallback();
      console.log(` Harvested position in tx: ${harvestSig}`);

    } else {
      // --- Harvest ALL Positions ---
      console.log(`\nScanning wallet for all positions...`);
      
      // This function automatically finds all positions for the set Payer
      const signatures = await harvestAllPositionFees();
      
      if (signatures.length === 0) {
        console.log(" No harvestable positions found for this wallet.");
        console.log("   (If you just locked them, they are no longer owned by this wallet).");
      } else {
        console.log(`Harvested all positions in ${signatures.length} transaction(s):`);
        signatures.forEach((sig, i) => {
          console.log(`   ${i + 1}. ${sig}`);
        });
      }
    }

  } catch (e) {
    const msg = e?.message || String(e);
    const logs = e?.logs ? `\n   Logs:\n   ${e.logs.join('\n   ')}` : '';
    console.error("Failed:", msg, logs);
  }

  console.log("\n DONE\n");
}

main().catch((e) => {
  console.error("Harvest failed:", e?.stack ?? e);
  process.exit(1);
});