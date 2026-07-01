// Test de regresión para watcher.js — buildVetoFlags(). Cubre el comportamiento
// que antes leía rules.json directo y ahora usa fundamentals.js (D6) — mismo
// resultado esperado (flags "FED <date>" / "EARNINGS <date>"), fuente distinta.
// fundamentals.js mockeado — no requiere red ni CDP.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let fedEarnings = null;

await mock.module("../src/core/fundamentals.js", {
  namedExports: {
    getFedEarnings: () => fedEarnings,
    getFedDate: () => fedEarnings?.fed?.upcoming?.[0]?.date ?? null,
    getEarnings: (sym) => fedEarnings?.earnings?.[sym] ?? null,
    getNews: async () => [],
    warmup: async () => fedEarnings,
    resetDaily: () => { fedEarnings = null; },
  },
});

const { buildVetoFlags } = await import("../watcher.js");

test("buildVetoFlags: FED dentro de ±2 días → incluye flag FED con la fecha", () => {
  fedEarnings = {
    fed: { active: true, upcoming: [{ date: "2026-07-03", event: "FOMC", days_away: 1 }] },
    earnings: {},
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, ["FED 2026-07-03"]);
});

test("buildVetoFlags: FED fuera de ±2 días → sin flag FED", () => {
  fedEarnings = {
    fed: { active: false, upcoming: [{ date: "2026-08-01", event: "FOMC", days_away: 30 }] },
    earnings: {},
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, []);
});

test("buildVetoFlags: earnings activo para el ticker → incluye flag EARNINGS", () => {
  fedEarnings = {
    fed: { active: false, upcoming: [] },
    earnings: { NVDA: { date: "2026-07-05", active: true, days_away: 4 } },
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, ["EARNINGS 2026-07-05"]);
});

test("buildVetoFlags: earnings inactivo (fuera de ±7 días) → sin flag", () => {
  fedEarnings = {
    fed: { active: false, upcoming: [] },
    earnings: { NVDA: { date: "2026-09-01", active: false, days_away: 60 } },
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, []);
});

test("buildVetoFlags: earnings de OTRO ticker no contamina el chequeado", () => {
  fedEarnings = {
    fed: { active: false, upcoming: [] },
    earnings: { TSLA: { date: "2026-07-05", active: true, days_away: 4 } },
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, []);
});

test("buildVetoFlags: FED + earnings activos a la vez → ambos flags", () => {
  fedEarnings = {
    fed: { active: true, upcoming: [{ date: "2026-07-02", event: "FOMC", days_away: 0 }] },
    earnings: { NVDA: { date: "2026-07-05", active: true, days_away: 4 } },
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, ["FED 2026-07-02", "EARNINGS 2026-07-05"]);
});

test("buildVetoFlags: sin datos de fundamentals (warmup no corrió / falló) → [] sin lanzar", () => {
  fedEarnings = null;
  assert.doesNotThrow(() => buildVetoFlags("NVDA"));
  assert.deepStrictEqual(buildVetoFlags("NVDA"), []);
});
