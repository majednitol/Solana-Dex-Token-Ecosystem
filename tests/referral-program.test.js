/* eslint-disable no-console */
const anchor = require("@coral-xyz/anchor");
const assert = require("assert");

const { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

async function airdrop(connection, pubkey, sol = 2) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

function findConfigPda(programId) {
  return PublicKey.findProgramAddressSync([Buffer.from("referral_config")], programId);
}

function findMarkerPda(programId, userPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("referral_marker"), userPubkey.toBuffer()],
    programId
  );
}

// Anchor error helper (works across versions)
function expectAnchorError(e, containsAny = []) {
  const msg = (e?.error?.errorMessage || e?.message || e?.toString() || "").toLowerCase();
  if (!containsAny.length) return;
  const ok = containsAny.some((s) => msg.includes(String(s).toLowerCase()));
  assert.ok(ok, `Expected error to include one of: ${containsAny.join(", ")}. Got: ${msg}`);
}

// ---------------------------
// Tests
// ---------------------------
describe("referral-program (Phase 1)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ReferralProgramContracts;
  const connection = provider.connection;

  // Actors
  const payer = provider.wallet; // default test wallet
  const treasury = Keypair.generate();
  const user = Keypair.generate();
  const referrer = Keypair.generate();

  // "dex-core" program id used for authorization
  // In production this will be your deployed dex-core program id.
  // In tests we just use a random Keypair pubkey and mark it as "executable" by pointing to SystemProgram
  // is NOT possible, so we test the *treasury signer* auth path + mismatch path.
  const allowedDexProgram = Keypair.generate().publicKey;
  const wrongDexProgram = Keypair.generate().publicKey;

  let configPda;

  before(async () => {
    await airdrop(connection, treasury.publicKey, 2);
    await airdrop(connection, user.publicKey, 2);
    await airdrop(connection, referrer.publicKey, 2);

    [configPda] = findConfigPda(program.programId);
  });

  it("initialize_config: creates config PDA and stores allowed_dex_program + treasury", async () => {
    await program.methods
      .initializeConfig(allowedDexProgram, treasury.publicKey)
      .accounts({
        payer: payer.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cfg = await program.account.referralConfig.fetch(configPda);
    assert.strictEqual(cfg.initialized, true);
    assert.ok(cfg.allowedDexProgram.equals(allowedDexProgram));
    assert.ok(cfg.treasury.equals(treasury.publicKey));
    assert.strictEqual(cfg.bump >= 0 && cfg.bump <= 255, true);
  });

it("initialize_config: rejects re-initialize (AlreadyInitialized)", async () => {
  try {
    await program.methods
      .initializeConfig(allowedDexProgram, treasury.publicKey)
      .accounts({
        payer: payer.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    assert.fail("Expected re-init to fail");
  } catch (e) {
    // With #[account(init)] the failure happens during account allocation,
    // before your handler can return AlreadyInitialized.
    expectAnchorError(e, [
      "already in use",
      "already initialized",
      "custom program error: 0x0",
      "simulation failed",
    ]);
  }
});


  it("record_first_swap: rejects self-referral", async () => {
    const [markerPda] = findMarkerPda(program.programId, user.publicKey);

    try {
      await program.methods
        .recordFirstSwap(user.publicKey, Keypair.generate().publicKey)
        .accounts({
          user: user.publicKey,
          referee: markerPda,
          payer: payer.publicKey,
          dexProgram: wrongDexProgram, // not used because we fail earlier
          treasurySigner: null,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Expected SelfReferralNotAllowed");
    } catch (e) {
      expectAnchorError(e, ["cannot refer yourself", "selfreferral"]);
    }
  });

  it("record_first_swap: rejects unauthorized when dex_program mismatch and no treasury signer", async () => {
    const [markerPda] = findMarkerPda(program.programId, user.publicKey);

    try {
      await program.methods
        .recordFirstSwap(referrer.publicKey, Keypair.generate().publicKey)
        .accounts({
          user: user.publicKey,
          referee: markerPda,
          payer: payer.publicKey,
          dexProgram: wrongDexProgram, //  mismatch to config.allowedDexProgram
          treasurySigner: null, // no treasury signer path
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([]) // user is UncheckedAccount; payer signs via provider wallet
        .rpc();
      assert.fail("Expected Unauthorized");
    } catch (e) {
      expectAnchorError(e, ["unauthorized"]);
    }
  });

  it("record_first_swap: succeeds via treasury signer override (production-safe emergency/admin path)", async () => {
    const [markerPda] = findMarkerPda(program.programId, user.publicKey);
    const pair = Keypair.generate().publicKey;


    await program.methods
      .recordFirstSwap(referrer.publicKey, pair)
      .accounts({
        user: user.publicKey,
        referee: markerPda,
        payer: payer.publicKey,
        dexProgram: wrongDexProgram, // can be anything because treasury_ok is true
        treasurySigner: treasury.publicKey, // optional signer present
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([treasury])
      .rpc();

    const st = await program.account.refereeState.fetch(markerPda);
    assert.ok(st.user.equals(user.publicKey));
    assert.ok(st.referrer.equals(referrer.publicKey));
    assert.ok(st.pair.equals(pair));
    assert.ok(Number(st.recordedAt) !== 0);
    assert.strictEqual(st.bump >= 0 && st.bump <= 255, true);
  });

  it("record_first_swap: rejects double-claim (marker PDA already exists)", async () => {
    const [markerPda] = findMarkerPda(program.programId, user.publicKey);
    const pair2 = Keypair.generate().publicKey;

    try {
      await program.methods
        .recordFirstSwap(referrer.publicKey, pair2)
        .accounts({
          user: user.publicKey,
          referee: markerPda, // same marker => init should fail
          payer: payer.publicKey,
          dexProgram: wrongDexProgram,
          treasurySigner: treasury.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([treasury])
        .rpc();
      assert.fail("Expected init failure (already in use)");
    } catch (e) {
      //  "Account already in use" / "already initialized"
      expectAnchorError(e, ["already in use", "already initialized", "alreadyinitialized"]);
    }
  });

  it("record_first_swap: rejects invalid referrer (Pubkey::default)", async () => {
    const user2 = Keypair.generate();
    await airdrop(connection, user2.publicKey, 1);

    const [marker2] = findMarkerPda(program.programId, user2.publicKey);
    const pair = Keypair.generate().publicKey;

    try {
      await program.methods
        .recordFirstSwap(PublicKey.default, pair)
        .accounts({
          user: user2.publicKey,
          referee: marker2,
          payer: payer.publicKey,
          dexProgram: wrongDexProgram,
          treasurySigner: treasury.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([treasury])
        .rpc();
      assert.fail("Expected InvalidReferrer");
    } catch (e) {
      expectAnchorError(e, ["invalid referrer", "invalidreferrer"]);
    }
  });
});
