// import { Uploader } from "@irys/upload";
// import { Solana } from "@irys/upload-solana";

// // Your Solana secret key (64 bytes)
// const WALLET_SECRET_KEY = Uint8Array.from([
//   131, 83, 146, 190, 65, 134, 176, 74, 225, 129, 218, 47, 31, 39, 22, 8,
//   35, 228, 93, 28, 177, 187, 219, 78, 202, 186, 165, 211, 210, 110, 101,
//   18, 26, 80, 32, 60, 5, 167, 221, 103, 194, 56, 168, 65, 29, 105, 193,
//   196, 222, 131, 77, 243, 212, 47, 188, 110, 213, 142, 132, 193, 218,
//   105, 227, 104
// ]);

// async function main() {
//   const SOLANA_RPC = "https://api.devnet.solana.com";

//   // Irys uploader (Solana) on devnet
//   const irys = await Uploader(Solana)
//     .withWallet(Array.from(WALLET_SECRET_KEY)) // pass as number[]
//     .withRpc(SOLANA_RPC)
//     .devnet();

//   // fund Irys (small amount)
//   await irys.fund(irys.utils.toAtomic(0.01));

//   // upload text
//   const receipt = await irys.upload("Hello Irys", {
//     tags: [{ name: "Content-Type", value: "text/plain" }],
//   });

//   console.log( Upload ID:", receipt.id);
//   console.log("URL:", `https://gateway.irys.xyz/${receipt.id}`);
// }

// main().catch(console.error);
