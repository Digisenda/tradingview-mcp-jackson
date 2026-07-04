// Tests de unidad para src/core/fundamental.js — FED calendar + earnings check.
// node:https está mockeado — no requiere red real. Orden de import importa:
// el mock debe registrarse ANTES de importar el módulo bajo test.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ─── Mock setup (antes de cualquier import del módulo bajo test) ──────────────

// scenarios: { calendar: { body } | { error }, earnings: { SYM: { body } | { error } },
//             byUrl: { [exactUrl]: { statusCode, headers, body } } — chequeado primero,
//             para tests que necesitan controlar respuestas por URL exacta (redirects). }
let scenarios = { calendar: { body: "" }, earnings: {}, byUrl: {} };

const mockGet = mock.fn((url, _opts, cb) => {
  let errorHandler = null;
  const req = {
    on(event, handler) {
      if (event === "error") errorHandler = handler;
      return req;
    },
  };

  const isCalendar = url.includes("/calendar");
  const symMatch = url.match(/stock\?t=([A-Z]+)/);
  const scenario = scenarios.byUrl?.[url]
    ? scenarios.byUrl[url]
    : isCalendar
      ? scenarios.calendar
      : symMatch
        ? scenarios.earnings[symMatch[1]] || { body: "" }
        : { body: "" };

  queueMicrotask(() => {
    if (scenario.error) {
      if (errorHandler) errorHandler(scenario.error);
      return;
    }
    const res = {
      statusCode: scenario.statusCode ?? 200,
      headers: scenario.headers || {},
      resume() { return res; },
      on(event, handler) {
        if (event === "data") handler(scenario.body ?? "");
        if (event === "end") handler();
        return res;
      },
    };
    cb(res);
  });

  return req;
});

await mock.module("node:https", { namedExports: { get: mockGet } });

const { checkFundamentals, parseFinvizDate, daysDiff, fetchHtml } = await import("../src/core/fundamental.js");

// ─── parseFinvizDate ───────────────────────────────────────────────────────────

test("parseFinvizDate: formato válido dentro del año actual", () => {
  const today = new Date(2026, 5, 1); // 2026-06-01
  assert.strictEqual(parseFinvizDate("Jul 29 AMC", today), "2026-07-29");
});

test("parseFinvizDate: fecha >30 días en el pasado rueda al año siguiente", () => {
  const today = new Date(2026, 5, 1); // 2026-06-01
  assert.strictEqual(parseFinvizDate("Jan 5", today), "2027-01-05");
});

test("parseFinvizDate: formato inválido devuelve null", () => {
  assert.strictEqual(parseFinvizDate("no-date-here"), null);
  assert.strictEqual(parseFinvizDate(""), null);
});

// ─── daysDiff ──────────────────────────────────────────────────────────────────

test("daysDiff: fecha futura es positiva", () => {
  const today = new Date(2026, 5, 1);
  assert.strictEqual(daysDiff("2026-06-05", today), 4);
});

test("daysDiff: fecha pasada es negativa", () => {
  const today = new Date(2026, 5, 10);
  assert.strictEqual(daysDiff("2026-06-05", today), -5);
});

test("daysDiff: hoy es 0", () => {
  const today = new Date(2026, 5, 1);
  assert.strictEqual(daysDiff("2026-06-01", today), 0);
});

// ─── checkFundamentals — FED ───────────────────────────────────────────────────

test("checkFundamentals: FED activo cuando Finviz reporta FOMC dentro de ±2 días", async () => {
  const today = new Date();
  const soonIso = new Date(today.getTime() + 1 * 86400000).toISOString();
  const calendarJson = `{"calendarId":420648,"ticker":"FDTR","event":"Fed Interest Rate Decision","category":"Interest Rate","date":"${soonIso.split(".")[0]}","importance":3}`;
  scenarios = {
    calendar: { body: calendarJson },
    earnings: {},
  };
  const result = await checkFundamentals(["SPY"], { fundamental_filters: {} });
  assert.strictEqual(result.fed.active, true);
  assert.ok(result.warnings.some((w) => w.includes("FILTRO FED ACTIVO")));
});

test("checkFundamentals: Finviz calendar inalcanzable → fallback a rules.json fed_dates", async () => {
  const today = new Date();
  const soonIso = new Date(today.getTime() + 1 * 86400000).toISOString().split("T")[0];
  scenarios = {
    calendar: { error: new Error("ECONNREFUSED") },
    earnings: {},
  };
  const rules = { fundamental_filters: { fed_dates: [soonIso] } };
  const result = await checkFundamentals(["SPY"], rules);
  assert.strictEqual(result.fed.active, true);
  assert.strictEqual(result.fed.upcoming[0].date, soonIso);
  assert.strictEqual(result.fed.upcoming[0].event, "FOMC Meeting");
});

