// scripts/init-pools.ts
import fs from "fs";
import path from "path";
import { address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  setWhirlpoolsConfig,
  setRpc,
  setPayerFromBytes,
  createConcentratedLiquidityPool,
} from "@orca-so/whirlpools";

type Result =
  | {
      pair: string;              
      canonicalPair: string;   
      flipped: boolean;

      ok: true;
      poolAddress: string;
      txId: string;
      initializationCostLamports: string;

      tickSpacing: number;
      initialPrice: number;

      mintA: string;
      mintB: string;
    }
  | {
      pair: string;
      canonicalPair: string;
      flipped: boolean;

      ok: false;
      error: string;

      tickSpacing: number;
      initialPrice: number;

      mintA: string;
      mintB: string;
    };

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const ORCA_TICK_SPACING = Number(process.env.ORCA_TICK_SPACING ?? "64");

const MINTED_TOKENS_PATH = path.resolve(__dirname, "..", "minted.tokens.json");

interface MintedToken {
  symbol: string;
  mint: string;
  [key: string]: unknown;
}

function loadTokens(): Record<string, string> {
  if (!fs.existsSync(MINTED_TOKENS_PATH)) {
    throw new Error(`minted.tokens.json not found at ${MINTED_TOKENS_PATH}`);
  }
  const raw = fs.readFileSync(MINTED_TOKENS_PATH, "utf8");
  const tokens: MintedToken[] = JSON.parse(raw);
  if (!Array.isArray(tokens)) {
    throw new Error("minted.tokens.json must be a JSON array");
  }
  const map: Record<string, string> = {};
  for (const t of tokens) {
    map[t.symbol] = t.mint;
  }
  return map;
}

const TOKENS = loadTokens();

const PAIRS: Array<[string, string]> = [
  ["NTC", "ASDC"],
  ["NTC", "EDC"],
  ["NTC", "RDC"],
  ["NTC", "YDC"],
  ["NTC", "SDC"],
  ["NTC", "CDC"],
  ["NTC", "ADC"],
  ["NTC", "SGDC"],
  ["NTC", "DMC"],
  ["NTC", "BDC"],
];

const DEFAULT_USD_PRICE = 1;

const MINT_USD_PRICE: Record<string, number> = Object.fromEntries(
  Object.entries(TOKENS).map(([, mint]) => [mint, DEFAULT_USD_PRICE])
);

function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function readKeypairBytes(filePath: string): Uint8Array<ArrayBuffer> {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  const arr = JSON.parse(raw) as unknown;
  if (!Array.isArray(arr)) throw new Error(`Invalid keypair json: ${abs}`);
  const u8 = new Uint8Array(arr as number[]);
  return new Uint8Array(u8.buffer.slice(0)) as Uint8Array<ArrayBuffer>;
}

function asStr(x: unknown): string {
  return String(x);
}

function compareMints(a: string, b: string): number {
  const ab = Buffer.from(new PublicKey(a).toBytes());
  const bb = Buffer.from(new PublicKey(b).toBytes());
  return Buffer.compare(ab, bb);
}

function canonicalizeMints(mintX: string, mintY: string): { mintA: string; mintB: string; flipped: boolean } {
  if (compareMints(mintX, mintY) <= 0) {
    return { mintA: mintX, mintB: mintY, flipped: false };
  }
  return { mintA: mintY, mintB: mintX, flipped: true };
}

// initialPrice = price(tokenA) in terms of tokenB
function computeInitialPriceByMints(mintA: string, mintB: string): number {
  const priceA = MINT_USD_PRICE[mintA];
  const priceB = MINT_USD_PRICE[mintB];
  if (!Number.isFinite(priceA) || !Number.isFinite(priceB) || priceA <= 0 || priceB <= 0) {
    throw new Error(`Missing/invalid MINT_USD_PRICE for mintA=${mintA} or mintB=${mintB}`);
  }
  return priceA / priceB;
}

