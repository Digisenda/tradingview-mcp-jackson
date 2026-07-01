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

const { warmup, ensureWarmedUp, getFedEarnings, getFedDate, getEarnings, getNews, resetDaily } =
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
    fed: { active: true, upcoming: [{ date: "2026-07-03", event: "FOMC", days_away: 1 }] },
    earnings: { NVDA: { date: "2026-08-20", active: false, days_away: 50 } },
  });
  const result = await warmup(["NVDA"], {});
  assert.strictEqual(result.fed.active, true);
  assert.strictEqual(getFedDate(), "2026-07-03");
  assert.deepStrictEqual(getEarnings("NVDA"), { date: "2026-08-20", active: false, days_away: 50 });
});

test("warmup: falla → getFedEarnings() conserva el último valor bueno, no lanza", async () => {
  resetDaily();
  checkFundamentalsImpl = async () => ({ fed: { active: false, upcoming: [{ date: "2026-07-10", event: "FOMC", days_away: 5 }] }, earnings: {} });
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

test("getFedDate: ignora un evento FED que ya pasó (days_away negativo) y devuelve el genuinamente futuro", async () => {
  resetDaily();
  checkFundamentalsImpl = async () => ({
    fed: {
      active: true,
      // orden ascendente real de checkFundamentals(): el pasado (-1) va primero
      upcoming: [
        { date: "2026-06-30", event: "FOMC pasado", days_away: -1 },
        { date: "2026-08-15", event: "FOMC futuro", days_away: 45 },
      ],
    },
    earnings: {},
  });
  await warmup(["NVDA"], {});
  assert.strictEqual(getFedDate(), "2026-08-15", "no debe devolver la reunión que ya pasó");
});

test("getFedDate: solo hay un evento pasado (-2) → devuelve null, no lo muestra como 'próximo'", async () => {
  resetDaily();
  checkFundamentalsImpl = async () => ({
    fed: { active: false, upcoming: [{ date: "2026-06-29", event: "FOMC pasado", days_away: -2 }] },
    earnings: {},
  });
  await warmup(["NVDA"], {});
  assert.strictEqual(getFedDate(), null);
});

// ─── ensureWarmedUp — reintento con cooldown si warmup() falló ─────────────────

test("ensureWarmedUp: si ya hay datos buenos, no vuelve a llamar checkFundamentals", async () => {
  resetDaily();
  checkFundamentalsImpl = async () => ({ fed: { active: false, upcoming: [] }, earnings: {} });
  await warmup(["NVDA"], {});
  mockCheckFundamentals.mock.resetCalls();

  await ensureWarmedUp(["NVDA"], {});
  assert.strictEqual(mockCheckFundamentals.mock.calls.length, 0, "ya estaba warmed up, no debe reintentar");
});

test("ensureWarmedUp: si warmup falló, reintenta (fuera del cooldown) hasta tener éxito", async (t) => {
  resetDaily();
  // Reloj mockeado ANTES del primer warmup(), para que _lastWarmupAttempt se
  // grabe con el mismo reloj que luego avanzamos con tick() — si se habilita
  // después, el mock reinicia el epoch y la resta de tiempos queda negativa.
  t.mock.timers.enable({ apis: ["Date"] });

  checkFundamentalsImpl = async () => { throw new Error("falla inicial"); };
  await warmup(["NVDA"], {});
  assert.strictEqual(getFedEarnings(), null);

  t.mock.timers.tick(11 * 60 * 1000); // pasa el cooldown de 10 min

  checkFundamentalsImpl = async () => ({ fed: { active: false, upcoming: [] }, earnings: {} });
  const result = await ensureWarmedUp(["NVDA"], {});
  assert.notStrictEqual(result, null, "debe reintentar y esta vez tener éxito");
  assert.notStrictEqual(getFedEarnings(), null);
});

test("ensureWarmedUp: dentro del cooldown, NO reintenta (evita machacar Finviz)", async (t) => {
  resetDaily();
  t.mock.timers.enable({ apis: ["Date"] });

  checkFundamentalsImpl = async () => { throw new Error("falla inicial"); };
  await warmup(["NVDA"], {});

  t.mock.timers.tick(2 * 60 * 1000); // dentro del cooldown de 10 min

  mockCheckFundamentals.mock.resetCalls();
  const result = await ensureWarmedUp(["NVDA"], {});
  assert.strictEqual(result, null);
  assert.strictEqual(mockCheckFundamentals.mock.calls.length, 0, "no debe reintentar dentro del cooldown");
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
