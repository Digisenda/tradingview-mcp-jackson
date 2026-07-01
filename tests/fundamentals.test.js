// Tests de unidad para src/core/fundamentals.js — caché sobre fundamental.js
// (checkFundamentals, fetchHtml mockeados) — sin red real.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ─── Mock setup (antes de cualquier import del módulo bajo test) ──────────────

let checkFundamentalsImpl = async () => ({ fed: { active: false, upcoming: [] }, earnings: {} });
let fetchHtmlImpl = async () => "";

const mockCheckFundamentals = mock.fn((...args) => checkFundamentalsImpl(...args));
const mockFetchHtml = mock.fn((...args) => fetchHtmlImpl(...args));

await mock.module("../src/core/fundamental.js", {
  namedExports: {
    checkFundamentals: mockCheckFundamentals,
    fetchHtml: mockFetchHtml,
  },
});

const { warmup, getFedEarnings, getFedDate, getEarnings, getNews, resetDaily } =
  await import("../src/core/fundamentals.js");

function newsHtml(pairs) {
  return pairs
    .map(
      ([headline, source], i) =>
        `<a class="tab-link-news" href="https://x.test/${i}" target="_blank">${headline}</a>` +
        `<span>(${source})</span>`
    )
    .join("");
}

// ─── warmup / getFedEarnings / getFedDate / getEarnings ────────────────────────

test("warmup: éxito — getFedEarnings/getFedDate/getEarnings reflejan el resultado", async () => {
  resetDaily();
  checkFundamentalsImpl = async () => ({
    fed: { active: true, upcoming: [{ date: "2026-07-03", event: "FOMC" }] },
    earnings: { NVDA: { date: "2026-08-20", active: false, days_away: 50 } },
  });
  const result = await warmup(["NVDA"], {});
  assert.strictEqual(result.fed.active, true);
  assert.strictEqual(getFedDate(), "2026-07-03");
  assert.deepStrictEqual(getEarnings("NVDA"), { date: "2026-08-20", active: false, days_away: 50 });
});

test("warmup: falla → getFedEarnings() conserva el último valor bueno, no lanza", async () => {
  resetDaily();
  checkFundamentalsImpl = async () => ({ fed: { active: false, upcoming: [{ date: "2026-07-10", event: "FOMC" }] }, earnings: {} });
  await warmup(["NVDA"], {});
  assert.strictEqual(getFedDate(), "2026-07-10");

  checkFundamentalsImpl = async () => { throw new Error("Finviz caído"); };
  await assert.doesNotReject(warmup(["NVDA"], {}));
  assert.strictEqual(getFedDate(), "2026-07-10"); // conserva el anterior
});

test("warmup: falla en el primer intento del día → getFedDate() es null, no lanza", async () => {
  resetDaily();
  checkFundamentalsImpl = async () => { throw new Error("Finviz caído"); };
  await assert.doesNotReject(warmup(["NVDA"], {}));
  assert.strictEqual(getFedDate(), null);
  assert.strictEqual(getEarnings("NVDA"), null);
});

// ─── getNews — TTL 15 min, degradación graceful ────────────────────────────────

test("getNews: primera llamada scrapea y cachea", async () => {
  resetDaily();
  mockFetchHtml.mock.resetCalls();
  fetchHtmlImpl = async () => newsHtml([["Headline A", "Reuters"], ["Headline B", "Bloomberg"]]);
  const items = await getNews("NVDA", { limit: 3 });
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].headline, "Headline A");
  assert.strictEqual(mockFetchHtml.mock.calls.length, 1);
});

test("getNews: segunda llamada dentro del TTL usa caché, no vuelve a scrapear", async () => {
  resetDaily();
  mockFetchHtml.mock.resetCalls();
  fetchHtmlImpl = async () => newsHtml([["Headline A", "Reuters"]]);
  await getNews("NVDA");
  await getNews("NVDA");
  assert.strictEqual(mockFetchHtml.mock.calls.length, 1); // solo 1 fetch real
});

test("getNews: TTL vencido + scrape falla → devuelve la última lista buena en caché", async (t) => {
  resetDaily();
  fetchHtmlImpl = async () => newsHtml([["Headline buena", "Reuters"]]);
  const first = await getNews("TSLA");
  assert.strictEqual(first.length, 1);

  t.mock.timers.enable({ apis: ["Date"] });
  t.mock.timers.tick(16 * 60 * 1000); // pasa el TTL de 15 min
  fetchHtmlImpl = async () => { throw new Error("timeout"); };
  const stale = await getNews("TSLA");
  assert.deepStrictEqual(stale, first); // degrada al último valor bueno, no []
});

test("getNews: scrape falla y nunca hubo caché → devuelve []", async () => {
  resetDaily();
  fetchHtmlImpl = async () => { throw new Error("timeout"); };
  const items = await getNews("QQQ");
  assert.deepStrictEqual(items, []);
});

// ─── resetDaily ────────────────────────────────────────────────────────────────

test("resetDaily: limpia FED/earnings y caché de noticias", async () => {
  checkFundamentalsImpl = async () => ({ fed: { active: true, upcoming: [{ date: "2026-07-05", event: "FOMC" }] }, earnings: {} });
  await warmup(["NVDA"], {});
  fetchHtmlImpl = async () => newsHtml([["X", "Y"]]);
  await getNews("NVDA");

  resetDaily();
  assert.strictEqual(getFedDate(), null);
  assert.strictEqual(getFedEarnings(), null);

  // tras el reset, getNews debe volver a scrapear (no quedó caché)
  mockFetchHtml.mock.resetCalls();
  await getNews("NVDA");
  assert.strictEqual(mockFetchHtml.mock.calls.length, 1);
});