// ─── checkFundamentals — Earnings ──────────────────────────────────────────────

test("checkFundamentals: earnings vía Finviz activo dentro de ±7 días", async () => {
  const today = new Date();
  const soon = new Date(today.getTime() + 3 * 86400000);
  const label = soon.toLocaleString("en-US", { month: "short", day: "numeric" });
  scenarios = {
    calendar: { body: "" },
    earnings: { NVDA: { body: `Earnings</a></div></td><td class="snapshot-td2"><div class="snapshot-td-content"><a href="x"><b><small class="text-2xs">${label} AMC</small></b></a></div></td>` } },
  };
  const result = await checkFundamentals(["NVDA"], { fundamental_filters: {} });
  assert.strictEqual(result.earnings.NVDA.active, true);
  assert.strictEqual(result.earnings.NVDA.source, "finviz");
});

test("checkFundamentals: Finviz earnings falla → fallback a rules.json.earnings", async () => {
  const today = new Date();
  const soonIso = new Date(today.getTime() + 3 * 86400000).toISOString().split("T")[0];
  scenarios = {
    calendar: { body: "" },
    earnings: { NVDA: { error: new Error("timeout") } },
  };
  const rules = { fundamental_filters: { earnings: { NVDA: soonIso } } };
  const result = await checkFundamentals(["NVDA"], rules);
  assert.strictEqual(result.earnings.NVDA.active, true);
  assert.strictEqual(result.earnings.NVDA.source, "rules.json");
});

test("checkFundamentals: ETFs nunca chequean earnings (ni llaman a Finviz)", async () => {
  scenarios = { calendar: { body: "" }, earnings: {} };
  mockGet.mock.resetCalls();
  const result = await checkFundamentals(["SPY"], { fundamental_filters: {} });
  assert.deepStrictEqual(result.earnings.SPY, { is_etf: true, active: false });
  const earningsCalls = mockGet.mock.calls.filter((c) => c.arguments[0].includes("stock?t="));
  assert.strictEqual(earningsCalls.length, 0);
});

test("checkFundamentals: sin datos en ningún lado → earnings null, no active", async () => {
  scenarios = { calendar: { body: "" }, earnings: { NVDA: { body: "" } } };
  const result = await checkFundamentals(["NVDA"], { fundamental_filters: {} });
  assert.strictEqual(result.earnings.NVDA.date, null);
  assert.strictEqual(result.earnings.NVDA.active, false);
});

// ─── fetchHtml — sigue redirects (hallazgo PLAUSIBLE #7 del /code-review, cerrado 2026-07-04) ──

test("fetchHtml: sigue un único redirect 301 hasta el destino final", async () => {
  scenarios = {
    calendar: { body: "" },
    earnings: {},
    byUrl: {
      "https://finviz.com/old-url": { statusCode: 301, headers: { location: "https://finviz.com/new-url" } },
      "https://finviz.com/new-url": { statusCode: 200, body: "contenido final" },
    },
  };
  const body = await fetchHtml("https://finviz.com/old-url");
  assert.strictEqual(body, "contenido final");
});

test("fetchHtml: sigue una cadena de varios redirects", async () => {
  scenarios = {
    calendar: { body: "" },
    earnings: {},
    byUrl: {
      "https://finviz.com/a": { statusCode: 301, headers: { location: "https://finviz.com/b" } },
      "https://finviz.com/b": { statusCode: 302, headers: { location: "https://finviz.com/c" } },
      "https://finviz.com/c": { statusCode: 200, body: "final tras 2 saltos" },
    },
  };
  const body = await fetchHtml("https://finviz.com/a");
  assert.strictEqual(body, "final tras 2 saltos");
});

test("fetchHtml: resuelve un Location relativo contra la URL actual", async () => {
  scenarios = {
    calendar: { body: "" },
    earnings: {},
    byUrl: {
      "https://finviz.com/old-url": { statusCode: 301, headers: { location: "/new-url" } },
      "https://finviz.com/new-url": { statusCode: 200, body: "resuelto ok" },
    },
  };
  const body = await fetchHtml("https://finviz.com/old-url");
  assert.strictEqual(body, "resuelto ok");
});

test("fetchHtml: rechaza tras exceder maxRedirects (evita loop infinito)", async () => {
  scenarios = {
    calendar: { body: "" },
    earnings: {},
    byUrl: {
      "https://finviz.com/loop-a": { statusCode: 301, headers: { location: "https://finviz.com/loop-b" } },
      "https://finviz.com/loop-b": { statusCode: 301, headers: { location: "https://finviz.com/loop-a" } },
    },
  };
  await assert.rejects(() => fetchHtml("https://finviz.com/loop-a", 6000, 2), /demasiados redirects/);
});
