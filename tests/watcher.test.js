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

const { buildVetoFlags, isInSessionWindow, isInWarmupWindow } = await import("../watcher.js");

test("buildVetoFlags: FED dentro de ±2 días → incluye flag FED con la fecha", () => {
  const event = { date: "2026-07-03", event: "FOMC", days_away: 1 };
  fedEarnings = {
    fed: { active: true, activeEvent: event, upcoming: [event] },
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
  const event = { date: "2026-07-02", event: "FOMC", days_away: 0 };
  fedEarnings = {
    fed: { active: true, activeEvent: event, upcoming: [event] },
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

test("buildVetoFlags: confía en fe.fed.active de fundamental.js, no recalcula su propio umbral (fix #6)", () => {
  // Simula que fundamental.js cambió su umbral de FED (ej. a ±3 días) — un
  // evento con days_away=3 que un ±2 hardcodeado en watcher.js NO detectaría
  // por su cuenta. Si buildVetoFlags confía en fe.fed.active/activeEvent (como
  // debe), el flag aparece igual — antes de este fix, se habría perdido.
  const event = { date: "2026-07-04", event: "FOMC", days_away: 3 };
  fedEarnings = {
    fed: { active: true, activeEvent: event, upcoming: [event] }, // active=true decidido por fundamental.js
    earnings: {},
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, ["FED 2026-07-04"], "debe mostrar el flag aunque days_away=3 no pase un ±2 hardcodeado");
});

test("buildVetoFlags: active=false → sin flag FED aunque haya un upcoming[] con eventos", () => {
  fedEarnings = {
    fed: { active: false, activeEvent: null, upcoming: [{ date: "2026-08-01", event: "FOMC", days_away: 30 }] },
    earnings: {},
  };
  const flags = buildVetoFlags("NVDA");
  assert.deepStrictEqual(flags, []);
});

// ─── isInSessionWindow — límite ampliado a 16:00 ET (horario completo de mercado) ──

// Julio → EDT (UTC-4). etUTC(h, m) = instante UTC que corresponde a esa hora ET.
function etUTC(hour, minute) {
  return Date.UTC(2026, 6, 1, hour + 4, minute);
}

test("isInSessionWindow: 15:59 ET está dentro de 09:30–16:00 ET", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(etUTC(15, 59));
  assert.equal(isInSessionWindow("09:30–16:00 ET"), true);
});

test("isInSessionWindow: 16:00 ET está dentro (borde inclusive, mismo patrón <= ya existente)", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(etUTC(16, 0));
  assert.equal(isInSessionWindow("09:30–16:00 ET"), true);
});

test("isInSessionWindow: 16:01 ET está fuera de 09:30–16:00 ET", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(etUTC(16, 1));
  assert.equal(isInSessionWindow("09:30–16:00 ET"), false);
});

test("isInSessionWindow: 09:30 ET sigue siendo el borde de apertura (sin regresión)", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(etUTC(9, 30));
  assert.equal(isInSessionWindow("09:30–16:00 ET"), true);
  t.mock.timers.setTime(etUTC(9, 29));
  assert.equal(isInSessionWindow("09:30–16:00 ET"), false);
});

test("isInSessionWindow: sin argumento, cae al default NUEVO (16:00), no al viejo (11:30)", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(etUTC(15, 0)); // dentro del default nuevo, fuera del viejo
  assert.equal(isInSessionWindow(undefined), true, "el fallback debe ser 09:30–16:00 ET, no el string viejo de 11:30");
});

test("isInWarmupWindow: sigue anclado solo al inicio (09:30), el fin de ventana no lo afecta", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.setTime(etUTC(9, 26)); // 4 min antes de abrir, dentro de warmup_minutes=5
  assert.equal(isInWarmupWindow("09:30–16:00 ET", 5), true);
  t.mock.timers.setTime(etUTC(9, 30)); // ya abrió → warmup termina
  assert.equal(isInWarmupWindow("09:30–16:00 ET", 5), false);
});
