// Tests de unidad para src/core/dashboard.js — renderUnifiedDashboard() es una
// función pura (sin I/O), se testea directo sin mocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderUnifiedDashboard } from "../src/core/dashboard.js";

const baseArgs = {
  date: "2026-07-01",
  sessionLabel: "PRE-MARKET · 09:27 ET",
  fedWarning: null,
  premarketData: null,
  signals: [],
  fundamentals: { fedDate: null, fedActive: false, earnings: {}, news: {} },
};

test("renderUnifiedDashboard: sin premarketData → placeholder, no lanza", () => {
  const html = renderUnifiedDashboard(baseArgs);
  assert.match(html, /Sin checklist premercado hoy/);
});

test("renderUnifiedDashboard: sin signals → placeholder, no lanza", () => {
  const html = renderUnifiedDashboard(baseArgs);
  assert.match(html, /Sin señales aún hoy/);
});

test("renderUnifiedDashboard: fundamentals degradado (todo null/vacío) → '—' / sin noticias, no lanza", () => {
  const html = renderUnifiedDashboard(baseArgs);
  assert.match(html, /Sin noticias recientes/);
  assert.doesNotThrow(() => renderUnifiedDashboard(baseArgs));
});

test("renderUnifiedDashboard: con datos completos renderiza scorecard + señales + fundamentales", () => {
  const html = renderUnifiedDashboard({
    date: "2026-07-01",
    sessionLabel: "ABIERTO",
    fedWarning: "FED activo",
    premarketData: {
      tickers: [
        {
          symbol: "NVDA",
          price: 195.07,
          classification: "ejecutar",
          timeframes: { D1: { bb: { middle: 182.4 }, ma_order: "alcista" } },
          candidates: [{ id: "STRAT-05", position: "CALL", confidence: "conditions_met" }],
        },
      ],
    },
    signals: [
      { logged_at: "2026-07-01T13:30:54.000Z", confidence: "conditions_met", strategy: "STRAT-05", position: "CALL", ticker: "NVDA", price: 195.07 },
    ],
    fundamentals: {
      fedDate: "2026-07-03",
      fedActive: true,
      earnings: { NVDA: { active: true, days_away: 4 } },
      news: { NVDA: [{ headline: "Test headline", source: "Reuters" }] },
    },
  });

  assert.match(html, /NVDA/);
  assert.match(html, /STRAT-05/);
  assert.match(html, /182\.40/);
  assert.match(html, /2026-07-03/);
  assert.match(html, /Test headline/);
  assert.match(html, /FED activo/);
  assert.match(html, /<meta http-equiv="refresh" content="30">/);
});

test("renderUnifiedDashboard: escapa HTML en notas/headlines (sin XSS)", () => {
  const html = renderUnifiedDashboard({
    ...baseArgs,
    signals: [
      { logged_at: "2026-07-01T13:30:54.000Z", confidence: "watch", strategy: "<script>alert(1)</script>", ticker: "NVDA", price: 1 },
    ],
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("renderUnifiedDashboard: clasificación no_operar sin candidatos no lanza", () => {
  const html = renderUnifiedDashboard({
    ...baseArgs,
    premarketData: { tickers: [{ symbol: "TSLA", price: 194.71, classification: "no_operar", timeframes: {}, candidates: [] }] },
  });
  assert.match(html, /TSLA/);
  assert.match(html, /NO OPERAR/);
});

test("renderUnifiedDashboard: un elemento null/parcial en tickers (escritura concurrente a mitad) no lanza", () => {
  // Regresión de /code-review: morning.js escribiendo el JSON a mitad mientras
  // el vigía lo lee podía dejar un elemento null/incompleto en el array.
  assert.doesNotThrow(() => {
    const html = renderUnifiedDashboard({
      ...baseArgs,
      premarketData: {
        tickers: [
          null,
          { symbol: "NVDA", price: 195.07, classification: "ejecutar", timeframes: {}, candidates: [] },
          undefined,
        ],
      },
    });
    assert.match(html, /NVDA/, "el ticker válido sigue renderizando aunque haya vecinos rotos");
  });
});
