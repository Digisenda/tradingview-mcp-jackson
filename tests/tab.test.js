// Unit tests for src/core/tab.js — pin/list wiring on top of connection.js's
// selectChartTarget. Mocks global fetch (CDP /json/list) so no live CDP needed.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { list, pinTab, getPin } from "../src/core/tab.js";
import { pinToChartId } from "../src/connection.js";

const manualNVDA = { type: "page", id: "t1", title: "NVDA — TradingView", url: "https://www.tradingview.com/chart/AAAA1111/" };
const manualTSLA = { type: "page", id: "t2", title: "TSLA — TradingView", url: "https://www.tradingview.com/chart/BBBB2222/" };
const vigiaTab   = { type: "page", id: "t3", title: "Vigía — TradingView", url: "https://www.tradingview.com/chart/CCCC3333/" };

let originalFetch;

beforeEach(() => {
  originalFetch = global.fetch;
  global.fetch = async () => ({ json: async () => [manualNVDA, manualTSLA, vigiaTab] });
  pinToChartId(null);
});

afterEach(() => {
  global.fetch = originalFetch;
  pinToChartId(null);
});

describe("list()", () => {
  test("flags ambiguous=true with 2+ tabs and no pin", async () => {
    const result = await list();
    assert.equal(result.tab_count, 3);
    assert.equal(result.ambiguous, true);
    assert.equal(result.pinned_chart_id, null);
  });

  test("marks the pinned tab and clears ambiguous once pinned", async () => {
    pinToChartId("BBBB2222");
    const result = await list();
    assert.equal(result.ambiguous, false);
    assert.equal(result.pinned_chart_id, "BBBB2222");
    const flagged = result.tabs.filter(t => t.pinned);
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].chart_id, "BBBB2222");
  });
});

describe("pinTab()", () => {
  test("pins a chart_id that exists among open tabs", async () => {
    const result = await pinTab({ chart_id: "CCCC3333" });
    assert.equal(result.success, true);
    assert.equal(result.action, "pinned");
    assert.equal(getPin().pinned_chart_id, "CCCC3333");
  });

  test("reports success:false (but still stores the pin) if the chart_id isn't currently open", async () => {
    const result = await pinTab({ chart_id: "ZZZZ9999" });
    assert.equal(result.success, false);
    assert.equal(result.action, "pin_set_but_not_found");
    assert.equal(getPin().pinned_chart_id, "ZZZZ9999");
  });

  test("omitting chart_id unpins", async () => {
    pinToChartId("CCCC3333");
    const result = await pinTab({});
    assert.equal(result.success, true);
    assert.equal(result.action, "unpinned");
    assert.equal(getPin().pinned_chart_id, null);
  });
});
