/**
 * Unit tests for src/core/signals.js — screenStrategies() timing gates.
 * Pure function, no I/O, no mocks needed.
 *
 * Focuses on the STRAT-12 (15:45-15:55 ET) and STRAT-13 (no timing gate)
 * behavior that becomes reachable once the vigía's session window widens
 * beyond 09:30-11:30 ET.
 *
 * Run: node --test tests/signals.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { screenStrategies } from "../src/core/signals.js";

// Builds a UTC Date matching a given ET hour/minute for a summer date (EDT, UTC-4).
function etBarTime(hour, minute) {
  return new Date(Date.UTC(2026, 6, 1, hour + 4, minute)); // July → EDT offset 4h
}

// ─── STRAT-12 — Segundo Salto (15:45-15:55 ET gate) ────────────────────────────

function strat12TfData() {
  return {
    D1: {
      bb_position: "above_middle", // inside bands (not above_upper/below_lower)
      smas: [205, 200], // spread=5 > 1, price(210) > sma20(205) → CALL gate ok
      strat12: {
        fed_near: false,
        earnings_near: false,
        tendencia_agotada: true,
        position: "CALL",
        primer_salto_gap: 2.5,
      },
    },
    H1: {},
    M15: {},
  };
}

test("STRAT-12: dentro del gate 15:45-15:55 ET → conditions_met", () => {
  const candidates = screenStrategies(210, strat12TfData(), etBarTime(15, 50));
  const strat12 = candidates.find((c) => c.id === "STRAT-12");
  assert.ok(strat12, "STRAT-12 candidate should be emitted");
  assert.equal(strat12.confidence, "conditions_met");
  assert.equal(strat12.position, "CALL");
});

test("STRAT-12: fuera del gate (14:00 ET) → watch, no conditions_met", () => {
  const candidates = screenStrategies(210, strat12TfData(), etBarTime(14, 0));
  const strat12 = candidates.find((c) => c.id === "STRAT-12");
  assert.ok(strat12, "STRAT-12 candidate should still be emitted (pre-conditions met)");
  assert.equal(strat12.confidence, "watch", "outside 15:45-15:55 ET, timing gate holds it at watch");
});

test("STRAT-12: sin barTime → watch (no se puede verificar el gate de horario)", () => {
  const candidates = screenStrategies(210, strat12TfData(), null);
  const strat12 = candidates.find((c) => c.id === "STRAT-12");
  assert.ok(strat12);
  assert.equal(strat12.confidence, "watch");
});

// ─── STRAT-13 — Saliendo de BB con Volatilidad (sin gate de horario) ───────────

function strat13TfData() {
  return {
    D1: {},
    H1: {},
    M15: {
      bb_position: "above_middle", // dentro de BB, dirección CALL
      bb: { width: 6 },
      bb_prev_width: 4, // width expandiendo 4 → 6
    },
  };
}

test("STRAT-13: dispara a mediodía (13:00 ET) — no tiene gate de horario, por diseño", () => {
  const candidates = screenStrategies(100, strat13TfData(), etBarTime(13, 0));
  const strat13 = candidates.find((c) => c.id === "STRAT-13");
  assert.ok(strat13, "STRAT-13 debe emitirse sin importar la hora");
  assert.equal(strat13.confidence, "conditions_met");
  assert.equal(strat13.position, "CALL");
});

test("STRAT-13: dispara igual sin barTime — confirma que es independiente del horario", () => {
  const candidates = screenStrategies(100, strat13TfData(), null);
  const strat13 = candidates.find((c) => c.id === "STRAT-13");
  assert.ok(strat13);
  assert.equal(strat13.confidence, "conditions_met");
});
