/**
 * FASE 3 — Screener sin Desktop
 * Data bridge via Yahoo Finance: BB, SMAs, trendlines, backtest histórico.
 * No requiere TradingView Desktop corriendo.
 */

import { mkdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { z } from "zod";
import { bbPosition, maOrder, screenStrategies } from "../core/signals.js";
import { computeTrendlineAt } from "../core/trendline.js";
import { jsonResult } from "../tools/_format.js";

// Re-exportada para no romper imports existentes (tests/screener.test.js y
// computeIndicatorsAt más abajo) — la implementación vive en core/trendline.js
// desde 2026-07-13 para que watcher.js también pueda reusarla sin import circular
// (screener.js ya importa de signals.js).
export { computeTrendlineAt };

const CACHE_DIR = join(homedir(), ".tradingview-mcp");

// TradingView → Yahoo Finance v8 interval mapping
const TF_MAP = { D: "1d", "60": "1h", "15": "15m" };
const tvToYf = (tf) => TF_MAP[tf] ?? tf;

// TradingView index tickers → Yahoo Finance equivalents (Yahoo has no plain
// "SPX"/"NDX"/"RUT"/"DJI"). Only used for the outbound Yahoo request — the
// returned/cached `symbol` stays the original TV ticker so callers never see
// the Yahoo-specific form.
const YF_INDEX_MAP = { SPX: "^GSPC", NDX: "^NDX", RUT: "^RUT", DJI: "^DJI" };
export const mapToYahooSymbol = (symbol) => YF_INDEX_MAP[symbol] ?? symbol;

// Yahoo Finance v8 chart API — no library needed (Node 18+ native fetch)
const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

// Yahoo Finance hard limits per interval (calendar days)
const YF_MAX_DAYS = { "15m": 59, "30m": 59, "90m": 59, "1h": 729 };

// ── Pure computation functions ────────────────────────────────────────────────

/**
 * Rolling Bollinger Bands from a closes array.
 * Lookahead fix: uses slice(max(0,index-period), index) — bar at `index` excluded.
 */
export function computeBBFromBars(closes, period, index) {
  const start = Math.max(0, index - period);
  const slice = closes.slice(start, index);
  if (slice.length < period) return null;
  const basis = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - basis) ** 2, 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  const upper = parseFloat((basis + 2 * stdDev).toFixed(4));
  const lower = parseFloat((basis - 2 * stdDev).toFixed(4));
  return {
    basis: parseFloat(basis.toFixed(4)),
    upper,
    lower,
    width: parseFloat((upper - lower).toFixed(4)),
  };
}

/**
 * Rolling SMAs for multiple periods from a closes array.
 * Returns array aligned to `periods`; null if insufficient data.
 */
export function computeSMAsFromBars(closes, periods, index) {
  return periods.map((period) => {
    const start = Math.max(0, index - period);
    const slice = closes.slice(start, index);
    if (slice.length < period) return null;
    return parseFloat((slice.reduce((s, v) => s + v, 0) / slice.length).toFixed(4));
  });
}

// ── OHLCV fetch + cache ───────────────────────────────────────────────────────

async function ensureCacheDir() {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
  } catch {}
}

/**
 * Fetch OHLCV bars for symbol/tf, with file cache keyed by date.
 * Cache path: ~/.tradingview-mcp/ohlcv-{SYMBOL}-{TF}-{YYYY-MM-DD}.json
 * 500ms delay on real network calls to respect rate limits.
 *
 * `bypassCache` (default false — existing callers are unaffected) skips the
 * same-day cache read for time-sensitive rechecks (e.g. M15 SBV trigger
 * re-verified later the same day) — see momentum-scan-hibrido-yahoo-cdp.md
 * risk #4. The fresh result still overwrites the cache file, so a later
 * non-bypassed call the same day picks up the updated data.
 */
