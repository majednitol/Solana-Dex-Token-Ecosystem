// scripts/close-position.mjs
import fs from "fs"; 
import path from "path";
import { address, } from "@solana/kit";
import {
  closePosition,
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  setDefaultFunder, 
} from "@orca-so/whirlpools";
import { getWalletBytes } from './load-keypair.mjs';

// ---------------- ENV / CONFIG ----------------
const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const NETWORK = process.env.ORCA_NETWORK ?? "solanaMainnet";

// Defaulting to your locked position for testing (will fail if locked)
const POSITION_MINT =
  process.env.POSITION_MINT ?? "7kXvunQadoo2i6TbrgJd3X9L22YPt5NtLpYujVT9g11Y";

const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS ?? "50");

// ---------------- Helpers ----------------
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function readKeypairBytes(filePath) {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error(`Invalid keypair json: ${abs}`);
  const u8 = new Uint8Array(arr);
  return new Uint8Array(u8.buffer.slice(0));
}

// ---------------- Main ----------------
async function main() {
  must(POSITION_MINT, "POSITION_MINT is required");

  console.log("\n=== ORCA: CLOSE POSITION (remove liquidity + collect fees/rewards) ===\n");
  console.log("RPC:", RPC_URL);
  console.log("Network:", NETWORK);
  console.log("Position Mint:", POSITION_MINT);
  console.log("Slippage BPS:", SLIPPAGE_BPS);

  // 1) Orca config
  await setWhirlpoolsConfig(NETWORK);
  await setRpc(RPC_URL);



  // 3) Signer Setup
  const payerBytes = getWalletBytes();
  const signer = await setPayerFromBytes(payerBytes);
  
  //  2. CRITICAL FIX: Register the signer globally
  console.log(signer)
  setDefaultFunder(signer);

  try {
    console.log(address(POSITION_MINT))
    //  3. FIX: Pass slippage argument
    const { callback: sendTx, quote, feesQuote, rewardsQuote, instructions } =
      await closePosition( address(POSITION_MINT) );

    console.log("\nEstimates:");
    console.log("  tokenEstA:", quote?.tokenEstA?.toString?.() ?? String(quote?.tokenEstA));
    console.log("  tokenEstB:", quote?.tokenEstB?.toString?.() ?? String(quote?.tokenEstB));
    console.log("  feeOwedA :", feesQuote?.feeOwedA?.toString?.() ?? String(feesQuote?.feeOwedA));
    console.log("  feeOwedB :", feesQuote?.feeOwedB?.toString?.() ?? String(feesQuote?.feeOwedB));
    console.log("  rewards  :", rewardsQuote?.rewards?.length ?? 0);
    console.log("  ixs      :", instructions?.length ?? 0);

    console.log("\nSending tx...");
    const txId = await sendTx();
    console.log(" Closed position TX:", txId);
  } catch (e) {
    const msg = e?.message ?? String(e);
    console.error("\n closePosition failed:", msg);
    if (e?.logs) console.error("Logs:\n" + e.logs.join("\n"));

    // common case in your setup
    if (msg.toLowerCase().includes("invalidauthority") || msg.toLowerCase().includes("owner")) {
      console.error("\nHint: You must OWN the position NFT.");
      console.error("If you transferred it to incinerator (locked forever), you can NEVER close/withdraw.");
    }
  }
}

main().catch((e) => {
  console.error("Script failed:", e?.stack ?? e);
  process.exit(1);
});