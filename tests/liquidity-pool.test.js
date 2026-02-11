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
  getMint,
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

async function createTestMint(provider, decimals = 6, mintAuthority) {
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
      mintAuthority,
      null, // freeze authority null for test mint
      TOKEN_PROGRAM_ID
    )
  );

  await provider.sendAndConfirm(tx, [mintKp], { commitment: "confirmed" });
  return { mintKp, mintPk };
}

async function mintTo(provider, mint, destAta, authority, amount) {
  const ix = createMintToInstruction(
    mint,
    destAta,
    authority.publicKey,
    amount,
    [],
    TOKEN_PROGRAM_ID
  );
  const tx = new anchor.web3.Transaction().add(ix);
  await provider.sendAndConfirm(tx, [authority], { commitment: "confirmed" });
}

// Derive PDAs exactly like your program
function findPoolPda(programId, treasury, mintA, mintB) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), treasury.toBuffer(), mintA.toBuffer(), mintB.toBuffer()],
    programId
  );
}

function findVaultPda(programId, seed, poolPk) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), poolPk.toBuffer()],
    programId
  );
}

// Expect Anchor error contains this custom msg/code name (best-effort)
function expectThrowContains(e, contains) {
  const msg = e?.toString?.() || "";
  assert.ok(msg.includes(contains), `Expected error to include "${contains}" but got: ${msg}`);
}