export async function fetchOHLCV(symbol, tf, days, bypassCache = false) {
  await ensureCacheDir();
  const today = new Date().toISOString().slice(0, 10);
  const yfTF = tvToYf(tf);
  const cacheFile = join(CACHE_DIR, `ohlcv-${symbol}-${yfTF}-${today}.json`);

  if (!bypassCache) {
    // Try cache hit
    try {
      const raw = await readFile(cacheFile, "utf8");
      const cached = JSON.parse(raw);
      return { ...cached, from_cache: true };
    } catch (err) {
      if (err.name === "SyntaxError") {
        await unlink(cacheFile).catch(() => {});
      }
    }
  }

  // Fetch days + warmup bars so indicators have enough history.
  // Cap by Yahoo Finance per-interval limits (15m → 59 days, 1h → 729 days).
  const warmup = yfTF === "15m" || yfTF === "30m" || yfTF === "90m" ? 10 : 200;
  const rawDays = (days ?? 90) + warmup;
  const fetchDays = YF_MAX_DAYS[yfTF] != null ? Math.min(rawDays, YF_MAX_DAYS[yfTF]) : rawDays;
  const from = new Date(Date.now() - fetchDays * 86400000);

  // Rate limit guard
  await new Promise((r) => setTimeout(r, 500));

  let result;
  try {
    result = await _doFetch(symbol, yfTF, from, tf);
  } catch (err) {
    if (err.code === "RATE_LIMIT" || err.message?.toLowerCase().includes("rate")) {
      process.stderr.write(`[screener] Rate limit hit for ${symbol}, retrying in 2s...\n`);
      await new Promise((r) => setTimeout(r, 2000));
      result = await _doFetch(symbol, yfTF, from, tf);
    } else {
      throw err;
    }
  }

  if (!result) return { error: "not found", symbol, timeframe: tf };

  // Write cache; failure is non-fatal
  try {
    await writeFile(cacheFile, JSON.stringify(result));
  } catch (writeErr) {
    process.stderr.write(`[screener] Cache write failed: ${writeErr.message}\n`);
  }

  return { ...result, from_cache: false };
}

async function _doFetch(symbol, yfTF, from, tvTF) {
  const yahooSymbol = mapToYahooSymbol(symbol);
  const p1 = Math.floor(from.getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  const url = `${YF_BASE}/${encodeURIComponent(yahooSymbol)}?period1=${p1}&period2=${p2}&interval=${yfTF}&includePrePost=false&events=div%2Csplit`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });

  if (res.status === 429) {
    const err = new Error("rate limit");
    err.code = "RATE_LIMIT";
    throw err;
  }
  if (res.status === 404 || res.status === 400) {
    return null; // symbol not found
  }
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result?.timestamp?.length) return null;

  const { timestamp, indicators } = result;
  const q = indicators?.quote?.[0] ?? {};
  const bars = timestamp
    .map((ts, i) => ({
      time: new Date(ts * 1000).toISOString(),
      open: q.open?.[i] ?? null,
      high: q.high?.[i] ?? null,
      low: q.low?.[i] ?? null,
      close: q.close?.[i] ?? null,
      volume: q.volume?.[i] ?? null,
    }))
    .filter((b) => b.close != null);

  if (!bars.length) return null;
  return { symbol, timeframe: tvTF, bars };
}

// ── Indicator computation at a bar index ──────────────────────────────────────

/**
 * Compute full indicator snapshot for one bar (lookahead-free).
 * Returns null if insufficient data for BB (period=20).
 */
function computeIndicatorsAt(bars, index) {
  if (index < 0 || index >= bars.length) return null;
  const closes = bars.map((b) => b.close);
  const bb = computeBBFromBars(closes, 20, index);
  if (!bb) return null;
  const smas = computeSMAsFromBars(closes, [20, 40, 100, 200], index);
  const price = closes[index];
  const bbPos = bbPosition(price, bb);
  const maOrd = maOrder(price, smas.filter((v) => v != null));
  const trendlineUp = computeTrendlineAt(bars, index, "up", 20);
  const trendlineDn = computeTrendlineAt(bars, index, "down", 20);
  return {
    bb,
    smas,
    bb_position: bbPos,
    ma_order: maOrd,
    price,
    trendline_up: trendlineUp,
    trendline_dn: trendlineDn,
  };
}