// Orca error strings differ by version; treat any “already exists” style as non-fatal.
function looksLikePoolExists(errMsg: string): boolean {
  const s = errMsg.toLowerCase();
  return (
    s.includes("already in use") ||
    s.includes("already exists") ||
    s.includes("address in use") ||
    s.includes("0x0")
  );
}

async function main(): Promise<void> {
  must(Number.isFinite(ORCA_TICK_SPACING) && ORCA_TICK_SPACING > 0, "ORCA_TICK_SPACING must be > 0");

  const orcaNetwork = process.env.ORCA_NETWORK ?? "solanaMainnet";
  console.log(`\n=== ORCA ${orcaNetwork.toUpperCase()}: INIT POOLS (TypeScript / new stack) ===\n`);
  console.log("RPC:", RPC_URL);
  console.log("TickSpacing:", ORCA_TICK_SPACING);
  console.log("Loaded mints:", Object.keys(TOKENS).join(", "));

  await setWhirlpoolsConfig(orcaNetwork);
  await setRpc(RPC_URL);

  const { getWalletBytes } = await import('./load-keypair.mjs');
  const payerBytes = getWalletBytes();
  await setPayerFromBytes(payerBytes);

  const createdPools: string[] = [];
  const results: Result[] = [];

  for (const [SYM_X, SYM_Y] of PAIRS) {
    const requestedPair = `${SYM_X}/${SYM_Y}`;

    const mintX = TOKENS[SYM_X];
    const mintY = TOKENS[SYM_Y];
    must(mintX, `Mint not found in minted.tokens.json for symbol: ${SYM_X}`);
    must(mintY, `Mint not found in minted.tokens.json for symbol: ${SYM_Y}`);

    // canonical order required by Whirlpool
    const { mintA, mintB, flipped } = canonicalizeMints(mintX, mintY);
    const canonicalPair = flipped ? `${SYM_Y}/${SYM_X}` : requestedPair;

    // compute price based on canonical (actual) mintA/mintB
    const initialPrice = computeInitialPriceByMints(mintA, mintB);

    console.log(`\n--- Creating ${requestedPair} ---`);
    console.log("requested:", requestedPair);
    console.log("canonical :", canonicalPair, flipped ? "(flipped )" : "(ok)");
    console.log("mintA:", mintA);
    console.log("mintB:", mintB);
    console.log("initialPrice (A in B):", initialPrice);

    try {
      const { poolAddress, initializationCost, callback: sendTx } =
        await createConcentratedLiquidityPool(
          address(mintA),
          address(mintB),
          ORCA_TICK_SPACING,
          initialPrice
        );

      const txId = await sendTx();
      const poolStr = asStr(poolAddress);

      console.log(" Pool:", poolStr);
      console.log("TX:", txId);

      createdPools.push(poolStr);

      results.push({
        pair: requestedPair,
        canonicalPair,
        flipped,

        ok: true,
        poolAddress: poolStr,
        txId,
        initializationCostLamports: asStr(initializationCost),

        tickSpacing: ORCA_TICK_SPACING,
        initialPrice,

        mintA,
        mintB,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);

      if (looksLikePoolExists(msg)) {
        console.warn(" Might already exist (SDK did not return address). Error:", msg);
      } else {
        console.error(" Create failed:", msg);
      }

      results.push({
        pair: requestedPair,
        canonicalPair,
        flipped,

        ok: false,
        error: msg,

        tickSpacing: ORCA_TICK_SPACING,
        initialPrice,

        mintA,
        mintB,
      });
    }
  }

  const networkLabel = (process.env.SOLANA_NETWORK || 'mainnet').toLowerCase();
  const outPath = `scripts/orca-pools.${networkLabel}.json`;
  fs.writeFileSync(outPath, JSON.stringify({ rpc: RPC_URL, results }, null, 2));
  console.log("\nSaved:", outPath);

  console.log("\nPUT THIS INTO YOUR .env:\n");
  console.log(`ORCA_WHIRLPOOLS=${createdPools.join(",")}`);
  console.log("\n========================================\n");
}

main().catch((e) => {
  console.error("init-pools failed:", e?.stack ?? e);
  process.exit(1);
});

// Run:
// npx tsx scripts/init-pools.ts