// demo-dynamic-pool.js

import { 
  setWhirlpoolsConfig,
  fetchWhirlpoolsByTokenPair
} from "@orca-so/whirlpools";

import { createSolanaRpc, mainnet, address } from "@solana/kit";

/**
 * Helper: Convert Raw BigInt amount to UI String (e.g. 1000000 -> "10.0" for 5 decimals)
 */
function nativeToUi(amount, decimals) {
  if (amount === 0n) return "0";
  
  const amountStr = amount.toString();
  const dec = Number(decimals);
  
  // Pad with leading zeros if necessary
  const padLength = dec > amountStr.length ? dec - amountStr.length : 0;
  const padded = "0".repeat(padLength) + amountStr;
  
  // Insert decimal point
  const intPart = padded.slice(0, padded.length - dec) || "0";
  const fracPart = padded.slice(padded.length - dec);
  
  // Trim trailing zeros from fraction
  const trimmedFrac = fracPart.replace(/0+$/, "");
  
  return trimmedFrac.length > 0 ? `${intPart}.${trimmedFrac}` : intPart;
}

async function fetchVaultBalances(rpc, pool) {
  const [vaultAInfo, vaultBInfo] = await Promise.all([
    rpc.getAccountInfo(address(pool.tokenVaultA), { encoding: 'base64' }).send(),
    rpc.getAccountInfo(address(pool.tokenVaultB), { encoding: 'base64' }).send(),
  ]);

  const decodeAmount = (info) => {
    if (!info || !info.value || !info.value.data) return 0n;
    const data = info.value.data[0]; 
    const buffer = Buffer.from(data, 'base64');
    return buffer.readBigUInt64LE(64);
  };

  return { 
    rawAmountA: decodeAmount(vaultAInfo), 
    rawAmountB: decodeAmount(vaultBInfo) 
  };
}

/**
 * Updated to accept decimals for proper formatting
 */
async function getBestPoolByMints({ mintA, mintB, decimalsA = 5, decimalsB = 5 }) {
  const network = process.env.ORCA_NETWORK ?? "solanaMainnet";
  await setWhirlpoolsConfig(network);

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const rpc = createSolanaRpc(
    mainnet(rpcUrl)
  );

  const pools = await fetchWhirlpoolsByTokenPair(
    rpc,
    address(mintA),
    address(mintB)
  );

  if (!pools || pools.length === 0) {
    return { ok: false, error: "No pools found for this pair" };
  }

  const initialized = pools.filter(p => p.initialized);

  if (initialized.length === 0) {
    return { ok: false, error: "No initialized pools found" };
  }

  const bestPool = initialized.sort(
    (a, b) => Number(b.liquidity) - Number(a.liquidity)
  )[0];
  
  console.log("Best Pool Address:", bestPool.address.toString());

  // Fetch raw balances
  const { rawAmountA, rawAmountB } = await fetchVaultBalances(rpc, bestPool);

  // ✅ Convert to UI Amounts
  const uiAmountA = nativeToUi(rawAmountA, decimalsA);
  const uiAmountB = nativeToUi(rawAmountB, decimalsB);

  return {
    ok: true,
    poolAddress: bestPool.address.toString(),
    tickSpacing: bestPool.tickSpacing,
    liquidity: bestPool.liquidity.toString(),
    feeRate: bestPool.feeRate,
    reserves: {
      tokenA: {
        mint: bestPool.tokenMintA.toString(),
        vault: bestPool.tokenVaultA.toString(),
        amount: rawAmountA.toString(), // Raw
        uiAmount: uiAmountA,            // Human readable
        decimals: decimalsA
      },
      tokenB: {
        mint: bestPool.tokenMintB.toString(),
        vault: bestPool.tokenVaultB.toString(),
        amount: rawAmountB.toString(), // Raw
        uiAmount: uiAmountB,            // Human readable
        decimals: decimalsB
      }
    }
  };
}

// 🔥 Example usage
(async () => {
  const result = await getBestPoolByMints({
    mintA: "BJ51GNuenBiKqU3HTAzZKeqm2nM72jL9PUdf4uMw8FmR",
    mintB: "H9o2X4LmA5G4xuKLwUYUk37HpvubgkQmD6R8eMA8CiZA",
    decimalsA: 5, // Passing known decimals
    decimalsB: 5
  });

  console.log("\nResult:\n", JSON.stringify(result, null, 2));
})();