/**
 * Pre-compute STRAT-12 context for a D1 bar.
 * Checks tendencia_agotada (5+ consecutive same-direction bars + exhaustion)
 * and primer_salto (overnight gap in opposite direction).
 * Returns { position, tendencia_agotada, primer_salto_size, inside_bb, fed_near, earnings_near }
 * or null if conditions not met.
 *
 * Note: fed_near / earnings_near require external data — passed as params.
 */
export function computeStrat12Context(d1Bars, currentIndex, fedNear = false, earningsNear = false) {
  if (currentIndex < 6) return null;

  // Check tendencia_agotada: 5+ consecutive bars in same direction + next impulse fails new extreme
  let direction = null;
  let consecCount = 0;
  for (let k = currentIndex - 1; k >= Math.max(0, currentIndex - 8); k--) {
    const bar = d1Bars[k];
    const prev = d1Bars[k - 1];
    if (!prev) break;
    const isUp = bar.close > prev.close;
    if (k === currentIndex - 1) {
      direction = isUp ? "up" : "down";
      consecCount = 1;
    } else if ((isUp && direction === "up") || (!isUp && direction === "down")) {
      consecCount++;
    } else {
      break;
    }
  }

  if (consecCount < 5 || !direction) return null;

  // Exhaustion: last impulse does NOT make new high/low vs. the previous one
  const lastBar = d1Bars[currentIndex - 1];
  const prevBar = d1Bars[currentIndex - 2];
  const exhausted =
    direction === "up"
      ? lastBar.high < prevBar.high
      : lastBar.low > prevBar.low;

  if (!exhausted) return null;

  // primer_salto: overnight gap in OPPOSITE direction
  // gap = open[today] - close[yesterday]
  const today = d1Bars[currentIndex];
  const yesterday = d1Bars[currentIndex - 1];
  if (!today || !yesterday) return null;
  const gap = today.open - yesterday.close;
  const gapContrarian =
    (direction === "up" && gap < 0) || // downward gap after uptrend → PUT
    (direction === "down" && gap > 0);  // upward gap after downtrend → CALL

  if (!gapContrarian || Math.abs(gap) < 0.10) return null;

  const position = direction === "down" ? "CALL" : "PUT";

  return {
    position,
    tendencia_agotada: true,
    trend_direction: direction,
    primer_salto_gap: parseFloat(gap.toFixed(4)),
    fed_near: fedNear,
    earnings_near: earningsNear,
  };
}

/**
 * Unified per-bar SMA+BB history for the last `count` bars (lookahead-free,
 * same computation as computeIndicatorsAt but without trendline/ma_order).
 * Enables verifying BOTH a Bollinger-width sequence (e.g. CF-001) AND an
 * MA100/MA200 crossover + how long a precondition held (e.g. PC-001) from
 * the same array — see momentum-scan-hibrido-yahoo-cdp.md T2.
 */
