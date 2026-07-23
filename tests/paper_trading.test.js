/**
 * Unit tests for paper-executor.js and paper-ledger.js.
 * Uses a temp directory so no disk state bleeds between runs.
 *
 * Run: node --test tests/paper_trading.test.js
 * Or:  npm run test:paper
 */

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set env BEFORE importing ledger/executor (ledgerDir() reads at call time, but this is safer)
const TEST_DIR = join(tmpdir(), `paper-test-${process.pid}-${Date.now()}`);
process.env.PAPER_LEDGER_DIR = TEST_DIR;
mkdirSync(TEST_DIR, { recursive: true });

// Static imports (resolved after env is set)
import { scoreFromConfidence, onSignal, onSessionEnd, expireStalePositions } from "../paper-executor.js";
import {
  openPosition,
  checkOCO,
  expirePositions,
  hasOpenPosition,
  loadOpenPositions,
  closePosition,
} from "../paper-ledger.js";

after(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

// Helper: wipe open-positions.json between describe blocks that need isolation
function clearOpenPositions() {
  const p = join(TEST_DIR, "open-positions.json");
  if (existsSync(p)) rmSync(p);
}

// ─── scoreFromConfidence ──────────────────────────────────────────────────────

describe("scoreFromConfidence", () => {
  test("watch → 40", () => assert.equal(scoreFromConfidence("watch"), 40));
  test("setup_forming → 60", () => assert.equal(scoreFromConfidence("setup_forming"), 60));
  test("conditions_met → 80", () => assert.equal(scoreFromConfidence("conditions_met"), 80));
  test("unknown string → 0", () => assert.equal(scoreFromConfidence("unknown"), 0));
  test("empty string → 0", () => assert.equal(scoreFromConfidence(""), 0));
});

// ─── OCO target / stop ────────────────────────────────────────────────────────

describe("checkOCO — target and stop detection", () => {
  before(() => clearOpenPositions());

  test("target hit: closes position when price >= target", () => {
    openPosition({
      id: "OCO-T1-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-13",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 100.00,
      veto_flags: [],
    });
    const pos = loadOpenPositions().find((p) => p.id === "OCO-T1-NVDA-CALL");
    assert.ok(pos, "position should exist");
    // target = 100 * 1.12 = 112
    const closed = checkOCO("NVDA", pos.target_price_underlying + 1);
    assert.ok(closed.includes("OCO-T1-NVDA-CALL"), "should close on target hit");
    assert.equal(loadOpenPositions().find((p) => p.id === "OCO-T1-NVDA-CALL"), undefined);
  });

  test("stop hit (CALL): closes position when price <= stop", () => {
    openPosition({
      id: "OCO-T2-TSLA-CALL",
      ticker: "TSLA",
      strategy_id: "STRAT-13",
      side: "CALL",
      confidence: "setup_forming",
      score: 60,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    const pos = loadOpenPositions().find((p) => p.id === "OCO-T2-TSLA-CALL");
    // stop = 200 * 0.85 = 170
    const closed = checkOCO("TSLA", pos.stop_price_underlying - 1);
    assert.ok(closed.includes("OCO-T2-TSLA-CALL"), "should close on stop hit");
  });

  test("target hit (PUT): closes position when price falls to/below target (mirrored bands)", () => {
    openPosition({
      id: "OCO-T4-TSLA-PUT",
      ticker: "TSLA",
      strategy_id: "STRAT-13",
      side: "PUT",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    const pos = loadOpenPositions().find((p) => p.id === "OCO-T4-TSLA-PUT");
    // PUT target = 200 * 0.88 = 176 (profits when price drops)
    assert.equal(pos.target_price_underlying, 176.0);
    const closed = checkOCO("TSLA", pos.target_price_underlying - 1);
    assert.ok(closed.includes("OCO-T4-TSLA-PUT"), "should close on target hit when price drops for a PUT");
  });

  test("stop hit (PUT): closes position when price rises to/above stop (mirrored bands)", () => {
    openPosition({
      id: "OCO-T5-TSLA-PUT",
      ticker: "TSLA",
      strategy_id: "STRAT-13",
      side: "PUT",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    const pos = loadOpenPositions().find((p) => p.id === "OCO-T5-TSLA-PUT");
    // PUT stop = 200 * 1.15 = 230 (loses when price rises)
    assert.equal(pos.stop_price_underlying, 230.0);
    const closed = checkOCO("TSLA", pos.stop_price_underlying + 1);
    assert.ok(closed.includes("OCO-T5-TSLA-PUT"), "should close on stop hit when price rises for a PUT");
  });

  test("no close when price is between stop and target", () => {
    openPosition({
      id: "OCO-T3-NVDA-PUT",
      ticker: "NVDA",
      strategy_id: "STRAT-13",
      side: "PUT",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 150.00,
      veto_flags: [],
    });
    const pos = loadOpenPositions().find((p) => p.id === "OCO-T3-NVDA-PUT");
    const midPrice = (pos.target_price_underlying + pos.stop_price_underlying) / 2;
    const closed = checkOCO("NVDA", midPrice);
    assert.equal(closed.length, 0, "should not close at mid-price");
  });
});

// ─── Closed trade written to JSONL ───────────────────────────────────────────

describe("closePosition — JSONL output", () => {
  before(() => clearOpenPositions());

  test("closed trade appears in JSONL with correct fields", () => {
    openPosition({
      id: "JSONL-TEST-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-13",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 145.00,
      veto_flags: [],
    });
    closePosition("JSONL-TEST-NVDA-CALL", 145 * 1.12 + 0.5, "target");

    const jsonlFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith(".jsonl"));
    assert.ok(jsonlFiles.length > 0, "JSONL file should be written");

    const content = readFileSync(join(TEST_DIR, jsonlFiles[0]), "utf8");
    const trades = content.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const trade = trades.find((t) => t.id === "JSONL-TEST-NVDA-CALL");
    assert.ok(trade, "trade should appear in JSONL");
    assert.equal(trade.exit_reason, "target");
    assert.ok(typeof trade.R_result === "number", "R_result should be numeric");
    assert.ok(trade.R_result > 0, "target hit should yield positive R");
    assert.ok(trade.closed_at, "closed_at should be set");
    assert.match(trade.proxy_note, /proxy subyacente/, "proxy_note should mention proxy");
    assert.equal(trade.note, undefined, "note should not be overwritten by proxy_note");
  });
});

// ─── closePosition — R_result sign respects side ─────────────────────────────

describe("closePosition — R_result respects CALL/PUT direction", () => {
  before(() => clearOpenPositions());

  test("PUT: price drop (favorable) yields positive R_result", () => {
    openPosition({
      id: "R-TEST-NVDA-PUT",
      ticker: "NVDA",
      strategy_id: "STRAT-13",
      side: "PUT",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    // Price fell from 200 to 190 — a win for a PUT, even though exitPrice < entry.
    const trade = closePosition("R-TEST-NVDA-PUT", 190.00, "target");
    assert.ok(trade.R_result > 0, "PUT profiting from a price drop should show positive R");
  });

  test("PUT: price rise (unfavorable) yields negative R_result", () => {
    openPosition({
      id: "R-TEST-TSLA-PUT",
      ticker: "TSLA",
      strategy_id: "STRAT-13",
      side: "PUT",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    // Price rose from 200 to 210 — a loss for a PUT.
    const trade = closePosition("R-TEST-TSLA-PUT", 210.00, "stop");
    assert.ok(trade.R_result < 0, "PUT losing from a price rise should show negative R");
  });
});

// ─── expireStalePositions — carried-over cleanup at startup ──────────────────

describe("expireStalePositions — closes prior-day positions without overnight override", () => {
  beforeEach(() => clearOpenPositions());

  test("expires a same-strategy position opened on a previous ET day, given a price", () => {
    openPosition({
      id: "STALE-TEST-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-01",
      side: "CALL",
      confidence: "setup_forming",
      score: 60,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    // Force opened_at to a prior day so it's picked up as carried-over.
    const positions = loadOpenPositions();
    const pos = positions.find((p) => p.id === "STALE-TEST-NVDA-CALL");
    pos.opened_at = "2020-01-01T14:00:00.000Z";
    writeFileSync(join(TEST_DIR, "open-positions.json"), JSON.stringify(positions, null, 2), "utf8");

    const rules = { strategies: [{ id: "STRAT-01" }] };
    const { expiredCount, skipped } = expireStalePositions(rules, new Map([["NVDA", 205.00]]));

    assert.equal(expiredCount, 1, "should expire the one stale position");
    assert.equal(skipped.length, 0);
    assert.equal(loadOpenPositions().find((p) => p.id === "STALE-TEST-NVDA-CALL"), undefined);
  });

  test("leaves a STRAT-12 (overnight) position open regardless of age", () => {
    openPosition({
      id: "STALE-TEST-NVDA-STRAT12",
      ticker: "NVDA",
      strategy_id: "STRAT-12",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    const positions = loadOpenPositions();
    const pos = positions.find((p) => p.id === "STALE-TEST-NVDA-STRAT12");
    pos.opened_at = "2020-01-01T14:00:00.000Z";
    writeFileSync(join(TEST_DIR, "open-positions.json"), JSON.stringify(positions, null, 2), "utf8");

    const rules = { strategies: [{ id: "STRAT-12", exit_override: { sell_at_market_open: false } }] };
    const { expiredCount } = expireStalePositions(rules, new Map([["NVDA", 205.00]]));

    assert.equal(expiredCount, 0, "STRAT-12 should not be expired by startup cleanup");
    assert.ok(loadOpenPositions().find((p) => p.id === "STALE-TEST-NVDA-STRAT12"), "position should remain open");
  });

  test("skips (leaves open) a stale position when no price is available for its ticker", () => {
    openPosition({
      id: "STALE-TEST-TSLA-NOPRICE",
      ticker: "TSLA",
      strategy_id: "STRAT-01",
      side: "CALL",
      confidence: "setup_forming",
      score: 60,
      underlying_entry_price: 300.00,
      veto_flags: [],
    });
    const positions = loadOpenPositions();
    const pos = positions.find((p) => p.id === "STALE-TEST-TSLA-NOPRICE");
    pos.opened_at = "2020-01-01T14:00:00.000Z";
    writeFileSync(join(TEST_DIR, "open-positions.json"), JSON.stringify(positions, null, 2), "utf8");

    const rules = { strategies: [{ id: "STRAT-01" }] };
    const { expiredCount, skipped } = expireStalePositions(rules, new Map()); // no price for TSLA

    assert.equal(expiredCount, 0);
    assert.ok(skipped.includes("STALE-TEST-TSLA-NOPRICE"));
    assert.ok(loadOpenPositions().find((p) => p.id === "STALE-TEST-TSLA-NOPRICE"), "position stays open without a price");
  });

  test("does not touch a position opened today", () => {
    openPosition({
      id: "TODAY-TEST-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-01",
      side: "CALL",
      confidence: "setup_forming",
      score: 60,
      underlying_entry_price: 200.00,
      veto_flags: [],
    });
    const rules = { strategies: [{ id: "STRAT-01" }] };
    const { expiredCount } = expireStalePositions(rules, new Map([["NVDA", 205.00]]));

    assert.equal(expiredCount, 0, "a position opened today should be left for normal OCO/session-end handling");
    assert.ok(loadOpenPositions().find((p) => p.id === "TODAY-TEST-NVDA-CALL"));
  });
});

// ─── onSignal — enabled flag isolation ───────────────────────────────────────

describe("onSignal — flag isolation", () => {
  before(() => clearOpenPositions());

  const ptEnabled = { enabled: true, min_score: 60 };

  test("watch (score=40) below min_score=60 → no position opened", async () => {
    const before = loadOpenPositions().length;
    await onSignal(
      { ticker: "NVDA", strategy_id: "STRAT-01", side: "CALL", confidence: "watch", veto_flags: [] },
      145,
      ptEnabled
    );
    assert.equal(loadOpenPositions().length, before, "watch signal should not open position");
  });

  test("conditions_met (score=80) >= min_score=60 → position opened", async () => {
    const before = loadOpenPositions().length;
    await onSignal(
      { ticker: "TSLA", strategy_id: "STRAT-13", side: "CALL", confidence: "conditions_met", veto_flags: [] },
      200,
      ptEnabled
    );
    assert.equal(loadOpenPositions().length, before + 1, "conditions_met should open position");
  });

  test("duplicate signal for same ticker+side → no second position opened", async () => {
    const before = loadOpenPositions().length;
    await onSignal(
      { ticker: "TSLA", strategy_id: "STRAT-13", side: "CALL", confidence: "conditions_met", veto_flags: [] },
      200,
      ptEnabled
    );
    assert.equal(loadOpenPositions().length, before, "duplicate should not open another position");
  });
});

// ─── Startup reconciliation ───────────────────────────────────────────────────

describe("loadOpenPositions — restart recovery", () => {
  before(() => clearOpenPositions());

  test("positions written in one process load correctly in another (simulated restart)", () => {
    openPosition({
      id: "RESTART-TEST-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-13",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 180.00,
      veto_flags: [],
    });

    // Simulate restart: call loadOpenPositions() fresh (module is already loaded but reads disk)
    const reloaded = loadOpenPositions();
    const pos = reloaded.find((p) => p.id === "RESTART-TEST-NVDA-CALL");
    assert.ok(pos, "position should survive simulated restart");
    assert.equal(pos.underlying_entry_price, 180.00);
    assert.ok(pos.target_price_underlying, "target should be set");
    assert.ok(pos.stop_price_underlying, "stop should be set");
  });
});

// ─── price guard ─────────────────────────────────────────────────────────────

describe("onSignal — price guard", () => {
  before(() => clearOpenPositions());

  const ptEnabled = { enabled: true, min_score: 60 };

  test("price=0 rejected — no position opened", async () => {
    const before = loadOpenPositions().length;
    await onSignal(
      { ticker: "NVDA", strategy_id: "STRAT-13", side: "CALL", confidence: "conditions_met", veto_flags: [] },
      0,
      ptEnabled
    );
    assert.equal(loadOpenPositions().length, before, "price=0 must not open position");
  });

  test("negative price rejected — no position opened", async () => {
    const before = loadOpenPositions().length;
    await onSignal(
      { ticker: "NVDA", strategy_id: "STRAT-13", side: "CALL", confidence: "conditions_met", veto_flags: [] },
      -5,
      ptEnabled
    );
    assert.equal(loadOpenPositions().length, before, "negative price must not open position");
  });
});

// ─── note propagation ─────────────────────────────────────────────────────────

describe("note propagation — open and close", () => {
  before(() => clearOpenPositions());

  test("strategy note saved in open position and preserved in closed trade", async () => {
    const ptEnabled = { enabled: true, min_score: 60 };
    const stratNote = "STRAT-13: Saliendo de BB con Volatilidad";

    await onSignal(
      { ticker: "AAPL", strategy_id: "STRAT-13", side: "CALL", confidence: "conditions_met", veto_flags: [], note: stratNote },
      200,
      ptEnabled
    );

    const pos = loadOpenPositions().find((p) => p.ticker === "AAPL" && p.side === "CALL");
    assert.ok(pos, "position should exist");
    assert.equal(pos.note, stratNote, "strategy note should be in open position");

    closePosition(pos.id, 200 * 1.12 + 1, "target");

    const jsonlFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith(".jsonl"));
    const content = readFileSync(join(TEST_DIR, jsonlFiles[0]), "utf8");
    const trades = content.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const trade = trades.find((t) => t.id === pos.id);

    assert.ok(trade, "trade should appear in JSONL");
    assert.equal(trade.note, stratNote, "strategy note should survive close");
    assert.match(trade.proxy_note, /proxy subyacente/, "proxy_note should be present separately");
  });
});

// ─── session end expiry ───────────────────────────────────────────────────────

describe("onSessionEnd — position expiry", () => {
  before(() => clearOpenPositions());

  test("onSessionEnd closes all open positions for ticker and writes JSONL", async () => {
    openPosition({
      id: "EXPIRY-TEST-TSLA-CALL",
      ticker: "TSLA",
      strategy_id: "STRAT-01",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 300.00,
      veto_flags: [],
    });

    assert.ok(
      loadOpenPositions().find((p) => p.id === "EXPIRY-TEST-TSLA-CALL"),
      "position should be open before session end"
    );

    await onSessionEnd("TSLA", 305.00);

    assert.equal(
      loadOpenPositions().find((p) => p.id === "EXPIRY-TEST-TSLA-CALL"),
      undefined,
      "position should be closed after session end"
    );

    const jsonlFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith(".jsonl"));
    const content = readFileSync(join(TEST_DIR, jsonlFiles[0]), "utf8");
    const trades = content.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const trade = trades.find((t) => t.id === "EXPIRY-TEST-TSLA-CALL");

    assert.ok(trade, "expired trade should appear in JSONL");
    assert.equal(trade.exit_reason, "expiry");
    assert.equal(trade.underlying_exit_price, 305.00);
  });

  test("onSessionEnd is a no-op when no positions open for ticker", async () => {
    const before = loadOpenPositions().length;
    await onSessionEnd("NVDA", 900.00);
    assert.equal(loadOpenPositions().length, before, "no-op when no positions");
  });

  test("onSessionEnd holds overnight a STRAT-12 position (exit_override.sell_at_market_open=false)", async () => {
    openPosition({
      id: "OVERNIGHT-TEST-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-12",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 195.00,
      veto_flags: [],
    });

    const rules = {
      strategies: [
        { id: "STRAT-12", exit_override: { sell_at_market_open: false } },
      ],
    };

    await onSessionEnd("NVDA", 196.00, rules);

    assert.ok(
      loadOpenPositions().find((p) => p.id === "OVERNIGHT-TEST-NVDA-CALL"),
      "STRAT-12 position should remain open across session end"
    );

    const jsonlFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith(".jsonl"));
    const anyExpiredOvernight = jsonlFiles.some((f) => {
      const content = readFileSync(join(TEST_DIR, f), "utf8");
      return content.includes("OVERNIGHT-TEST-NVDA-CALL");
    });
    assert.equal(anyExpiredOvernight, false, "overnight position should not appear in any closed-trade JSONL");
  });

  test("onSessionEnd closes a normal position but holds a STRAT-12 one for the same ticker", async () => {
    openPosition({
      id: "MIXED-TEST-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-12",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 195.00,
      veto_flags: [],
    });
    openPosition({
      id: "MIXED-TEST-NVDA-PUT",
      ticker: "NVDA",
      strategy_id: "STRAT-01",
      side: "PUT",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 195.00,
      veto_flags: [],
    });

    const rules = {
      strategies: [
        { id: "STRAT-12", exit_override: { sell_at_market_open: false } },
        { id: "STRAT-01" },
      ],
    };

    await onSessionEnd("NVDA", 196.00, rules);

    const open = loadOpenPositions();
    assert.ok(open.find((p) => p.id === "MIXED-TEST-NVDA-CALL"), "STRAT-12 position stays open");
    assert.equal(open.find((p) => p.id === "MIXED-TEST-NVDA-PUT"), undefined, "STRAT-01 position closes normally");
  });

  test("onSessionEnd closes a STRAT-12 position anyway if rules is missing/malformed (fail-safe default)", async () => {
    openPosition({
      id: "FAILSAFE-TEST-NVDA-CALL",
      ticker: "NVDA",
      strategy_id: "STRAT-12",
      side: "CALL",
      confidence: "conditions_met",
      score: 80,
      underlying_entry_price: 195.00,
      veto_flags: [],
    });

    await onSessionEnd("NVDA", 196.00); // no rules passed

    assert.equal(
      loadOpenPositions().find((p) => p.id === "FAILSAFE-TEST-NVDA-CALL"),
      undefined,
      "without rules, an unrecognized strategy_id falls back to the safe default (expire)"
    );
  });
});

// ─── enabled=false guard (simulates watcher behavior) ────────────────────────

describe("enabled=false guard", () => {
  test("watcher guard: if enabled===false, onSignal is not called", () => {
    const rules = { paper_trading: { enabled: false, min_score: 60 } };
    const shouldCall = rules.paper_trading?.enabled === true;
    assert.equal(shouldCall, false, "enabled=false must prevent executor call");
  });
});
