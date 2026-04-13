/**
 * Protoperps integration tests — Phase 2
 *
 * Uses anchor-bankrun (in-memory SVM, no live validator needed).
 *
 * Wallets: `trader` (maker/long), `liquidator` (taker/short), `trader2` (test 15 victim).
 *
 * Precision constants:
 *   PRICE_PRECISION = LOT_PRECISION = USDC_PRECISION = 1_000_000
 *   BPS_PRECISION  = 10_000
 *   FUNDING_PRECISION = 1_000_000_000
 *
 * Market:
 *   initial_margin_ratio   = 2000 bps  (20%)
 *   maintenance_margin_ratio = 1000 bps (10%)
 *   liquidation_reward_bps = 500 bps   (5%)
 *   funding_interval       = 1 s       (1s for testability)
 *
 * Oracle:
 *   initial_price = $100 (100_000_000)
 *   Drops before test 12: $100 → $90 → $81 → $72.9
 *   Restored in test 14: $72.9 → $80.19 via update_price
 *
 * Tests 14–16 (Phase 2 additions):
 *   14. oracle Paused → place_order rejected with OracleNotActive
 *   15. oracle ReduceOnly → liquidation succeeds (allows it)
 *   16. update_funding computes correct cumulative rate
 */

import * as anchor from "@coral-xyz/anchor";
import { AnchorError, BN, Program } from "@coral-xyz/anchor";
import { startAnchor, BankrunProvider } from "anchor-bankrun";
import { Clock } from "solana-bankrun";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
} from "@solana/spl-token";
import { assert } from "chai";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require("../target/idl/protoperps.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const oracleIdl = require("../target/idl/oracle.json");

// ── Program IDs ──────────────────────────────────────────────────────────────

const ORACLE_PROGRAM_ID = new PublicKey(
  "Av4fWEvzFmn1NatYWbQw5HnWKesUfsnKDqwkhau4v7KQ"
);

// ── Precision helpers ────────────────────────────────────────────────────────

const P = new BN(1_000_000); // PRICE_PRECISION = LOT_PRECISION = USDC_PRECISION
const BPS = new BN(10_000); // BPS_PRECISION

function usd(dollars: number): BN {
  return new BN(dollars).mul(P);
}
function lot(lots: number): BN {
  return new BN(lots).mul(P);
}

// ── Shared state ─────────────────────────────────────────────────────────────

let context: Awaited<ReturnType<typeof startAnchor>>;
let provider: BankrunProvider;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let program: Program<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let oracleProgram: Program<any>;

let trader: Keypair;
let liquidator: Keypair;
let trader2: Keypair;
let mintAuthority: Keypair;
let usdcMintKp: Keypair;

let usdcMint: PublicKey;
let marketPda: PublicKey;
let traderMarginPda: PublicKey;
let liquidatorMarginPda: PublicKey;
let trader2MarginPda: PublicKey;
let vaultAuthorityPda: PublicKey;
let vaultPda: PublicKey;
let traderUsdcAta: PublicKey;
let liquidatorUsdcAta: PublicKey;
let trader2UsdcAta: PublicKey;
let traderPositionPda: PublicKey;
let liquidatorPositionPda: PublicKey;
let trader2PositionPda: PublicKey;
let oraclePda: PublicKey;

// ── Market params ─────────────────────────────────────────────────────────────

const BASE_SYMBOL_STR = "SPACEX";
const baseSymbolBuf = (() => {
  const b = Buffer.alloc(16);
  b.write(BASE_SYMBOL_STR, "ascii");
  return b;
})();

const MARKET_PARAMS = {
  baseSymbol: Array.from(baseSymbolBuf),
  oracle: PublicKey.default,
  tickSize: new BN(1_000),
  lotSize: new BN(1_000),
  maxLeverage: new BN(5),
  initialMarginRatio: new BN(2_000),
  maintenanceMarginRatio: new BN(1_000),
  liquidationRewardBps: new BN(500),
  takerFeeBps: new BN(10),
  makerFeeBps: new BN(5),
  // 1 second interval for testability; production would use 3600.
  fundingInterval: new BN(1),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

before(async () => {
  trader = Keypair.generate();
  liquidator = Keypair.generate();
  trader2 = Keypair.generate();
  mintAuthority = Keypair.generate();
  usdcMintKp = Keypair.generate();

  context = await startAnchor(
    ".",
    [{ name: "oracle", programId: ORACLE_PROGRAM_ID }],
    [
      {
        address: trader.publicKey,
        info: {
          lamports: 100 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        },
      },
      {
        address: liquidator.publicKey,
        info: {
          lamports: 100 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        },
      },
      {
        address: trader2.publicKey,
        info: {
          lamports: 100 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        },
      },
      {
        address: mintAuthority.publicKey,
        info: {
          lamports: 100 * LAMPORTS_PER_SOL,
          data: Buffer.alloc(0),
          owner: SystemProgram.programId,
          executable: false,
        },
      },
    ]
  );

  provider = new BankrunProvider(context);
  anchor.setProvider(provider);
  program = new Program(idl, provider);
  oracleProgram = new Program(oracleIdl, provider);

  // ── Derive PDAs ────────────────────────────────────────────────────────────
  [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), baseSymbolBuf],
    program.programId
  );
  [traderMarginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), trader.publicKey.toBuffer()],
    program.programId
  );
  [liquidatorMarginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), liquidator.publicKey.toBuffer()],
    program.programId
  );
  [trader2MarginPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), trader2.publicKey.toBuffer()],
    program.programId
  );
  [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  [traderPositionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      marketPda.toBuffer(),
      trader.publicKey.toBuffer(),
    ],
    program.programId
  );
  [liquidatorPositionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      marketPda.toBuffer(),
      liquidator.publicKey.toBuffer(),
    ],
    program.programId
  );
  [trader2PositionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      marketPda.toBuffer(),
      trader2.publicKey.toBuffer(),
    ],
    program.programId
  );
  [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), marketPda.toBuffer()],
    ORACLE_PROGRAM_ID
  );

  usdcMint = usdcMintKp.publicKey;
  traderUsdcAta = getAssociatedTokenAddressSync(usdcMint, trader.publicKey);
  liquidatorUsdcAta = getAssociatedTokenAddressSync(
    usdcMint,
    liquidator.publicKey
  );
  trader2UsdcAta = getAssociatedTokenAddressSync(usdcMint, trader2.publicKey);
  vaultPda = getAssociatedTokenAddressSync(usdcMint, vaultAuthorityPda, true);

  // ── Create USDC mint ───────────────────────────────────────────────────────
  const mintRent = await provider.connection.getMinimumBalanceForRentExemption(
    MINT_SIZE
  );
  const mintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: mintAuthority.publicKey,
      newAccountPubkey: usdcMint,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      usdcMint,
      6,
      mintAuthority.publicKey,
      null
    )
  );
  mintTx.recentBlockhash = context.lastBlockhash;
  mintTx.feePayer = mintAuthority.publicKey;
  mintTx.sign(mintAuthority, usdcMintKp);
  await context.banksClient.processTransaction(mintTx);

  // ── Create ATAs + mint USDC to all wallets ─────────────────────────────────
  const fundTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      mintAuthority.publicKey,
      traderUsdcAta,
      trader.publicKey,
      usdcMint
    ),
    createAssociatedTokenAccountInstruction(
      mintAuthority.publicKey,
      liquidatorUsdcAta,
      liquidator.publicKey,
      usdcMint
    ),
    createAssociatedTokenAccountInstruction(
      mintAuthority.publicKey,
      trader2UsdcAta,
      trader2.publicKey,
      usdcMint
    ),
    createMintToInstruction(
      usdcMint,
      traderUsdcAta,
      mintAuthority.publicKey,
      BigInt(usd(2000).toString())
    ),
    createMintToInstruction(
      usdcMint,
      liquidatorUsdcAta,
      mintAuthority.publicKey,
      BigInt(usd(2000).toString())
    ),
    createMintToInstruction(
      usdcMint,
      trader2UsdcAta,
      mintAuthority.publicKey,
      BigInt(usd(500).toString())
    )
  );
  fundTx.recentBlockhash = context.lastBlockhash;
  fundTx.feePayer = mintAuthority.publicKey;
  fundTx.sign(mintAuthority);
  await context.banksClient.processTransaction(fundTx);

  // ── Initialize market ──────────────────────────────────────────────────────
  await program.methods
    .initializeMarket(MARKET_PARAMS)
    .accounts({
      authority: trader.publicKey,
      market: marketPda,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([trader])
    .rpc();

  // ── Initialize oracle feed ($100 initial price, trader is the keeper) ──────
  await oracleProgram.methods
    .initializeFeed({
      initialPrice: usd(100),
      confidence: usd(1),
      source: 0,
    })
    .accounts({
      authority: trader.publicKey,
      market: marketPda,
      oracle: oraclePda,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([trader])
    .rpc();

  // ── Liquidator pre-deposits $500 (sets up their margin account) ────────────
  await program.methods
    .depositCollateral(usd(500))
    .accounts({
      owner: liquidator.publicKey,
      marginAccount: liquidatorMarginPda,
      userUsdc: liquidatorUsdcAta,
      vaultAuthority: vaultAuthorityPda,
      vault: vaultPda,
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .signers([liquidator])
    .rpc();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("protoperps", () => {
  // ── 1. initialize_market: valid params ───────────────────────────────────

  it("1. initialize_market stores all params correctly", async () => {
    const market = await program.account.market.fetch(marketPda);

    assert.strictEqual(market.status, 0, "status = Active (0)");
    assert.ok(market.authority.equals(trader.publicKey));
    assert.strictEqual(
      market.tickSize.toNumber(),
      MARKET_PARAMS.tickSize.toNumber()
    );
    assert.strictEqual(
      market.initialMarginRatio.toNumber(),
      MARKET_PARAMS.initialMarginRatio.toNumber()
    );
    assert.strictEqual(
      market.maintenanceMarginRatio.toNumber(),
      MARKET_PARAMS.maintenanceMarginRatio.toNumber()
    );
    assert.strictEqual(
      market.liquidationRewardBps.toNumber(),
      MARKET_PARAMS.liquidationRewardBps.toNumber()
    );
    assert.strictEqual(market.numBids, 0);
    assert.strictEqual(market.numAsks, 0);
  });

  // ── 2. initialize_market: invalid tick size ─────────────────────────────

  it("2. initialize_market rejects zero tick_size", async () => {
    const altBuf = Buffer.alloc(16);
    altBuf.write("BADMKT", "ascii");
    const [altMarketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), altBuf],
      program.programId
    );

    try {
      await program.methods
        .initializeMarket({ ...MARKET_PARAMS, tickSize: new BN(0), baseSymbol: Array.from(altBuf) })
        .accounts({
          authority: trader.publicKey,
          market: altMarketPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([trader])
        .rpc();
      assert.fail("Expected InvalidTickSize");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      assert.strictEqual(
        (err as AnchorError).error.errorCode.code,
        "InvalidTickSize"
      );
    }
  });

  // ── 3. deposit_collateral: first deposit ────────────────────────────────

  it("3. deposit_collateral creates margin account and records balance", async () => {
    await program.methods
      .depositCollateral(usd(1000))
      .accounts({
        owner: trader.publicKey,
        marginAccount: traderMarginPda,
        userUsdc: traderUsdcAta,
        vaultAuthority: vaultAuthorityPda,
        vault: vaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([trader])
      .rpc();

    const margin = await program.account.marginAccount.fetch(traderMarginPda);
    assert.ok(margin.usdcDeposited.eq(usd(1000)), "deposited = $1000");
    assert.ok(margin.usdcLocked.isZero(), "nothing locked yet");
    assert.ok(margin.owner.equals(trader.publicKey));
  });

  // ── 4. deposit_collateral: second deposit accumulates ─────────────────

  it("4. deposit_collateral accumulates across multiple deposits", async () => {
    await program.methods
      .depositCollateral(usd(500))
      .accounts({
        owner: trader.publicKey,
        marginAccount: traderMarginPda,
        userUsdc: traderUsdcAta,
        vaultAuthority: vaultAuthorityPda,
        vault: vaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([trader])
      .rpc();

    const margin = await program.account.marginAccount.fetch(traderMarginPda);
    assert.ok(margin.usdcDeposited.eq(usd(1500)), "total = $1500");
  });

  // ── 5. withdraw_collateral: partial withdrawal ──────────────────────────

  it("5. withdraw_collateral decreases deposited balance", async () => {
    await program.methods
      .withdrawCollateral(usd(500))
      .accounts({
        owner: trader.publicKey,
        marginAccount: traderMarginPda,
        userUsdc: traderUsdcAta,
        vaultAuthority: vaultAuthorityPda,
        vault: vaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([trader])
      .rpc();

    const margin = await program.account.marginAccount.fetch(traderMarginPda);
    assert.ok(margin.usdcDeposited.eq(usd(1000)), "balance = $1000 after withdrawal");
  });

  // ── 6. withdraw_collateral: over free collateral ───────────────────────

  it("6. withdraw_collateral rejects withdrawal exceeding free collateral", async () => {
    try {
      await program.methods
        .withdrawCollateral(usd(2000))
        .accounts({
          owner: trader.publicKey,
          marginAccount: traderMarginPda,
          userUsdc: traderUsdcAta,
          vaultAuthority: vaultAuthorityPda,
          vault: vaultPda,
          usdcMint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([trader])
        .rpc();
      assert.fail("Expected InsufficientFreeCollateral");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      assert.strictEqual(
        (err as AnchorError).error.errorCode.code,
        "InsufficientFreeCollateral"
      );
    }
  });

  // ── 7. place_order: limit bid rests on book ─────────────────────────────
  //
  // Trader places limit buy at $100, size 1 lot.
  // No counterpart → order rests; book goes from 0 to 1 bid.

  it("7. place_order (limit buy) rests on the book with no fill", async () => {
    await program.methods
      .placeOrder({
        side: { long: {} },
        orderType: { limit: {} },
        price: usd(100),
        size: lot(1),
      })
      .accounts({
        taker: trader.publicKey,
        market: marketPda,
        takerPosition: traderPositionPda,
        takerMargin: traderMarginPda,
        oracleFeed: oraclePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([trader])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    assert.strictEqual(market.numBids, 1, "one resting bid");
    assert.strictEqual(market.numAsks, 0, "no asks");
    assert.ok(
      new BN(market.bids[0].price.toString()).eq(usd(100)),
      "bid price = $100"
    );
    // Trader's margin should now have locked collateral.
    // margin = $100 * 1 lot * 20% = $20
    const margin = await program.account.marginAccount.fetch(traderMarginPda);
    assert.ok(margin.usdcLocked.eq(usd(20)), "locked = $20 for resting bid");
  });

  // ── 8. place_order: crossing sell fills the resting bid ────────────────
  //
  // Liquidator places limit sell at $90 (< $100 bid).
  // Crosses trader's bid → fill at $100; both positions open.

  it("8. place_order (crossing sell) fills atomically, both positions open", async () => {
    // Trader's position PDA is passed as a remaining account (maker).
    await program.methods
      .placeOrder({
        side: { short: {} },
        orderType: { limit: {} },
        price: usd(90), // below the $100 bid → crosses
        size: lot(1),
      })
      .accounts({
        taker: liquidator.publicKey,
        market: marketPda,
        takerPosition: liquidatorPositionPda,
        takerMargin: liquidatorMarginPda,
        oracleFeed: oraclePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: traderPositionPda, isWritable: true, isSigner: false },
      ])
      .signers([liquidator])
      .rpc();

    // Book should be empty (bid consumed, ask fully filled).
    const market = await program.account.market.fetch(marketPda);
    assert.strictEqual(market.numBids, 0, "bid consumed");
    assert.strictEqual(market.numAsks, 0, "ask fully matched");

    // Trader (maker): long at $100.
    const traderPos = await program.account.position.fetch(traderPositionPda);
    assert.ok(traderPos.size.eq(lot(1)), "trader size = 1 lot");
    assert.ok(traderPos.entryPrice.eq(usd(100)), "trader entry = $100");
    assert.deepEqual(traderPos.side, { long: {} });
    // Phase 2: verify collateral was set for the maker fill.
    assert.ok(traderPos.collateral.eq(usd(20)), "trader collateral = $20");

    // Liquidator (taker): short at $100.
    const liqPos = await program.account.position.fetch(liquidatorPositionPda);
    assert.ok(liqPos.size.eq(lot(1)), "liquidator size = 1 lot");
    assert.ok(liqPos.entryPrice.eq(usd(100)), "liquidator entry = $100");
    assert.deepEqual(liqPos.side, { short: {} });
    assert.ok(liqPos.collateral.eq(usd(20)), "liquidator collateral = $20");
  });

  // ── 9. place_order: insufficient margin ─────────────────────────────────
  //
  // Trader tries to buy 100 lots @ $100.
  // Required margin = $100 × 100 × 20% = $2000 > free collateral.

  it("9. place_order rejects order with insufficient margin", async () => {
    try {
      await program.methods
        .placeOrder({
          side: { long: {} },
          orderType: { limit: {} },
          price: usd(100),
          size: lot(100),
        })
        .accounts({
          taker: trader.publicKey,
          market: marketPda,
          takerPosition: traderPositionPda,
          takerMargin: traderMarginPda,
          oracleFeed: oraclePda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([trader])
        .rpc();
      assert.fail("Expected InsufficientMargin");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      assert.strictEqual(
        (err as AnchorError).error.errorCode.code,
        "InsufficientMargin"
      );
    }
  });

  // ── 10. cancel_order: owner cancels resting order ───────────────────────
  //
  // Place two new resting bids (@ $80, @ $70) for tests 10 & 11,
  // then cancel the $80 one (seq=1 — the second order on the market).

  it("10. cancel_order removes order from book and unlocks margin", async () => {
    // Place resting bid @ $80 (seq=1 — market seq was 1 after test 7's bid).
    await program.methods
      .placeOrder({
        side: { long: {} },
        orderType: { limit: {} },
        price: usd(80),
        size: lot(1),
      })
      .accounts({
        taker: trader.publicKey,
        market: marketPda,
        takerPosition: traderPositionPda,
        takerMargin: traderMarginPda,
        oracleFeed: oraclePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([trader])
      .rpc();

    // Place resting bid @ $70 (seq=2 — used in test 11).
    await program.methods
      .placeOrder({
        side: { long: {} },
        orderType: { limit: {} },
        price: usd(70),
        size: lot(1),
      })
      .accounts({
        taker: trader.publicKey,
        market: marketPda,
        takerPosition: traderPositionPda,
        takerMargin: traderMarginPda,
        oracleFeed: oraclePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([trader])
      .rpc();

    const marketBefore = await program.account.market.fetch(marketPda);
    const numBidsBefore = marketBefore.numBids as number;
    const marginBefore = await program.account.marginAccount.fetch(
      traderMarginPda
    );

    // Cancel the $80 bid (sequence number 1).
    await program.methods
      .cancelOrder({ side: { long: {} }, sequenceNumber: new BN(1) })
      .accounts({
        trader: trader.publicKey,
        market: marketPda,
        traderMargin: traderMarginPda,
      } as any)
      .signers([trader])
      .rpc();

    const marketAfter = await program.account.market.fetch(marketPda);
    assert.strictEqual(
      marketAfter.numBids,
      numBidsBefore - 1,
      "one bid removed"
    );

    const marginAfter = await program.account.marginAccount.fetch(
      traderMarginPda
    );
    // Cancelled order: price=$80, size=1 lot, initial_margin=20%
    // margin released = 80 * 1_000_000 * 1_000_000 / 1_000_000 * 2000 / 10_000 = 16_000_000 = $16
    const expectedRelease = usd(80)
      .mul(lot(1))
      .div(P)
      .muln(2000)
      .divn(10_000);
    const released = marginBefore.usdcLocked.sub(marginAfter.usdcLocked);
    assert.ok(released.eq(expectedRelease), `released $${released.div(P)} (expected $16)`);
  });

  // ── 11. cancel_order: wrong owner rejected ─────────────────────────────
  //
  // Liquidator tries to cancel trader's $70 bid (seq=2) — should fail.

  it("11. cancel_order rejects cancellation by non-owner", async () => {
    try {
      await program.methods
        .cancelOrder({ side: { long: {} }, sequenceNumber: new BN(2) })
        .accounts({
          trader: liquidator.publicKey,
          market: marketPda,
          traderMargin: liquidatorMarginPda,
        } as any)
        .signers([liquidator])
        .rpc();
      assert.fail("Expected OrderOwnerMismatch");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      assert.strictEqual(
        (err as AnchorError).error.errorCode.code,
        "OrderOwnerMismatch"
      );
    }
  });

  // ── 12. liquidate: undercollateralized position ──────────────────────────
  //
  // The deviation guard checks against `previous_price`, which is set to the
  // price BEFORE the most recent update.  To avoid tripping the 10% guard on
  // back-to-back drops we include two "reset" updates at the same price that
  // advance previous_price to the current level before stepping lower.
  //
  // Drop sequence (5 updates):
  //   1. $100M → $90M  (prev=$100M, diff=10M → exactly 10%, passes)
  //   2. $90M → $90M   (prev=$100M → after: prev=$90M, price stays $90M)
  //   3. $90M → $81M   (prev=$90M, diff=9M → exactly 10%, passes)
  //   4. $81M → $81M   (prev=$90M → after: prev=$81M, price stays $81M)
  //   5. $81M → $72.9M (prev=$81M, diff=8.1M → exactly 10%, passes)
  //
  // At oracle $72.9M: collateral=$20M, upnl=−$27.1M, equity=−$7.1M → bankrupt → no reward.

  it("12. liquidate closes undercollateralized long, updates both accounts", async () => {
    // 5-step oracle drop to $72.9M with reset steps to satisfy the deviation guard.
    // Reset steps use confidence=usd(2) so the transaction data differs from the
    // preceding price-change step — bankrun reuses blockhashes between consecutive
    // rpc() calls, which would otherwise reject identical transactions as duplicates.
    const priceSteps = [
      { price: new BN(90_000_000), confidence: usd(1) },
      { price: new BN(90_000_000), confidence: usd(2) }, // reset: prev → $90M
      { price: new BN(81_000_000), confidence: usd(1) },
      { price: new BN(81_000_000), confidence: usd(2) }, // reset: prev → $81M
      { price: new BN(72_900_000), confidence: usd(1) },
    ];
    for (const { price, confidence } of priceSteps) {
      await oracleProgram.methods
        .updatePrice({ price, confidence, source: 0 })
        .accounts({
          authority: trader.publicKey,
          market: marketPda,
          oracle: oraclePda,
        } as any)
        .signers([trader])
        .rpc();
    }

    const traderMarginBefore = await program.account.marginAccount.fetch(
      traderMarginPda
    );
    const liqMarginBefore = await program.account.marginAccount.fetch(
      liquidatorMarginPda
    );

    await program.methods
      .liquidate()
      .accounts({
        liquidator: liquidator.publicKey,
        market: marketPda,
        position: traderPositionPda,
        traderMargin: traderMarginPda,
        liquidatorMargin: liquidatorMarginPda,
        oracleFeed: oraclePda,
      } as any)
      .signers([liquidator])
      .rpc();

    // Position closed.
    const traderPos = await program.account.position.fetch(traderPositionPda);
    assert.ok(traderPos.size.isZero(), "size = 0 after liquidation");
    assert.ok(traderPos.entryPrice.isZero(), "entry price cleared");

    // Trader's deposited balance decreased by the realized loss.
    const traderMarginAfter = await program.account.marginAccount.fetch(
      traderMarginPda
    );
    assert.ok(
      traderMarginAfter.usdcDeposited.lt(traderMarginBefore.usdcDeposited),
      "trader balance decreased"
    );

    // usdc_locked released for position.
    assert.ok(
      traderMarginAfter.usdcLocked.lt(traderMarginBefore.usdcLocked),
      "locked decreased"
    );

    // Bankrupt position (oracle=$72.9, entry=$100, collateral=$20):
    // upnl = ($72.9 - $100) × 1 = -$27.1, equity = $20 - $27.1 = -$7.1 < 0
    // → no liquidator reward.
    const liqMarginAfter = await program.account.marginAccount.fetch(
      liquidatorMarginPda
    );
    const reward = liqMarginAfter.usdcDeposited.sub(
      liqMarginBefore.usdcDeposited
    );
    assert.ok(reward.isZero(), "no reward on bankrupt position");
  });

  // ── 13. liquidate: healthy position rejected ────────────────────────────
  //
  // Liquidator has short @ $100. Oracle is at $72.9 (from test 12 drops).
  // upnl for short = $100 - $72.9 = $27.1 (profit); collateral = $20.
  // equity = $20 + $27.1 = $47.1; margin_ratio = $47.1/$72.9 ≈ 6460 bps → NOT liquidatable.

  it("13. liquidate rejects a healthy position with NotLiquidatable", async () => {
    try {
      // trader acts as the liquidator; liquidator's short is the target.
      await program.methods
        .liquidate()
        .accounts({
          liquidator: trader.publicKey,
          market: marketPda,
          position: liquidatorPositionPda,
          traderMargin: liquidatorMarginPda,
          liquidatorMargin: traderMarginPda,
          oracleFeed: oraclePda,
        } as any)
        .signers([trader])
        .rpc();
      assert.fail("Expected NotLiquidatable");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      assert.strictEqual(
        (err as AnchorError).error.errorCode.code,
        "NotLiquidatable"
      );
    }
  });

  // ── 14. place_order rejected when oracle is Paused ─────────────────────
  //
  // admin_pause → oracle status = Paused.
  // place_order checks effective_status == Active → fails with OracleNotActive.
  // update_price restores oracle to Active ($72.9 → $80.19, exactly 10% increase).

  it("14. place_order rejected when oracle is Paused", async () => {
    // Pause the oracle explicitly.
    await oracleProgram.methods
      .adminPause()
      .accounts({
        authority: trader.publicKey,
        market: marketPda,
        oracle: oraclePda,
      } as any)
      .signers([trader])
      .rpc();

    // Attempt a new order — must be rejected.
    try {
      await program.methods
        .placeOrder({
          side: { long: {} },
          orderType: { limit: {} },
          price: usd(100),
          size: lot(1),
        })
        .accounts({
          taker: trader.publicKey,
          market: marketPda,
          takerPosition: traderPositionPda,
          takerMargin: traderMarginPda,
          oracleFeed: oraclePda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([trader])
        .rpc();
      assert.fail("Expected OracleNotActive");
    } catch (err) {
      assert.instanceOf(err, AnchorError);
      assert.strictEqual(
        (err as AnchorError).error.errorCode.code,
        "OracleNotActive"
      );
    }

    // Restore oracle to Active: update_price always resets status to Active.
    // After the 5-step drop, previous_price = $81M.  We restore to $81M (diff=0 → passes).
    await oracleProgram.methods
      .updatePrice({
        price: new BN(81_000_000),
        confidence: usd(1),
        source: 0,
      })
      .accounts({
        authority: trader.publicKey,
        market: marketPda,
        oracle: oraclePda,
      } as any)
      .signers([trader])
      .rpc();
  });

  // ── 15. liquidation succeeds when oracle is ReduceOnly ─────────────────
  //
  // Oracle restored to $81M (Active) in test 14. Liquidator opens new short;
  // trader2 goes long @ $100. Advance clock 360s → oracle ReduceOnly.
  // At oracle $81M: trader2 long @ $100, collateral $20.
  //   upnl = ($81 - $100) × 1 lot = -$19M, equity = $1M > 0.
  //   margin_ratio = $1M / $81M × 10000 ≈ 123 bps < 1000 bps → liquidatable.
  //   Reward = $1M × 5% = 50_000 ($0.05).

  it("15. liquidation succeeds when oracle is ReduceOnly (stale > 5 min)", async () => {
    // trader2 deposits collateral to open a margin account.
    await program.methods
      .depositCollateral(usd(500))
      .accounts({
        owner: trader2.publicKey,
        marginAccount: trader2MarginPda,
        userUsdc: trader2UsdcAta,
        vaultAuthority: vaultAuthorityPda,
        vault: vaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([trader2])
      .rpc();

    // Liquidator places a new limit sell @ $100 (resting ask).
    // Oracle is Active at $80.19 → place_order allowed.
    await program.methods
      .placeOrder({
        side: { short: {} },
        orderType: { limit: {} },
        price: usd(100),
        size: lot(1),
      })
      .accounts({
        taker: liquidator.publicKey,
        market: marketPda,
        takerPosition: liquidatorPositionPda,
        takerMargin: liquidatorMarginPda,
        oracleFeed: oraclePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([liquidator])
      .rpc();

    // Trader2 buys @ $100 → crosses liquidator's ask, fills at $100.
    // Trader2 becomes long @ $100, collateral = 20% × $100 = $20.
    await program.methods
      .placeOrder({
        side: { long: {} },
        orderType: { limit: {} },
        price: usd(100),
        size: lot(1),
      })
      .accounts({
        taker: trader2.publicKey,
        market: marketPda,
        takerPosition: trader2PositionPda,
        takerMargin: trader2MarginPda,
        oracleFeed: oraclePda,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: liquidatorPositionPda, isWritable: true, isSigner: false },
      ])
      .signers([trader2])
      .rpc();

    // Verify trader2 is long @ $100.
    const t2Pos = await program.account.position.fetch(trader2PositionPda);
    assert.ok(t2Pos.size.eq(lot(1)), "trader2 size = 1 lot");
    assert.ok(t2Pos.entryPrice.eq(usd(100)), "trader2 entry = $100");
    assert.deepEqual(t2Pos.side, { long: {} });
    assert.ok(t2Pos.collateral.eq(usd(20)), "trader2 collateral = $20");

    // Advance bankrun clock by 360 seconds → oracle staleness > 300s → ReduceOnly.
    const clock = await context.banksClient.getClock();
    await context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + 360n
      )
    );

    const liqMarginBefore = await program.account.marginAccount.fetch(
      liquidatorMarginPda
    );

    // Liquidate trader2's long — must succeed even though oracle is ReduceOnly.
    await program.methods
      .liquidate()
      .accounts({
        liquidator: liquidator.publicKey,
        market: marketPda,
        position: trader2PositionPda,
        traderMargin: trader2MarginPda,
        liquidatorMargin: liquidatorMarginPda,
        oracleFeed: oraclePda,
      } as any)
      .signers([liquidator])
      .rpc();

    // Position should be closed.
    const t2PosAfter = await program.account.position.fetch(trader2PositionPda);
    assert.ok(t2PosAfter.size.isZero(), "trader2 position closed after liquidation");
    assert.ok(t2PosAfter.entryPrice.isZero(), "entry price cleared");

    // Liquidator should have received a small reward.
    // equity = $0.19M = 190_000, reward = 190_000 × 500 / 10_000 = 9_500
    const liqMarginAfter = await program.account.marginAccount.fetch(
      liquidatorMarginPda
    );
    const reward = liqMarginAfter.usdcDeposited.sub(liqMarginBefore.usdcDeposited);
    assert.ok(reward.gtn(0), "liquidator received reward for solvent position");
    // equity=$1M, reward = $1M × 500 / 10_000 = 50_000
    assert.ok(reward.eqn(50_000), `expected reward 50_000, got ${reward.toString()}`);
  });

  // ── 16. update_funding computes correct rate when mark > oracle ─────────
  //
  // Oracle is at $81M (ReduceOnly from test 15 clock advance — still < 900s stale).
  // Advance clock 1s more (now 361s total stale) → oracle still ReduceOnly, not Paused.
  // mark_price = oracle × 1.1 = 81_000_000 × 1.1 = 89_100_000.
  //
  // funding_rate = (89_100_000 - 81_000_000) × FUNDING_PRECISION / 81_000_000 / 24
  //             = 8_100_000 × 1_000_000_000 / 81_000_000 / 24
  //             = 100_000_000 / 24 = 4_166_666 (integer division)
  //
  // Note: 8_100_000 × 1_000_000_000 / 81_000_000 = 100_000_000 (not 100 billion).
  // The division cancels: (8.1e6 / 81e6) × 1e9 = 0.1 × 1e9 = 1e8 = 100_000_000.

  it("16. update_funding computes correct cumulative funding rate", async () => {
    // Advance clock 1 more second (total 361s stale < 900s → still ReduceOnly).
    const clock = await context.banksClient.getClock();
    await context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + 1n
      )
    );

    await program.methods
      .updateFunding({ markPrice: new BN(89_100_000) })
      .accounts({
        caller: trader.publicKey,
        market: marketPda,
        oracleFeed: oraclePda,
      } as any)
      .signers([trader])
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    // Expected: (89_100_000 - 81_000_000) * 1e9 / 81_000_000 / 24
    //         = 8_100_000 * 1e9 / 81_000_000 / 24
    //         = 100_000_000 / 24 = 4_166_666
    const expectedRate = new BN(4_166_666);
    assert.ok(
      market.cumulativeFundingRate.eq(expectedRate),
      `expected cumulative_funding_rate ${expectedRate.toString()}, got ${market.cumulativeFundingRate.toString()}`
    );
  });
});