export function computeIndicatorsHistoryFromBars(bars, count) {
  const closes = bars.map((b) => b.close);
  const start = Math.max(0, bars.length - count);
  const history = [];
  for (let i = start; i < bars.length; i++) {
    const bb = computeBBFromBars(closes, 20, i);
    const [sma20, sma40, sma100, sma200] = computeSMAsFromBars(closes, [20, 40, 100, 200], i);
    history.push({
      date: bars[i].time,
      sma20,
      sma40,
      sma100,
      sma200,
      bb_basis: bb?.basis ?? null,
      bb_upper: bb?.upper ?? null,
      bb_lower: bb?.lower ?? null,
      volume: bars[i].volume,
    });
  }
  return history;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get current indicators for a symbol via Yahoo Finance.
 * Scope: D1 pre-session context. Intraday has 15-min delay.
 */
export async function getIndicators(symbol, timeframe, days) {
  const resolvedDays = days ?? 90;
  const raw = await fetchOHLCV(symbol, timeframe ?? "D", resolvedDays);
  if (raw.error) return raw;

  const bars = raw.bars;
  const lastIndex = bars.length - 1;
  const current = computeIndicatorsAt(bars, lastIndex);

  if (!current) {
    return { error: "insufficient_data", symbol, timeframe, bars_fetched: bars.length };
  }

  return {
    symbol,
    timeframe: timeframe ?? "D",
    bars_fetched: bars.length,
    bars_used: Math.min(bars.length, resolvedDays),
    current,
    from_cache: raw.from_cache,
  };
}

/**
 * Batch version of getIndicators for N symbols in one call — agnostic of any
 * strategy/rules logic (no screenStrategies call, unlike screenMultiAsset).
 * Best-effort: a per-symbol failure is returned as {symbol, error} and does
 * NOT abort the batch (D1 decision, momentum-scan-hibrido-yahoo-cdp.md T1/T5).
 * `historyCount`, if set, adds a `history` array per symbol (see T2).
 * `bypassCache` forces a fresh fetch past the same-day cache (see T4/risk #4).
 */
export async function getIndicatorsBatch(symbols, timeframe, historyCount, bypassCache) {
  const tf = timeframe ?? "D";
  const results = [];
  for (const symbol of symbols) {
    try {
      const raw = await fetchOHLCV(symbol, tf, historyCount, bypassCache ?? false);
      if (raw.error) {
        results.push({ symbol, error: raw.error });
        continue;
      }

      const bars = raw.bars;
      const current = computeIndicatorsAt(bars, bars.length - 1);
      if (!current) {
        results.push({ symbol, error: "insufficient_data", bars_fetched: bars.length });
        continue;
      }

      const entry = {
        symbol,
        timeframe: tf,
        bars_fetched: bars.length,
        current,
        from_cache: raw.from_cache,
      };
      if (historyCount) {
        entry.history = computeIndicatorsHistoryFromBars(bars, historyCount);
      }
      results.push(entry);
    } catch (err) {
      results.push({ symbol, error: err.message });
    }
  }
  return results;
}

/**
 * Screen multiple tickers for strategy candidates via Yahoo Finance.
 */
export async function screenMultiAsset(symbols, strategy) {
  const results = [];
  for (const symbol of symbols) {
    try {
      const [d1Raw, h1Raw] = await Promise.all([
        fetchOHLCV(symbol, "D", 90),
        fetchOHLCV(symbol, "60", 30),
      ]);

      if (d1Raw.error || h1Raw.error) {
        results.push({ symbol, error: d1Raw.error || h1Raw.error });
        continue;
      }

      const d1 = computeIndicatorsAt(d1Raw.bars, d1Raw.bars.length - 1);
      const h1 = computeIndicatorsAt(h1Raw.bars, h1Raw.bars.length - 1);

      if (!d1 || !h1) {
        results.push({ symbol, error: "insufficient_data" });
        continue;
      }

      // Pre-compute STRAT-12 context for D1
      const strat12 = computeStrat12Context(d1Raw.bars, d1Raw.bars.length - 1);
      const d1WithCtx = { ...d1, strat12: strat12 ?? null };

      const tfData = { D1: d1WithCtx, H1: h1, M15: null };
      const candidates = screenStrategies(d1.price, tfData);
      const filtered = strategy ? candidates.filter((c) => c.id === strategy) : candidates;

      results.push({
        symbol,
        price: d1.price,
        D1: { bb: d1.bb, smas: d1.smas, bb_position: d1.bb_position, ma_order: d1.ma_order },
        H1: { bb: h1.bb, smas: h1.smas, bb_position: h1.bb_position, ma_order: h1.ma_order },
        candidates: filtered,
      });
    } catch (err) {
      results.push({ symbol, error: err.message });
    }
  }
  return results;
}

/**
 * Run a historical backtest for a symbol across one or all strategies.
 * M15 data limited to ~60 days (Yahoo Finance constraint).
 */
export async function runBacktest(symbol, strategy, dateRange) {
  const { from: fromStr, to: toStr } = dateRange;
  const fromDate = new Date(fromStr);
  const toDate = toStr ? new Date(toStr) : new Date();
  const diffDays = Math.ceil((toDate - fromDate) / 86400000);

  const m15Days = Math.min(diffDays + 10, 60);
  const d1Days = diffDays + 200;

  const [d1Raw, h1Raw, m15Raw] = await Promise.all([
    fetchOHLCV(symbol, "D", d1Days),
    fetchOHLCV(symbol, "60", Math.min(diffDays + 30, 365)),
    fetchOHLCV(symbol, "15", m15Days),
  ]);

  if (d1Raw.error) return { symbol, strategy: strategy ?? "all", error: d1Raw.error };

  const d1Bars = d1Raw.bars;
  const h1Bars = h1Raw.error ? [] : h1Raw.bars;
  const m15Bars = m15Raw.error ? [] : m15Raw.bars;
  const dataLimitedTo = m15Bars.length > 0 && diffDays > 60 ? 60 : null;

  // Use M15 bars as iteration basis; fall back to D1
  const iterBars =
    m15Bars.length > 0
      ? m15Bars.filter((b) => {
          const t = new Date(b.time);
          return t >= fromDate && t <= toDate;
        })
      : d1Bars.filter((b) => {
          const t = new Date(b.time);
          return t >= fromDate && t <= toDate;
        });

  const signals = [];

  for (let i = 1; i < iterBars.length; i++) {
    const bar = iterBars[i];
    const barTime = new Date(bar.time);
    const barDateStr = barTime.toISOString().slice(0, 10);

    // Find last D1 bar on or before this bar's date
    const d1Idx = findLastIndexBefore(d1Bars, (b) => b.time.slice(0, 10) <= barDateStr);
    if (d1Idx < 1) continue;

    // Find last H1 bar at or before this bar's timestamp
    const h1Idx = h1Bars.length > 0 ? findLastIndexBefore(h1Bars, (b) => new Date(b.time) <= barTime) : -1;

    // Compute indicators (lookahead-free)
    const d1Ind = computeIndicatorsAt(d1Bars, d1Idx);
    const h1Ind = h1Idx >= 0 ? computeIndicatorsAt(h1Bars, h1Idx) : null;

    if (!d1Ind) continue;

    // M15 indicators for current bar
    const m15IdxInFull = m15Bars.length > 0 ? m15Bars.indexOf(bar) : -1;
    const m15Ind = m15IdxInFull > 0 ? computeIndicatorsAt(m15Bars, m15IdxInFull) : null;
    // Previous M15 bar width for STRAT-13
    const m15PrevInd = m15IdxInFull > 1 ? computeIndicatorsAt(m15Bars, m15IdxInFull - 1) : null;

    // Pre-compute STRAT-12 context
    const strat12 = computeStrat12Context(d1Bars, d1Idx);
    const d1WithCtx = {
      ...d1Ind,
      strat12: strat12 ?? null,
    };

    // Attach bb_prev_width for STRAT-13
    const m15WithCtx = m15Ind
      ? { ...m15Ind, bb_prev_width: m15PrevInd?.bb?.width ?? null }
      : null;

    const tfData = {
      D1: d1WithCtx,
      H1: h1Ind ?? d1Ind,
      M15: m15WithCtx,
    };

    const candidates = screenStrategies(bar.close, tfData, barTime);
    const filtered = strategy ? candidates.filter((c) => c.id === strategy) : candidates;

    if (filtered.length > 0) {
      signals.push({
        date: bar.time,
        price: bar.close,
        bar_context: {
          bb: m15WithCtx?.bb ?? d1Ind.bb,
          smas: m15WithCtx?.smas ?? d1Ind.smas,
          bb_position: m15WithCtx?.bb_position ?? d1Ind.bb_position,
          ma_order: m15WithCtx?.ma_order ?? d1Ind.ma_order,
        },
        candidates: filtered,
      });
    }
  }

  return {
    symbol,
    strategy: strategy ?? "all",
    period_requested: { from: fromStr, to: toStr ?? new Date().toISOString().slice(0, 10) },
    period_actual: {
      from: iterBars[0]?.time ?? fromStr,
      to: iterBars[iterBars.length - 1]?.time ?? (toStr ?? ""),
    },
    data_limited_to_days: dataLimitedTo,
    strategies_not_covered: [],
    signal_count: signals.length,
    signals,
    note: dataLimitedTo
      ? `M15 data limited to ~${dataLimitedTo} days (Yahoo Finance constraint)`
      : "",
  };
}

function findLastIndexBefore(arr, predicate) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}

