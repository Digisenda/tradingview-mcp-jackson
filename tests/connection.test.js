// Unit tests for connection.js's pure tab-selection logic (selectChartTarget).
// No live CDP connection required — targets are fixture arrays shaped like
// CDP's /json/list response.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { selectChartTarget, pinToChartId, getPinnedChartId } from "../src/connection.js";

const manualNVDA = { type: "page", id: "t1", title: "NVDA — TradingView", url: "https://www.tradingview.com/chart/AAAA1111/" };
const manualTSLA = { type: "page", id: "t2", title: "TSLA — TradingView", url: "https://www.tradingview.com/chart/BBBB2222/" };
const vigiaTab   = { type: "page", id: "t3", title: "NVDA — TradingView", url: "https://www.tradingview.com/chart/CCCC3333/" };
const nonChartTab = { type: "page", id: "t4", title: "Gmail", url: "https://mail.google.com/" };

describe("selectChartTarget — no pin", () => {
  test("single tab: returns it (no ambiguity, no pin needed)", () => {
    const t = selectChartTarget([manualNVDA], null);
    assert.equal(t.id, "t1");
  });

  test("multiple tabs, no pin: throws instead of silently guessing pages[0] (fixed 2026-08-07 — this exact silent fallback mutated a live manual-trading tab from a momentum-scan run)", () => {
    assert.throws(
      () => selectChartTarget([manualNVDA, manualTSLA, vigiaTab], null),
      /ninguna anclada/
    );
  });

  test("ambiguity error lists the available chart_ids", () => {
    try {
      selectChartTarget([manualNVDA, manualTSLA], null);
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /AAAA1111/);
      assert.match(e.message, /BBBB2222/);
      assert.match(e.message, /chart_pin_tab/);
    }
  });

  test("ignores non-chart pages — single remaining chart tab is unambiguous", () => {
    const t = selectChartTarget([nonChartTab, manualTSLA], null);
    assert.equal(t.id, "t2");
  });
});

describe("selectChartTarget — pinned by chart_id", () => {
  test("returns the tab matching the pinned chart_id, regardless of order", () => {
    const t = selectChartTarget([manualNVDA, manualTSLA, vigiaTab], "CCCC3333");
    assert.equal(t.id, "t3");
  });

  test("throws (does not silently fall back) when the pinned chart_id is missing", () => {
    assert.throws(
      () => selectChartTarget([manualNVDA, manualTSLA], "CCCC3333"),
      /Pestaña anclada no encontrada/
    );
  });

  test("error message lists available chart_ids to help reconfigure", () => {
    try {
      selectChartTarget([manualNVDA, manualTSLA], "CCCC3333");
      assert.fail("should have thrown");
    } catch (e) {
      assert.match(e.message, /AAAA1111/);
      assert.match(e.message, /BBBB2222/);
    }
  });
});

describe("pinToChartId / getPinnedChartId", () => {
  test("stores and reports the pinned id, and clearing it restores default (throw-on-ambiguity) selection", () => {
    pinToChartId("CCCC3333");
    assert.equal(getPinnedChartId(), "CCCC3333");
    assert.equal(selectChartTarget([manualNVDA, vigiaTab]).id, "t3");

    pinToChartId(null);
    assert.equal(getPinnedChartId(), null);
    assert.throws(() => selectChartTarget([manualNVDA, vigiaTab]), /ninguna anclada/);
  });
});
