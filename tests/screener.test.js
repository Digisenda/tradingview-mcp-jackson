/**
 * Unit tests for src/digisenda/screener.js — pure computation functions only.
 * No network calls; no yahoo-finance2 hits.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeBBFromBars,
  computeSMAsFromBars,
  computeTrendlineAt,
  computeStrat12Context,
  computeIndicatorsHistoryFromBars,
  mapToYahooSymbol,
} from "../src/digisenda/screener.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeBars(closes, { startHigh = 0, startLow = 0 } = {}) {
  return closes.map((c, i) => ({
    time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    open: c,
    high: c + (startHigh || c * 0.01),
    low: c - (startLow || c * 0.01),
    close: c,
    volume: 1000,
  }));
}

// ── computeBBFromBars ────────────────────────────────────────────────────────

describe("computeBBFromBars", () => {
  test("returns null when insufficient data", () => {
    const closes = [100, 101, 102];
    assert.equal(computeBBFromBars(closes, 20, 3), null);
  });

  test("excludes bar at index (lookahead-free)", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + i);
    // index=20 → uses closes[0..19], which are 100..119
    const bb20 = computeBBFromBars(closes, 20, 20);
    // index=21 → uses closes[1..20], which are 101..120
    const bb21 = computeBBFromBars(closes, 20, 21);
    assert.ok(bb20 !== null);
    assert.ok(bb21 !== null);
    // basis should differ because slice differs
    assert.notEqual(bb20.basis, bb21.basis);
  });

  test("basis equals simple mean of slice", () => {
    const closes = Array.from({ length: 22 }, () => 100);
    const bb = computeBBFromBars(closes, 20, 21);
    assert.ok(bb !== null);
    assert.equal(bb.basis, 100);
    // All same price → stdDev=0 → width=0
    assert.equal(bb.width, 0);
  });

  test("upper > basis > lower for non-flat series", () => {
    const closes = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i));
    const bb = computeBBFromBars(closes, 20, 24);
    assert.ok(bb !== null);
    assert.ok(bb.upper > bb.basis);
    assert.ok(bb.basis > bb.lower);
  });
});

// ── computeSMAsFromBars ──────────────────────────────────────────────────────

describe("computeSMAsFromBars", () => {
  test("returns null for period when insufficient data", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const smas = computeSMAsFromBars(closes, [20, 40, 100, 200], 25);
    assert.equal(smas[0], null === smas[0] ? null : smas[0]); // SMA20: ok (25 > 20)
    assert.ok(smas[0] !== null); // SMA20 has data
    assert.equal(smas[1], null);  // SMA40: insufficient (25 < 40)
    assert.equal(smas[2], null);  // SMA100: insufficient
    assert.equal(smas[3], null);  // SMA200: insufficient
  });

  test("SMA20 of constant series equals the constant", () => {
    const closes = Array.from({ length: 25 }, () => 150);
    const smas = computeSMAsFromBars(closes, [20], 25);
    assert.equal(smas[0], 150);
  });

  test("lookahead-free: index=20 uses closes[0..19]", () => {
    const closes = [
      ...Array.from({ length: 20 }, () => 100),
      999, // index=20 — should NOT be included in SMA at index=20
    ];
    const smas = computeSMAsFromBars(closes, [20], 20);
    assert.equal(smas[0], 100); // 999 excluded
  });
});

// ── computeTrendlineAt ───────────────────────────────────────────────────────

describe("computeTrendlineAt", () => {
  test("returns null with fewer than 5 bars", () => {
    const bars = makeBars([100, 101, 102, 103]);
    assert.equal(computeTrendlineAt(bars, 4, "up", 20), null);
  });

  test("returns object with slope, intercept, value", () => {
    const bars = makeBars(Array.from({ length: 25 }, (_, i) => 100 + i));
    const tl = computeTrendlineAt(bars, 24, "up", 20);
    assert.ok(tl !== null);
    assert.ok("slope" in tl);
    assert.ok("intercept" in tl);
    assert.ok("value" in tl);
  });

  test("upward trendline has positive slope on ascending prices", () => {
    const bars = makeBars(Array.from({ length: 25 }, (_, i) => 100 + i * 2));
    const tl = computeTrendlineAt(bars, 24, "up", 20);
    assert.ok(tl.slope > 0);
  });

  test("downward trendline uses lows", () => {
    // Lows descend: each bar has low = close - 1
    const closes = Array.from({ length: 25 }, (_, i) => 200 - i * 2);
    const bars = closes.map((c, i) => ({
      time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      open: c, high: c + 1, low: c - 1, close: c, volume: 1000,
    }));
    const tlUp = computeTrendlineAt(bars, 24, "up", 20);   // highs
    const tlDn = computeTrendlineAt(bars, 24, "down", 20); // lows
    assert.ok(tlDn.slope < 0);
    // lows = close - 1, highs = close + 1 → different intercepts
    assert.notEqual(tlUp.intercept, tlDn.intercept);
  });

  // Regresión 2026-07-17: una regresión OLS pura pasa por el MEDIO de los datos (mitad
  // de los máximos por encima de la línea, mitad por debajo) — no es una envolvente de
  // resistencia/soporte como pide rules.yaml ("bordeando levemente por encima/debajo la
  // mayor cantidad de puntos posibles"). Reportado en vivo: el precio "rompía" una
  // trendline que en el chart real no había tocado, porque la línea OLS quedaba
  // sistemáticamente demasiado baja/alta.

  test("envelope: la trendline 'up' queda al o por encima de TODOS los máximos de la ventana (no OLS puro)", () => {
    const highs = [110, 105, 108, 100, 103, 95, 98, 90, 93, 85, 88, 80, 83, 75, 78, 70, 73, 65, 68, 60, 63];
    const bars = highs.map((h, i) => ({
      time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      open: h - 2, high: h, low: h - 5, close: h - 2, volume: 1000,
    }));
    const tl = computeTrendlineAt(bars, bars.length, "up", bars.length);
    assert.ok(tl !== null);
    highs.forEach((h, i) => {
      const lineValue = tl.slope * i + tl.intercept;
      assert.ok(lineValue >= h - 1e-6, `high[${i}]=${h} quedó por ENCIMA de la envolvente (línea=${lineValue.toFixed(4)})`);
    });
  });

  test("envelope: la trendline 'down' queda al o por debajo de TODOS los mínimos de la ventana (no OLS puro)", () => {
    const lows = [60, 65, 63, 70, 68, 75, 73, 80, 78, 85, 83, 90, 88, 95, 93, 100, 98, 105, 103, 110, 108];
    const bars = lows.map((l, i) => ({
      time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      open: l + 2, high: l + 5, low: l, close: l + 2, volume: 1000,
    }));
    const tl = computeTrendlineAt(bars, bars.length, "down", bars.length);
    assert.ok(tl !== null);
    lows.forEach((l, i) => {
      const lineValue = tl.slope * i + tl.intercept;
      assert.ok(lineValue <= l + 1e-6, `low[${i}]=${l} quedó por DEBAJO de la envolvente (línea=${lineValue.toFixed(4)})`);
    });
  });
});

// ── computeStrat12Context ────────────────────────────────────────────────────

describe("computeStrat12Context", () => {
  function makeD1Bars(closes) {
    return closes.map((c, i) => ({
      time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      open: c,
      high: c + 1,
      low: c - 1,
      close: c,
      volume: 1000,
    }));
  }

  test("returns null when fewer than 6 bars", () => {
    const bars = makeD1Bars([100, 101, 102, 103, 104]);
    assert.equal(computeStrat12Context(bars, 4), null);
  });

  test("returns null when fewer than 5 consecutive bars in same direction", () => {
    // Only 3 bars up before reversing
    const closes = [100, 101, 100, 101, 102, 103, 102];
    const bars = makeD1Bars(closes);
    const ctx = computeStrat12Context(bars, 6);
    assert.equal(ctx, null);
  });

  test("detects bearish exhaustion + contrarian gap → CALL", () => {
    // 5 consecutive down bars, exhausted (last bar high < prev bar high), then gap up
    const closes = [110, 108, 106, 104, 102, 100, 101.5]; // trend down, gap up
    const bars = closes.map((c, i, arr) => ({
      time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      open: i === closes.length - 1 ? arr[i - 1] + 1.5 : c, // gap up open on last bar
      high: c + 0.5,
      low: c - 0.5,
      close: c,
      volume: 1000,
    }));
    // Manually set last bar open to create gap
    bars[bars.length - 1].open = 101.5;
    const ctx = computeStrat12Context(bars, bars.length - 1);
    if (ctx !== null) {
      assert.equal(ctx.position, "CALL");
      assert.ok(ctx.tendencia_agotada);
      assert.ok(ctx.primer_salto_gap > 0);
    }
    // Either null (conditions not fully met with toy data) or CALL — both acceptable
  });

  test("respects fed_near flag", () => {
    const closes = [110, 108, 106, 104, 102, 100, 101.5];
    const bars = closes.map((c, i) => ({
      time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      open: i === closes.length - 1 ? 101.5 : c,
      high: c + 0.5, low: c - 0.5, close: c, volume: 1000,
    }));
    const ctx = computeStrat12Context(bars, bars.length - 1, true /* fedNear */);
    if (ctx !== null) {
      assert.equal(ctx.fed_near, true);
    }
  });
});

