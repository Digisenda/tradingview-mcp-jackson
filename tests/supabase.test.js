// Tests de unidad para src/core/supabase.js — Neon migration.
// No requiere conexión real: @neondatabase/serverless está mockeado.
// Orden importa: tests sin DATABASE_URL corren primero (singleton _sql = null).
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ─── Mock setup (antes de cualquier import del módulo bajo test) ──────────────

let _nextError = null;
let _nextResult = [];

const mockSqlFn = mock.fn(async (...args) => {
  if (_nextError) { const e = _nextError; _nextError = null; throw e; }
  const r = _nextResult;
  _nextResult = [];
  return r;
});

await mock.module("@neondatabase/serverless", {
  namedExports: { neon: () => mockSqlFn },
});

const { savePremarketSession, saveTrade, getRecentTrades, saveSignals } =
  await import("../src/core/supabase.js");

// ─── Tests: sin DATABASE_URL (deben correr primero — _sql = null) ─────────────

test("no DATABASE_URL → savePremarketSession returns db_not_configured", async () => {
  // DATABASE_URL no está seteado en este punto → getSql() = null
  const r = await savePremarketSession("2026-06-25", "test content");
  assert.strictEqual(r.saved, false);
  assert.strictEqual(r.reason, "db_not_configured");
});

test("no DATABASE_URL → getRecentTrades returns empty trades array", async () => {
  const r = await getRecentTrades(5);
  assert.deepStrictEqual(r.trades, []);
  assert.strictEqual(r.reason, "db_not_configured");
});

test("saveTrade() local_backup siempre corre aunque DB esté ausente", async () => {
  const r = await saveTrade({
    date: "2026-06-25", ticker: "NVDA", strategy: "STRAT-12",
    side: "CALL", mode: "paper",
  });

  assert.strictEqual(r.saved, false);
  assert.strictEqual(r.reason, "db_not_configured");
  assert.strictEqual(r.local_backup.backed_up, true, "JSONL backup debe correr siempre");
  assert.ok(r.local_backup.path, "backup.path debe estar definido");
});

test("saveSignals([]) → early return sin tocar la BD", async () => {
  const r = await saveSignals([]);
  assert.strictEqual(r.saved, false);
  assert.ok(r.reason.includes("empty"));
});

// ─── Tests: con DATABASE_URL (inicializa _sql con mockSqlFn) ─────────────────

test("saveTrade() ON CONFLICT DO NOTHING → id:null sin TypeError", async () => {
  process.env.DATABASE_URL = "postgresql://test-neon";
  _nextResult = []; // RETURNING vacío — simula ON CONFLICT DO NOTHING

  const r = await saveTrade({
    date: "2026-06-25", ticker: "NVDA", strategy: "STRAT-12",
    side: "CALL", mode: "paper",
  });

  assert.strictEqual(r.saved, true);
  assert.strictEqual(r.id, null, "id debe ser null (no TypeError) cuando hay conflicto");
  assert.strictEqual(r.local_backup.backed_up, true, "backup corre incluso en conflicto");
});

test("saveTrade() happy path → devuelve id del RETURNING", async () => {
  _nextResult = [{ id: "uuid-abc-123" }];

  const r = await saveTrade({
    date: "2026-06-25", ticker: "TSLA", strategy: "STRAT-04",
    side: "PUT", mode: "real", result_pct: -25.0,
  });

  assert.strictEqual(r.saved, true);
  assert.strictEqual(r.id, "uuid-abc-123");
});

test("savePremarketSession() captura error SQL y retorna gracefully", async () => {
  _nextError = new Error("connection refused");

  const r = await savePremarketSession("2026-06-25", "reporte test", { tickers: ["NVDA"] });
  assert.strictEqual(r.saved, false);
  assert.ok(r.error.includes("connection refused"));
});
