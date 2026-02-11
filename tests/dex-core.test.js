/* eslint-disable no-console */
const anchor = require("@coral-xyz/anchor");
const assert = require("assert");

const { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAccount,
} = require("@solana/spl-token");

// ---------------------------
// Helpers
// ---------------------------
async function airdrop(connection, pubkey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

function ata(owner, mint) {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

async function ensureAta(provider, payerPubkey, ownerPubkey, mintPubkey) {
  const ataPk = ata(ownerPubkey, mintPubkey);
  const info = await provider.connection.getAccountInfo(ataPk, "confirmed");
  if (info) return ataPk;

  const ix = createAssociatedTokenAccountInstruction(
    payerPubkey,
    ataPk,
    ownerPubkey,
    mintPubkey,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const tx = new anchor.web3.Transaction().add(ix);
  await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
  return ataPk;
}

async function createTestMint(provider, decimals = 6, mintAuthorityPubkey) {
  const mintKp = Keypair.generate();
  const mintPk = mintKp.publicKey;

  const rent = await provider.connection.getMinimumBalanceForRentExemption(82);
  const tx = new anchor.web3.Transaction();

  tx.add(
    SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: mintPk,
      lamports: rent,
      space: 82,
      programId: TOKEN_PROGRAM_ID,
    })
  );

  tx.add(
    createInitializeMintInstruction(
      mintPk,
      decimals,
      mintAuthorityPubkey,
      null,
      TOKEN_PROGRAM_ID
    )
  );

  await provider.sendAndConfirm(tx, [mintKp], { commitment: "confirmed" });
  return { mintKp, mintPk };
}

async function mintTo(provider, mint, destAta, mintAuthorityKp, amount) {
  const ix = createMintToInstruction(
    mint,
    destAta,
    mintAuthorityKp.publicKey,
    amount,
    [],
    TOKEN_PROGRAM_ID
  );
  const tx = new anchor.web3.Transaction().add(ix);
  await provider.sendAndConfirm(tx, [mintAuthorityKp], { commitment: "confirmed" });
}

// PDAs (must match dex-core seeds)
function findPairPda(programId, treasury, mintKnite, mintSub) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pair"), treasury.toBuffer(), mintKnite.toBuffer(), mintSub.toBuffer()],
    programId
  );
}
function findVaultPda(programId, seed, pairPk) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), pairPk.toBuffer()],
    programId
  );
}

// Constant-product calc used for exact assertions in tests
function cpOut(amountIn, reserveIn, reserveOut) {
  // out = (in * R_out) / (R_in + in)
  const inU = BigInt(amountIn);
  const rin = BigInt(reserveIn);
  const rout = BigInt(reserveOut);
  if (rin === 0n || rout === 0n) throw new Error("InsufficientLiquidity");
  return (inU * rout) / (rin + inU);
}
function feeCeil(amount, bps) {
  // ceil(amount * bps / 10_000)
  const amt = BigInt(amount);
  const b = BigInt(bps);
  const den = 10000n;
  if (b === 0n) return 0n;
  const num = amt * b;
  return (num + den - 1n) / den;
}

