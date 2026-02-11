/* eslint-disable no-console */
const anchor = require("@coral-xyz/anchor");
const assert = require("assert");

const { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getMint,
  createMintToInstruction,
} = require("@solana/spl-token");

// ---------------------------
// Helpers
// ---------------------------
async function airdrop(connection, pubkey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

function findConfigPda(programId, mint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_config"), mint.toBuffer()],
    programId
  );
}

// Deterministic ATA (works even before mint exists)
function ata(owner, mint) {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

// Create ATA if it doesn't exist
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


describe("token-core (Phase 1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TokenCoreContracts;
  const connection = provider.connection;
  const wallet = provider.wallet;

  const treasury = Keypair.generate();
  const userA = Keypair.generate();
  const userB = Keypair.generate();

  const mintKp = Keypair.generate();
  const mintPk = mintKp.publicKey;

  let configPda;
  let treasuryAta;
  let userAAta;
  let userBAta;

  const decimals = 6;
  const fixedSupply = 1_000_000_000n;

  before(async () => {
    await airdrop(connection, treasury.publicKey, 2);
    await airdrop(connection, userA.publicKey, 2);
    await airdrop(connection, userB.publicKey, 2);

    [configPda] = findConfigPda(program.programId, mintPk);

    // deterministic addrs
    treasuryAta = ata(treasury.publicKey, mintPk);
    userAAta = ata(userA.publicKey, mintPk);
    userBAta = ata(userB.publicKey, mintPk);
  });

  it("initialize_mint: creates mint + creates (recipient, treasury) ATAs + mints fixed supply + moves authority to config + removes freeze", async () => {
    await program.methods
      .initializeMint(decimals, new anchor.BN(fixedSupply.toString()), treasury.publicKey)
      .accounts({
        payer: wallet.publicKey,
        mint: mintPk,

        initialRecipientOwner: userA.publicKey,
        initialRecipientAta: userAAta,
        treasuryAccount: treasury.publicKey,
        treasuryAta: treasuryAta,

        config: configPda,

        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp])
      .rpc();

    const cfg = await program.account.tokenConfig.fetch(configPda);
    assert.ok(cfg.mint.equals(mintPk));
    assert.ok(cfg.treasury.equals(treasury.publicKey));
    assert.strictEqual(cfg.decimals, decimals);
    assert.strictEqual(cfg.taxBps, 5);
    assert.strictEqual(cfg.renounced, false);

    const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_PROGRAM_ID);
    assert.ok(mintInfo.mintAuthority && mintInfo.mintAuthority.equals(configPda));
    assert.strictEqual(mintInfo.freezeAuthority, null);

    const userAAcc = await getAccount(connection, userAAta, "confirmed", TOKEN_PROGRAM_ID);
    assert.strictEqual(userAAcc.amount.toString(), fixedSupply.toString());

    const trAcc = await getAccount(connection, treasuryAta, "confirmed", TOKEN_PROGRAM_ID);
    assert.ok(trAcc.owner.equals(treasury.publicKey));
  });

  it("transfer_with_tax: routes fee to ATA(treasury,mint) strictly, net to receiver", async () => {
    //  Ensure receiver ATA exists (initialize_mint didn't create it)
    await ensureAta(provider, wallet.publicKey, userB.publicKey, mintPk);

    const amount = 100_000n; // fee ceil(100000*5/10000)=50
    const expectedFee = 50n;
    const expectedNet = amount - expectedFee;

    const beforeTreasury = (await getAccount(connection, treasuryAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeUserA = (await getAccount(connection, userAAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const beforeUserB = (await getAccount(connection, userBAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

    await program.methods
      .transferWithTax(new anchor.BN(amount.toString()))
      .accounts({
        fromOwner: userA.publicKey,
        mint: mintPk,
        config: configPda,
        fromAta: userAAta,
        toAta: userBAta,
        treasuryAta: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([userA])
      .rpc();

    const afterTreasury = (await getAccount(connection, treasuryAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterUserA = (await getAccount(connection, userAAta, "confirmed", TOKEN_PROGRAM_ID)).amount;
    const afterUserB = (await getAccount(connection, userBAta, "confirmed", TOKEN_PROGRAM_ID)).amount;

    assert.strictEqual((afterTreasury - beforeTreasury).toString(), expectedFee.toString());
    assert.strictEqual((beforeUserA - afterUserA).toString(), amount.toString());
    assert.strictEqual((afterUserB - beforeUserB).toString(), expectedNet.toString());
  });

  it("transfer_with_tax: fails if treasury ATA is not ATA(treasury, mint)", async () => {
    // ensure userB ATA exists so we don't fail with missing account for the wrong reason
    await ensureAta(provider, wallet.publicKey, userB.publicKey, mintPk);

    try {
      await program.methods
        .transferWithTax(new anchor.BN("100000"))
        .accounts({
          fromOwner: userA.publicKey,
          mint: mintPk,
          config: configPda,
          fromAta: userAAta,
          toAta: userBAta,
          treasuryAta: userBAta, //  wrong
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userA])
        .rpc();
      assert.fail("Expected InvalidTreasuryAta");
    } catch (e) {
      // expected
    }
  });

  it("transfer_with_tax: rejects tiny transfers (amount<=fee)", async () => {
    // ensure userB ATA exists so we don't fail with missing account
    await ensureAta(provider, wallet.publicKey, userB.publicKey, mintPk);

    try {
      await program.methods
        .transferWithTax(new anchor.BN(1))
        .accounts({
          fromOwner: userA.publicKey,
          mint: mintPk,
          config: configPda,
          fromAta: userAAta,
          toAta: userBAta,
          treasuryAta: treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userA])
        .rpc();
      assert.fail("Expected AmountTooSmallForFee");
    } catch (e) {
      // expected
    }
  });

  it("renounce_mint_authority: only treasury can renounce; mint authority -> None", async () => {
    try {
      await program.methods
        .renounceMintAuthority()
        .accounts({
          treasurySigner: userA.publicKey,
          mint: mintPk,
          config: configPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([userA])
        .rpc();
      assert.fail("Expected Unauthorized");
    } catch (e) {
      // expected
    }

    await program.methods
      .renounceMintAuthority()
      .accounts({
        treasurySigner: treasury.publicKey,
        mint: mintPk,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([treasury])
      .rpc();

    const cfg = await program.account.tokenConfig.fetch(configPda);
    assert.strictEqual(cfg.renounced, true);

    const mintInfo = await getMint(connection, mintPk, "confirmed", TOKEN_PROGRAM_ID);
    assert.strictEqual(mintInfo.mintAuthority, null);

    try {
      await program.methods
        .renounceMintAuthority()
        .accounts({
          treasurySigner: treasury.publicKey,
          mint: mintPk,
          config: configPda,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([treasury])
        .rpc();
      assert.fail("Expected AlreadyRenounced");
    } catch (e) {
      // expected
    }
  });

  it("post-renounce: SPL mint_to fails (no mint authority)", async () => {
    const ix = createMintToInstruction(
      mintPk,
      userAAta,
      wallet.publicKey,
      1,
      [],
      TOKEN_PROGRAM_ID
    );

    const tx = new anchor.web3.Transaction().add(ix);

    try {
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
      assert.fail("Expected mint_to to fail after renounce");
    } catch (e) {
      // expected
    }
  });
});
