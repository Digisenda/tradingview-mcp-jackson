import CDP from 'chrome-remote-interface';

let client = null;
let targetInfo = null;
let pinnedChartId = null;
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

// ─── Tab pinning ────────────────────────────────────────────────────────────
// With multiple TradingView tabs open at once (e.g. two for manual trading +
// one dedicated to a long-running process like watcher.js), every chart tab's
// URL matches the same /tradingview\.com\/chart/ pattern — there is no way to
// tell them apart by URL shape alone. Without pinning, whichever tab happens
// to be first in CDP's /json/list gets silently adopted and driven for the
// entire process lifetime, which can mean reading (and mutating, via
// chart.setSymbol) someone else's live manual-trading tab instead of the
// intended one. Call pinToChartId() once at process startup (e.g. watcher.js)
// with the chart_id segment from that tab's URL (tab_list already extracts
// it) to force every connect/reconnect to target that exact tab, and fail
// loudly instead of guessing if it isn't found.
export function pinToChartId(chartId) {
  pinnedChartId = chartId || null;
  // Force a fresh connect on the next call so the pin takes effect immediately
  // even if a client is already connected to a different (unpinned) target.
  if (client) {
    try { client.close(); } catch {}
  }
  client = null;
  targetInfo = null;
}

export function getPinnedChartId() {
  return pinnedChartId;
}

function extractChartId(url) {
  return url.match(/\/chart\/([^/?]+)/)?.[1] || null;
}

/** Pure selection logic — exported for unit testing without a live CDP connection. */
export function selectChartTarget(targets, pinnedId = pinnedChartId) {
  const pages = targets.filter((t) => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url));

  if (pinnedId) {
    const pinned = pages.find((t) => extractChartId(t.url) === pinnedId);
    if (pinned) return pinned;
    const available = pages
      .map((t) => `${extractChartId(t.url) || '?'} (${t.title})`)
      .join(', ') || 'ninguna';
    throw new Error(
      `Pestaña anclada no encontrada (chart_id=${pinnedId}). Pestañas TradingView abiertas: ${available}. ` +
      `Verifica que esa pestaña sigue abierta o reconfigura VIGIA_CHART_ID.`
    );
  }

  // Con 2+ pestañas de chart abiertas y sin pin, NO hay forma fiable de saber cuál es la
  // "correcta" — adoptar silenciosamente pages[0] fue la causa raíz de mutar/leer la pestaña
  // de trading manual de otro proceso (ver bug 2026-08-07: momentum-scan mutó una pestaña
  // manual porque cayó en pages[0] sin pin). Fallar alto en vez de adivinar.
  if (pages.length > 1) {
    const available = pages
      .map((t) => `${extractChartId(t.url) || '?'} (${t.title})`)
      .join(', ');
    throw new Error(
      `${pages.length} pestañas de TradingView abiertas y ninguna anclada — no se puede elegir ` +
      `una sin ambigüedad. Pestañas disponibles: ${available}. Usa la herramienta chart_pin_tab ` +
      `con el chart_id de la pestaña correcta antes de continuar (o abre una pestaña nueva ` +
      `dedicada con tab_new y ánclala).`
    );
  }

  return pages[0]
    || targets.find((t) => t.type === 'page' && /tradingview/i.test(t.url))
    || null;
}

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

export async function getClient() {
  if (client) {
    try {
      // Quick liveness check
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findChartTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  return selectChartTarget(targets);
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