// ── MCP tool registration ──────────────────────────────────────────────────────

export function registerScreenerTools(server) {
  server.tool(
    "screener_get_indicators",
    "Get current BB, SMAs, trendlines and indicator values for a symbol via Yahoo Finance. No TradingView Desktop required. Best used for D1 pre-session context (intraday has 15-min delay).",
    {
      symbol: z.string().describe('Ticker symbol (e.g. "NVDA", "TSLA")'),
      timeframe: z
        .string()
        .optional()
        .describe('Timeframe: "D" (daily), "60" (1h), "15" (15m). Default: "D"'),
      days: z.number().optional().describe("Number of bars to analyze. Default: 90"),
    },
    async ({ symbol, timeframe, days }) => {
      try {
        return jsonResult(await getIndicators(symbol, timeframe, days));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "screener_get_indicators_batch",
    "Batch version of screener_get_indicators for MULTIPLE symbols in a single MCP round-trip via Yahoo Finance. No TradingView Desktop required, no 300-bar cap. Agnostic of any strategy/rules logic (screenStrategies is NOT applied here) — returns raw current + optional history indicators per symbol; the caller (e.g. rules.yaml) decides what they mean. Best-effort: a per-symbol failure is returned as {symbol, error} without aborting the rest of the batch. Index tickers SPX/NDX/RUT/DJI are auto-mapped to their Yahoo equivalents (^GSPC/^NDX/^RUT/^DJI).",
    {
      symbols: z.array(z.string()).describe('List of ticker symbols (e.g. ["AMD", "MU", "SNDK"])'),
      timeframe: z
        .string()
        .optional()
        .describe('Timeframe: "D" (daily), "60" (1h), "15" (15m). Default: "D"'),
      history_count: z
        .number()
        .optional()
        .describe(
          "If set, also returns a `history` array of the last N bars per symbol, each with " +
            "{date, sma20, sma40, sma100, sma200, bb_basis, bb_upper, bb_lower, volume} — use " +
            "to locate an exact MA crossover (e.g. PC-001) or a Bollinger width sequence (e.g. CF-001).",
        ),
      bypass_cache: z
        .boolean()
        .optional()
        .describe(
          "Skip the same-day disk cache and force a fresh fetch. Use for time-sensitive " +
            "rechecks (e.g. M15 SBV trigger re-verified later the same day); leave false/omit " +
            "for structural D1/H1 scans, which should use the normal same-day cache.",
        ),
    },
    async ({ symbols, timeframe, history_count, bypass_cache }) => {
      try {
        return jsonResult(await getIndicatorsBatch(symbols, timeframe, history_count, bypass_cache));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "screener_scan_multi",
    "Screen multiple tickers for strategy candidates via Yahoo Finance. No TradingView Desktop required. Returns BB, SMA order and strategy_candidates per ticker.",
    {
      symbols: z.array(z.string()).describe("List of ticker symbols"),
      strategy: z
        .string()
        .optional()
        .describe('Filter to a specific strategy ID (e.g. "STRAT-03"). Omit for all.'),
    },
    async ({ symbols, strategy }) => {
      try {
        return jsonResult(await screenMultiAsset(symbols, strategy));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );

  server.tool(
    "screener_run_backtest",
    "Run a historical backtest for a symbol and strategy via Yahoo Finance. D1/H1 supports >2 years of history; M15 is limited to ~60 days.",
    {
      symbol: z.string().describe("Ticker symbol"),
      strategy: z
        .string()
        .optional()
        .describe('Strategy ID to filter (e.g. "STRAT-08"). Omit for all strategies.'),
      from: z.string().describe("Start date ISO format (YYYY-MM-DD)"),
      to: z.string().optional().describe("End date ISO format. Default: today"),
    },
    async ({ symbol, strategy, from, to }) => {
      try {
        return jsonResult(await runBacktest(symbol, strategy, { from, to }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