describe("dex-core (Phase 1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.DexCoreContracts;
  const connection = provider.connection;

  // Actors
  const treasury = Keypair.generate();
  const user = Keypair.generate();
  const attacker = Keypair.generate();

  // Mints (kNite + Sub)
  let mintKnite;
  let mintSub;

  // Pair PDAs + vaults
  let pairPda;
  let vaultKnite;
  let vaultSub;

  // ATAs
  let treasuryKniteAta;
  let userKniteAta;
  let userSubAta;

  const decimals = 6;

  before(async () => {
    await airdrop(connection, treasury.publicKey, 4);
    await airdrop(connection, user.publicKey, 2);
    await airdrop(connection, attacker.publicKey, 2);

    // Create mints with treasury as mint authority so we can seed vaults + give user balances
    const mk = await createTestMint(provider, decimals, treasury.publicKey);
    const ms = await createTestMint(provider, decimals, treasury.publicKey);
    mintKnite = mk.mintPk;
    mintSub = ms.mintPk;

    // Derive pair + vault addresses
    [pairPda] = findPairPda(program.programId, treasury.publicKey, mintKnite, mintSub);
    [vaultKnite] = findVaultPda(program.programId, "vault_knite", pairPda);
    [vaultSub] = findVaultPda(program.programId, "vault_sub", pairPda);

    // ATAs
    treasuryKniteAta = await ensureAta(provider, provider.wallet.publicKey, treasury.publicKey, mintKnite);
    userKniteAta = await ensureAta(provider, provider.wallet.publicKey, user.publicKey, mintKnite);
    userSubAta = await ensureAta(provider, provider.wallet.publicKey, user.publicKey, mintSub);

    // Give user balances for swaps
    await mintTo(provider, mintKnite, userKniteAta, treasury, 5_000_000_000n);
    await mintTo(provider, mintSub, userSubAta, treasury, 5_000_000_000n);
  });

  it("initialize_pair: creates pair + vaults; vault authority is pair PDA; fee=30; enabled=true", async () => {
    await program.methods
      .initializePair(treasury.publicKey)
      .accounts({
        treasurySigner: treasury.publicKey,
        mintKnite,
        mintSub,
        pair: pairPda,
        vaultKnite,
        vaultSub,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([treasury])
      .rpc();

    const pair = await program.account.pair.fetch(pairPda);
    assert.ok(pair.treasury.equals(treasury.publicKey));
    assert.ok(pair.mintKnite.equals(mintKnite));
    assert.ok(pair.mintSub.equals(mintSub));
    assert.ok(pair.vaultKnite.equals(vaultKnite));
    assert.ok(pair.vaultSub.equals(vaultSub));
    assert.strictEqual(pair.swapFeeBps, 30);
    assert.strictEqual(pair.enabled, true);

    // TokenAccount.owner is the authority pubkey
    const vK = await getAccount(connection, vaultKnite, "confirmed", TOKEN_PROGRAM_ID);
    const vS = await getAccount(connection, vaultSub, "confirmed", TOKEN_PROGRAM_ID);
    assert.ok(vK.owner.equals(pairPda));
    assert.ok(vS.owner.equals(pairPda));
  });

  it("initialize_pair: rejects non-treasury signer (arg mismatch)", async () => {
    const [pair2] = findPairPda(program.programId, treasury.publicKey, mintSub, mintKnite);
    const [vk2] = findVaultPda(program.programId, "vault_knite", pair2);
    const [vs2] = findVaultPda(program.programId, "vault_sub", pair2);

    try {
      await program.methods
        .initializePair(treasury.publicKey)
        .accounts({
          treasurySigner: attacker.publicKey, // 
          mintKnite: mintSub,
          mintSub: mintKnite,
          pair: pair2,
          vaultKnite: vk2,
          vaultSub: vs2,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Expected Unauthorized");
    } catch (e) {
      assert.ok(e.toString().includes("Unauthorized") || e.toString().includes("custom program error"));
    }
  });

  it("seed liquidity into dex vaults (test setup)", async () => {
    // Pair vaults are owned by pair PDA, so only treasury can't transfer directly.
    // We mint directly into vaults (mint authority is treasury) to create reserves.
    await mintTo(provider, mintKnite, vaultKnite, treasury, 1_000_000_000n);
    await mintTo(provider, mintSub, vaultSub, treasury, 2_000_000_000n);

    const rK = (await getAccount(connection, vaultKnite, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const rS = (await getAccount(connection, vaultSub, "confirmed", TOKEN_PROGRAM_ID)).amount;
    assert.ok(rK > 0n && rS > 0n);
  });

  it("swap_exact_in: kNite -> Sub (fee from input to treasury ATA), respects min_out, updates reserves", async () => {
    const amountIn = 100_000n;

    // reserves before
    const beforeVK = await getAccount(connection, vaultKnite, "confirmed", TOKEN_PROGRAM_ID);
    const beforeVS = await getAccount(connection, vaultSub, "confirmed", TOKEN_PROGRAM_ID);
    const reserveK = beforeVK.amount;
    const reserveS = beforeVS.amount;

    const fee = feeCeil(amountIn, 30);
    assert.ok(fee > 0n && amountIn > fee);
    const netIn = amountIn - fee;
    const expectedOut = cpOut(netIn, reserveK, reserveS);

    // balances before
    const beforeTreasury = (await getAccount(connection, treasuryKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeUserIn = (await getAccount(connection, userKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeUserOut = (await getAccount(connection, userSubAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

    await program.methods
      .swapExactIn(new anchor.BN(amountIn.toString()), new anchor.BN(expectedOut.toString()))
      .accounts({
        user: user.publicKey,

        mintIn: mintKnite,
        mintOut: mintSub,

        pair: pairPda,

        userAtaIn: userKniteAta,
        userAtaOut: userSubAta,

        vaultKnite,
        vaultSub,

        treasuryKniteAta,

        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const afterTreasury = (await getAccount(connection, treasuryKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterUserIn = (await getAccount(connection, userKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterUserOut = (await getAccount(connection, userSubAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

    const afterVK = await getAccount(connection, vaultKnite, "confirmed", TOKEN_PROGRAM_ID);
    const afterVS = await getAccount(connection, vaultSub, "confirmed", TOKEN_PROGRAM_ID);

    // Fee routing + user debits/credits
    assert.strictEqual((afterTreasury - beforeTreasury).toString(), fee.toString());
    assert.strictEqual((beforeUserIn - afterUserIn).toString(), amountIn.toString());
    assert.strictEqual((afterUserOut - beforeUserOut).toString(), expectedOut.toString());

    // Reserves updated: vault_knite + netIn, vault_sub - out
    assert.strictEqual((afterVK.amount - reserveK).toString(), netIn.toString());
    assert.strictEqual((reserveS - afterVS.amount).toString(), expectedOut.toString());
  });

  it("swap_exact_in: Sub -> kNite (fee from output vault->treasury), respects min_out, updates reserves", async () => {
    const amountIn = 200_000n;

    const beforeVK = await getAccount(connection, vaultKnite, "confirmed", TOKEN_PROGRAM_ID);
    const beforeVS = await getAccount(connection, vaultSub, "confirmed", TOKEN_PROGRAM_ID);
    const reserveK = beforeVK.amount;
    const reserveS = beforeVS.amount;

    const grossOut = cpOut(amountIn, reserveS, reserveK); // input=sub, output=knite
    const fee = feeCeil(grossOut, 30);
    assert.ok(fee > 0n && grossOut > fee);
    const netOut = grossOut - fee;

    // user needs a sub input ATA and a knite output ATA
    const beforeTreasury = (await getAccount(connection, treasuryKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeUserIn = (await getAccount(connection, userSubAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeUserOut = (await getAccount(connection, userKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

    await program.methods
      .swapExactIn(new anchor.BN(amountIn.toString()), new anchor.BN(netOut.toString()))
      .accounts({
        user: user.publicKey,

        mintIn: mintSub,
        mintOut: mintKnite,

        pair: pairPda,

        userAtaIn: userSubAta,
        userAtaOut: userKniteAta,

        vaultKnite,
        vaultSub,

        treasuryKniteAta,

        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const afterTreasury = (await getAccount(connection, treasuryKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterUserIn = (await getAccount(connection, userSubAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterUserOut = (await getAccount(connection, userKniteAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

    const afterVK = await getAccount(connection, vaultKnite, "confirmed", TOKEN_PROGRAM_ID);
    const afterVS = await getAccount(connection, vaultSub, "confirmed", TOKEN_PROGRAM_ID);

    // user pays input fully, receives netOut; treasury receives fee from vault_knite
    assert.strictEqual((beforeUserIn - afterUserIn).toString(), amountIn.toString());
    assert.strictEqual((afterUserOut - beforeUserOut).toString(), netOut.toString());
    assert.strictEqual((afterTreasury - beforeTreasury).toString(), fee.toString());

    // reserves updated: vault_sub + amountIn, vault_knite - grossOut (fee+netOut)
    assert.strictEqual((afterVS.amount - reserveS).toString(), amountIn.toString());
    assert.strictEqual((reserveK - afterVK.amount).toString(), grossOut.toString());
  });

  it("swap_exact_in: fails slippage if min_out too high", async () => {
    const amountIn = 50_000n;

    // set min_out absurdly high to force slippage failure
    try {
      await program.methods
        .swapExactIn(new anchor.BN(amountIn.toString()), new anchor.BN("18446744073709551615")) // u64::MAX
        .accounts({
          user: user.publicKey,
          mintIn: mintKnite,
          mintOut: mintSub,
          pair: pairPda,
          userAtaIn: userKniteAta,
          userAtaOut: userSubAta,
          vaultKnite,
          vaultSub,
          treasuryKniteAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      assert.fail("Expected SlippageExceeded");
    } catch (e) {
      assert.ok(e.toString().includes("Slippage") || e.toString().includes("custom program error"));
    }
  });

  it("swap_exact_in: rejects token not allowed (not knite<->sub)", async () => {
    // Create a 3rd mint and try to swap with it
    const m3 = await createTestMint(provider, decimals, treasury.publicKey);
    const mintOther = m3.mintPk;

    const userOtherAta = await ensureAta(provider, provider.wallet.publicKey, user.publicKey, mintOther);
    await mintTo(provider, mintOther, userOtherAta, treasury, 1_000_000n);

    try {
      await program.methods
        .swapExactIn(new anchor.BN("1000"), new anchor.BN("1"))
        .accounts({
          user: user.publicKey,
          mintIn: mintOther, // 
          mintOut: mintSub,
          pair: pairPda,
          userAtaIn: userOtherAta,
          userAtaOut: userSubAta,
          vaultKnite,
          vaultSub,
          treasuryKniteAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      assert.fail("Expected TokenNotAllowed");
    } catch (e) {
      assert.ok(e.toString().includes("Token not allowed") || e.toString().includes("custom program error"));
    }
  });

  it("swap_exact_in: rejects wrong treasury knite ATA", async () => {
    // pass user's knite ATA instead of ATA(treasury, knite)
    try {
      await program.methods
        .swapExactIn(new anchor.BN("1000"), new anchor.BN("1"))
        .accounts({
          user: user.publicKey,
          mintIn: mintKnite,
          mintOut: mintSub,
          pair: pairPda,
          userAtaIn: userKniteAta,
          userAtaOut: userSubAta,
          vaultKnite,
          vaultSub,
          treasuryKniteAta: userKniteAta, //  wrong
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      assert.fail("Expected InvalidTreasuryAta");
    } catch (e) {
      assert.ok(e.toString().includes("Treasury ATA") || e.toString().includes("custom program error"));
    }
  });
});