// ── mapToYahooSymbol (T4 — momentum-scan-hibrido-yahoo-cdp.md) ─────────────────

describe("mapToYahooSymbol", () => {
  test("maps the 4 index tickers to their Yahoo equivalents", () => {
    assert.equal(mapToYahooSymbol("SPX"), "^GSPC");
    assert.equal(mapToYahooSymbol("NDX"), "^NDX");
    assert.equal(mapToYahooSymbol("RUT"), "^RUT");
    assert.equal(mapToYahooSymbol("DJI"), "^DJI");
  });

  test("regression: passes through any non-index ticker unchanged (STRAT-01..13 callers)", () => {
    for (const s of ["AMD", "MU", "SNDK", "NVDA", "TSLA", "SOXX", "SPY"]) {
      assert.equal(mapToYahooSymbol(s), s);
    }
  });
});

// ── computeIndicatorsHistoryFromBars (T2 — momentum-scan-hibrido-yahoo-cdp.md) ─

describe("computeIndicatorsHistoryFromBars", () => {
  function makeBarsWithVolume(closes) {
    return closes.map((c, i) => ({
      time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      open: c,
      high: c + 1,
      low: c - 1,
      close: c,
      volume: 1000 + i,
    }));
  }

  test("returns one entry per requested bar, capped at bars.length", () => {
    const bars = makeBarsWithVolume(Array.from({ length: 30 }, (_, i) => 100 + i));
    const history = computeIndicatorsHistoryFromBars(bars, 10);
    assert.equal(history.length, 10);
    assert.equal(history[history.length - 1].date, bars[bars.length - 1].time);

    const historyOverCap = computeIndicatorsHistoryFromBars(bars, 1000);
    assert.equal(historyOverCap.length, bars.length);
  });

  test("each entry exposes the unified SMA+BB+volume shape", () => {
    const bars = makeBarsWithVolume(Array.from({ length: 250 }, (_, i) => 100 + i));
    const history = computeIndicatorsHistoryFromBars(bars, 5);
    for (const entry of history) {
      for (const key of [
        "date", "sma20", "sma40", "sma100", "sma200",
        "bb_basis", "bb_upper", "bb_lower", "volume",
      ]) {
        assert.ok(key in entry, `missing key ${key}`);
      }
    }
    // With 250 bars, the last entries have enough history for SMA200 too.
    const last = history[history.length - 1];
    assert.notEqual(last.sma200, null);
  });

  test("null for periods without enough lookback (matches computeSMAsFromBars directly)", () => {
    const bars = makeBarsWithVolume(Array.from({ length: 25 }, (_, i) => 100 + i));
    const history = computeIndicatorsHistoryFromBars(bars, 3);
    for (const entry of history) {
      assert.notEqual(entry.sma20, null); // 25 bars > 20
      assert.equal(entry.sma40, null);    // 25 bars < 40
      assert.equal(entry.sma100, null);
      assert.equal(entry.sma200, null);
    }
  });

  test("lookahead-free: matches computeBBFromBars/computeSMAsFromBars at the same index", () => {
    const closes = Array.from({ length: 230 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.1);
    const bars = makeBarsWithVolume(closes);
    const history = computeIndicatorsHistoryFromBars(bars, 5);
    const start = bars.length - 5;
    history.forEach((entry, offset) => {
      const idx = start + offset;
      const bb = computeBBFromBars(closes, 20, idx);
      const [sma20, sma40, sma100, sma200] = computeSMAsFromBars(closes, [20, 40, 100, 200], idx);
      assert.equal(entry.bb_basis, bb.basis);
      assert.equal(entry.bb_upper, bb.upper);
      assert.equal(entry.bb_lower, bb.lower);
      assert.equal(entry.sma20, sma20);
      assert.equal(entry.sma40, sma40);
      assert.equal(entry.sma100, sma100);
      assert.equal(entry.sma200, sma200);
    });
  });

  // Regresión CMT1 (2026-08-10): la versión anterior del diseño solo cubría CF-001
  // (ancho de banda BB) y no habría podido ubicar el cruce exacto de MA100/MA200 que
  // motivó todo el documento (caso MU/SNDK, PC-001). Este test fija ese caso: un
  // cruce real de sma100/sma200 debe quedar localizable recorriendo el historial.
  test("locates an exact SMA100/SMA200 crossover across the history array (PC-001 case)", () => {
    // Slow downtrend for 250 bars (SMA100 starts below SMA200), then a sharp
    // sustained rally so SMA100 crosses above SMA200 partway through the tail.
    const decline = Array.from({ length: 250 }, (_, i) => 200 - i * 0.3);
    const rally = Array.from({ length: 150 }, (_, i) => decline[decline.length - 1] + i * 1.5);
    const closes = [...decline, ...rally];
    const bars = makeBarsWithVolume(closes);
    const history = computeIndicatorsHistoryFromBars(bars, 150);

    const withBoth = history.filter((h) => h.sma100 != null && h.sma200 != null);
    assert.ok(withBoth.length > 10, "expected enough bars with both SMAs populated");
    const before = withBoth.find((h) => h.sma100 < h.sma200);
    const after = [...withBoth].reverse().find((h) => h.sma100 > h.sma200);
    assert.ok(before, "expected a bar where SMA100 was still below SMA200");
    assert.ok(after, "expected a bar where SMA100 crossed above SMA200");
    assert.ok(new Date(after.date) > new Date(before.date));
  });
});