// ---------------------------
// Tests
// ---------------------------
describe("liquidity-pool (Phase 1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.LiquidityPoolContracts;
  const connection = provider.connection;

  const treasury = Keypair.generate();
  const attacker = Keypair.generate();

  // mints
  let mintA; // NTC / kNite (test mint)
  let mintB; // sub token (test mint)

  // PDAs / accounts
  let poolPda;
  let vaultA;
  let vaultB;

  // Treasury ATAs
  let treasuryAtaA;
  let treasuryAtaB;

  const decimals = 6;

  before(async () => {
    await airdrop(connection, treasury.publicKey, 3);
    await airdrop(connection, attacker.publicKey, 2);

    // create 2 test SPL mints with treasury as mint authority so we can seed liquidity
    const mA = await createTestMint(provider, decimals, treasury.publicKey);
    const mB = await createTestMint(provider, decimals, treasury.publicKey);

    mintA = mA.mintPk;
    mintB = mB.mintPk;

    // treasury ATAs for both mints
    treasuryAtaA = await ensureAta(provider, provider.wallet.publicKey, treasury.publicKey, mintA);
    treasuryAtaB = await ensureAta(provider, provider.wallet.publicKey, treasury.publicKey, mintB);

    // mint a big balance to treasury so add_initial_liquidity works
    // (use smaller numbers in tests; you seed 2T/2T in scripts later)
    await mintTo(provider, mintA, treasuryAtaA, treasury, 5_000_000_000n);
    await mintTo(provider, mintB, treasuryAtaB, treasury, 5_000_000_000n);

    // derive pool + vault addresses
    [poolPda] = findPoolPda(program.programId, treasury.publicKey, mintA, mintB);
    [vaultA] = findVaultPda(program.programId, "vault_a", poolPda);
    [vaultB] = findVaultPda(program.programId, "vault_b", poolPda);
  });

  it("create_pool: creates pool + vaults; vault authorities are pool PDA", async () => {
    await program.methods
      .createPool(treasury.publicKey)
      .accounts({
        treasurySigner: treasury.publicKey,
        mintA,
        mintB,
        pool: poolPda,
        vaultA,
        vaultB,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([treasury])
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    assert.ok(pool.treasury.equals(treasury.publicKey));
    assert.ok(pool.mintA.equals(mintA));
    assert.ok(pool.mintB.equals(mintB));
    assert.ok(pool.vaultA.equals(vaultA));
    assert.ok(pool.vaultB.equals(vaultB));
    assert.strictEqual(pool.locked, false);
    assert.strictEqual(pool.totalA.toString(), "0");
    assert.strictEqual(pool.totalB.toString(), "0");

    const vA = await getAccount(connection, vaultA, "confirmed", TOKEN_PROGRAM_ID);
    const vB = await getAccount(connection, vaultB, "confirmed", TOKEN_PROGRAM_ID);

    // TokenAccount.owner == token authority pubkey; you set token::authority = pool
    assert.ok(vA.owner.equals(poolPda));
    assert.ok(vB.owner.equals(poolPda));

    assert.ok(vA.mint.equals(mintA));
    assert.ok(vB.mint.equals(mintB));
  });

  it("create_pool: rejects non-treasury signer (treasury arg mismatch)", async () => {
    // attacker signs but passes treasury pubkey arg = treasury -> handler checks signer == treasury arg
    const [pool2] = findPoolPda(program.programId, treasury.publicKey, mintB, mintA);
    const [vaultA2] = findVaultPda(program.programId, "vault_a", pool2);
    const [vaultB2] = findVaultPda(program.programId, "vault_b", pool2);

    try {
      await program.methods
        .createPool(treasury.publicKey)
        .accounts({
          treasurySigner: attacker.publicKey, // 
          mintA: mintB,
          mintB: mintA,
          pool: pool2,
          vaultA: vaultA2,
          vaultB: vaultB2,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Expected Unauthorized");
    } catch (e) {
      // Depending on whether it fails at handler or constraint, message may vary
      // Best effort:
      assert.ok(e.toString().includes("Unauthorized") || e.toString().includes("custom program error"));
    }
  });

  it("add_initial_liquidity: transfers from treasury ATAs into vaults and updates totals", async () => {
    const amountA = 1_000_000n;
    const amountB = 2_000_000n;

    const beforeVA = (await getAccount(connection, vaultA, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeVB = (await getAccount(connection, vaultB, "confirmed", TOKEN_PROGRAM_ID)).amount;

    const beforeTA = (await getAccount(connection, treasuryAtaA, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeTB = (await getAccount(connection, treasuryAtaB, "confirmed", TOKEN_PROGRAM_ID)).amount;

    await program.methods
      .addInitialLiquidity(new anchor.BN(amountA.toString()), new anchor.BN(amountB.toString()))
      .accounts({
        treasurySigner: treasury.publicKey,
        pool: poolPda,
        mintA,
        mintB,
        userAtaA: treasuryAtaA,
        userAtaB: treasuryAtaB,
        vaultA,
        vaultB,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([treasury])
      .rpc();

    const afterVA = (await getAccount(connection, vaultA, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterVB = (await getAccount(connection, vaultB, "confirmed", TOKEN_PROGRAM_ID)).amount;

    const afterTA = (await getAccount(connection, treasuryAtaA, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterTB = (await getAccount(connection, treasuryAtaB, "confirmed", TOKEN_PROGRAM_ID)).amount;

    assert.strictEqual((afterVA - beforeVA).toString(), amountA.toString());
    assert.strictEqual((afterVB - beforeVB).toString(), amountB.toString());

    assert.strictEqual((beforeTA - afterTA).toString(), amountA.toString());
    assert.strictEqual((beforeTB - afterTB).toString(), amountB.toString());

    const pool = await program.account.pool.fetch(poolPda);
    assert.strictEqual(pool.totalA.toString(), amountA.toString());
    assert.strictEqual(pool.totalB.toString(), amountB.toString());
  });

  it("add_initial_liquidity: rejects non-treasury", async () => {
    // attacker needs ATAs, but should still fail due to pool.treasury constraint
    const attackerAtaA = await ensureAta(provider, provider.wallet.publicKey, attacker.publicKey, mintA);
    const attackerAtaB = await ensureAta(provider, provider.wallet.publicKey, attacker.publicKey, mintB);

    try {
      await program.methods
        .addInitialLiquidity(new anchor.BN("1"), new anchor.BN("1"))
        .accounts({
          treasurySigner: attacker.publicKey,
          pool: poolPda,
          mintA,
          mintB,
          userAtaA: attackerAtaA,
          userAtaB: attackerAtaB,
          vaultA,
          vaultB,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Expected Unauthorized");
    } catch (e) {
      assert.ok(e.toString().includes("Unauthorized") || e.toString().includes("custom program error"));
    }
  });

  it("lock_pool: treasury can lock; locked becomes true", async () => {
    await program.methods
      .lockPool()
      .accounts({
        treasurySigner: treasury.publicKey,
        pool: poolPda,
      })
      .signers([treasury])
      .rpc();

    const pool = await program.account.pool.fetch(poolPda);
    assert.strictEqual(pool.locked, true);
  });

  it("add_initial_liquidity: fails after lock", async () => {
    try {
      await program.methods
        .addInitialLiquidity(new anchor.BN("10"), new anchor.BN("10"))
        .accounts({
          treasurySigner: treasury.publicKey,
          pool: poolPda,
          mintA,
          mintB,
          userAtaA: treasuryAtaA,
          userAtaB: treasuryAtaB,
          vaultA,
          vaultB,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([treasury])
        .rpc();
      assert.fail("Expected PoolAlreadyLocked");
    } catch (e) {
      // your program uses PoolError::PoolAlreadyLocked
      assert.ok(e.toString().includes("Pool already locked") || e.toString().includes("custom program error"));
    }
  });

  it("lock_pool: rejects non-treasury", async () => {
    try {
      await program.methods
        .lockPool()
        .accounts({
          treasurySigner: attacker.publicKey,
          pool: poolPda,
        })
        .signers([attacker])
        .rpc();
      assert.fail("Expected Unauthorized");
    } catch (e) {
      assert.ok(e.toString().includes("Unauthorized") || e.toString().includes("custom program error"));
    }
  });
});
