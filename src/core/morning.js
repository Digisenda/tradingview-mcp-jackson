/**
 * Morning brief core logic.
 * Scans watchlist across D1, H1 and M15 timeframes.
 * Returns structured multi-TF data + strategy candidates for Claude to apply
 * the 6-step premarket checklist (PASO 0–6).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as chart from "./chart.js";
import * as data from "./data.js";
import { checkFundamentals } from "./fundamental.js";
import { savePremarketSession, saveSignals } from "./supabase.js";
import { removeOne } from "./drawing.js";
import { weekDirFor } from "./paths.js";
import {
  parseNum,
  extractBB,
  extractSMAs,
  bbPosition,
  maOrder,
  screenStrategies,
} from "./signals.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../");
const SESSIONS_DIR = join(homedir(), ".tradingview-mcp", "sessions");
const USER_DATA_DIR = resolve(join(homedir(), ".tradingview-mcp"));

// ─── Helpers ─────────────────────────────────────────────────────────────────

// parseNum, extractBB, extractSMAs, bbPosition, maOrder, screenStrategies
// are imported from ./signals.js above.

function assertSafeRulesPath(p) {
  const resolved = resolve(p);
  const inProject =
    resolved === resolve(join(PROJECT_ROOT, "rules.json")) ||
    resolved.startsWith(resolve(PROJECT_ROOT) + "/");
  const inUserData = resolved.startsWith(USER_DATA_DIR + "/");
  if (!inProject && !inUserData) {
    throw new Error(
      `rules_path must live inside the project (${PROJECT_ROOT}) or ~/.tradingview-mcp/. Got: ${resolved}`,
    );
  }
}

function assertSafeDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(
      `Invalid date: ${dateStr}. Use YYYY-MM-DD (e.g. 2026-05-11).`,
    );
  }
}

function loadRules(rulesPath) {
  if (rulesPath) assertSafeRulesPath(rulesPath);
  const candidates = [
    rulesPath,
    join(PROJECT_ROOT, "rules.json"),
    join(homedir(), ".tradingview-mcp", "rules.json"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return { rules: JSON.parse(readFileSync(p, "utf8")), path: p };
      } catch (e) {
        throw new Error(`Failed to parse rules.json at ${p}: ${e.message}`);
      }
    }
  }
  throw new Error(
    "No rules.json found. Copy rules.example.json to rules.json and fill in your trading rules.\n" +
      "Looked in:\n" +
      candidates.filter(Boolean).map((p) => `  - ${p}`).join("\n"),
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runBrief({ rules_path } = {}) {
  const { rules, path: loadedFrom } = loadRules(rules_path);
  const { watchlist = [] } = rules;

  if (!watchlist.length) {
    throw new Error(
      "rules.json watchlist is empty. Add at least one symbol to your watchlist array.",
    );
  }

  // Run fundamental filters in parallel with chart state fetch
  const [fundamentalResult, chartState] = await Promise.allSettled([
    checkFundamentals(watchlist, rules),
    chart.getState(),
  ]);
  const fundamental_filters =
    fundamentalResult.status === "fulfilled" ? fundamentalResult.value : null;
  let originalSymbol, originalTimeframe;
  if (chartState.status === "fulfilled") {
    originalSymbol = chartState.value?.symbol;
    originalTimeframe = chartState.value?.resolution;
  }

  const TIMEFRAMES = [
    { key: "D1", tf: "D" },
    { key: "H1", tf: "60" },
    { key: "M15", tf: "15" },
  ];

  const results = [];

  for (const symbol of watchlist) {
    try {
      await chart.setSymbol({ symbol });
      await new Promise((r) => setTimeout(r, 900));

      let quoteData = null;
      const tfData = {};

      for (const { key, tf } of TIMEFRAMES) {
        try {
          await chart.setTimeframe({ timeframe: tf });
          await new Promise((r) => setTimeout(r, 900));

          const [indicators, quote] = await Promise.all([
            data.getStudyValues(),
            quoteData == null ? data.getQuote({}) : Promise.resolve(null),
          ]);

          if (quote?.success) quoteData = quote;

          const price = quoteData?.last ?? quoteData?.close ?? null;
          const bb = extractBB(indicators);
          const smas = extractSMAs(indicators);

          tfData[key] = {
            bb,
            smas,
            bb_position: bb ? bbPosition(price, bb) : "no_bb_detected",
            ma_order: smas.length >= 4 ? maOrder(price, smas) : "insufficient_data",
          };
        } catch (err) {
          tfData[key] = { error: err.message };
        }
      }

      const price = quoteData?.last ?? quoteData?.close ?? null;

      results.push({
        symbol,
        quote: quoteData,
        timeframes: tfData,
        strategy_candidates: screenStrategies(price, tfData),
      });
    } catch (err) {
      results.push({ symbol, error: err.message });
    }
  }

  if (originalSymbol) {
    try {
      await chart.setSymbol({ symbol: originalSymbol });
      if (originalTimeframe) await chart.setTimeframe({ timeframe: originalTimeframe });
    } catch (_) {}
  }

  return {
    success: true,
    generated_at: new Date().toISOString(),
    rules_loaded_from: loadedFrom,
    fundamental_filters,
    rules: {
      bias_criteria: rules.bias_criteria || null,
      risk_rules: rules.risk_rules || null,
      strategies: rules.strategies || null,
      notes: rules.notes || null,
    },
    symbols_scanned: results,
    instruction: [
      "ANÁLISIS PREMARKET — Aplica el checklist de 6 pasos (PASO 0–6) por ticker usando los datos multi-timeframe.",
      "FILTROS FUNDAMENTALES (verificar PRIMERO): Si fundamental_filters.fed.active=true → advertir NO operar hoy. Si fundamental_filters.earnings[ticker].active=true → advertir NO operar ese ticker. Mostrar fundamental_filters.warnings al inicio del reporte si hay alguno activo.",
      "REGLA CRÍTICA: BB es el indicador primario (50% peso). Si bb.width es muy estrecho en todos los TF = baja volatilidad = NO operar ese día.",
      "PASO 0 — Setup + chequeo volatilidad: Si bb.width estrecho en D1 Y H1 Y M15 (los 3) → plantilla 'sin condiciones operativas', saltar PASO 1-4.",
      "PASO 1 — BB Diario: clasificación y nivel [peso 50%]: bb_position='above_middle' → Middle=PISO | 'below_middle' → Middle=TECHO. Entregar nivel bb.basis en briefing.",
      "PASO 2 — BB M15: pendiente y proyección: chart_set_timeframe('15') + data_get_ohlcv(count:3) → calcular pendiente upper/lower. Entregar proyección cualitativa en briefing (sin draw_shape).",
      "PASO 3 — BB H1 + MAs H1 + H-Lines [peso 50% BB / 30% MAs]: chart_set_timeframe('60') + data_get_ohlcv(count:100) → H-Max y H-Min. Anotar máx. 2 MAs más cercanas al precio (sin draw_shape).",
      "PASO 4 — MAs D1 [peso 30%]: usar smas de timeframes.D1. Anotar máx. 2 MAs en briefing.",
      "PASO 5 — Trendline calculada + captura: desde barras OHLCV ya obtenidas (PASO 2=M15, PASO 3=H1), identificar 2-3 máximos/mínimos relevantes, ajustar línea entre 2 puntos representativos. capture_screenshot(region:'chart'). Marcar resultado: rota ✅ / no rota ❌ / sin tick 🔲.",
      "PASO 6 — Precio fresco + gap: quote_get(symbol) → verificar que time sea de HOY (Guard premercado obsoleto). Si SÍ: gap up/down/flat + comparar contra trendline PASO 5 → condiciones ✅/❌. Si NO (dato de ayer): marcar 'sin tick premercado'.",
      "ESTRATEGIAS: Reportar strategy_candidates con confidence='conditions_met' primero, luego 'setup_forming', luego 'watch'.",
      "STRAT-08/09 CT15: si aparece en candidates, advertir que trigger y confirmaciones son SOLO verificables al abrir (9:30 ET) — en vivo: gap up/down rompe PM+trendline M15 SIMULTÁNEAMENTE + BB abre. Sin gap = estrategia cancelada. Si precio abre expuesto (fuera de banda) → pasar a STRAT-04/05, no CT15. NOTA: STRAT-12/13 son Segundo Salto / Saliendo de Bollinger con Volatilidad — estrategias distintas, no relacionadas con CT15 (ver rules.json).",
      "CT15 VENTANAS de entrada (orden de potencia): V1=1ª vela M15 BB abre inmediatamente (más potente) · V2=Double Green 2ª vela cierra sobre cierre anterior · V3=BB abre ANTES de llegar al disipador. Entrar en la primera ventana que se confirme.",
      "OUTPUT: Bloque estructurado por ticker + tabla resumen con bias global y estrategias prioritarias al final.",
    ].join(" "),
  };
}

export function saveSession({ brief, date } = {}) {
  const dateStr = date || new Date().toISOString().split("T")[0];
  assertSafeDate(dateStr);
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const filePath = join(SESSIONS_DIR, `${dateStr}.json`);

  const existing = existsSync(filePath)
    ? JSON.parse(readFileSync(filePath, "utf8"))
    : {};
  const record = {
    ...existing,
    date: dateStr,
    saved_at: new Date().toISOString(),
    brief,
  };

  writeFileSync(filePath, JSON.stringify(record, null, 2));
  return { success: true, path: filePath, date: dateStr };
}

export function getSession({ date } = {}) {
  const dateStr = date || new Date().toISOString().split("T")[0];
  assertSafeDate(dateStr);
  const filePath = join(SESSIONS_DIR, `${dateStr}.json`);

  if (existsSync(filePath)) {
    return { success: true, ...JSON.parse(readFileSync(filePath, "utf8")) };
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdayPath = join(SESSIONS_DIR, `${yesterdayStr}.json`);

  if (existsSync(yesterdayPath)) {
    return {
      success: true,
      note: "No session for today — returning yesterday",
      ...JSON.parse(readFileSync(yesterdayPath, "utf8")),
    };
  }

  return {
    success: false,
    error: `No session found for ${dateStr} or ${yesterdayStr}`,
    sessions_dir: SESSIONS_DIR,
  };
}

/**
 * Normaliza el output crudo de morning_brief a un contrato explícito y estable,
 * para que dashboard.js (proceso separado, corre horas después) no dependa de la
 * forma interna de runBrief(). No hay campo "score" numérico en
 * morning_brief hoy — el 0-100% del checklist lo calcula Claude en el chat y solo
 * queda en el .md. Aquí se deriva una clasificación por tier (ejecutar/vigilar/
 * no_operar) con la misma regla que ya usaba el HTML standalone (retirado, T7) para las 3 secciones
 * del briefing (conditions_met > setup_forming > ninguno).
 */
export function normalizePremarketData(briefObj) {
  const symbols = briefObj?.symbols_scanned || [];
  return {
    generated_at: briefObj?.generated_at || new Date().toISOString(),
    fundamental_filters: briefObj?.fundamental_filters || null,
    tickers: symbols.map((sym) => {
      const cands = sym.strategy_candidates || [];
      const metCands = cands.filter((c) => c.confidence === "conditions_met");
      const formingCands = cands.filter((c) => c.confidence === "setup_forming");
      const classification = metCands.length ? "ejecutar" : formingCands.length ? "vigilar" : "no_operar";

      return {
        symbol: sym.symbol,
        price: sym.quote?.last ?? sym.quote?.close ?? null,
        classification,
        timeframes: {
          D1: { bb: sym.timeframes?.D1?.bb ?? null, ma_order: sym.timeframes?.D1?.ma_order ?? null },
          H1: { bb: sym.timeframes?.H1?.bb ?? null, ma_order: sym.timeframes?.H1?.ma_order ?? null },
          M15: { bb: sym.timeframes?.M15?.bb ?? null, ma_order: sym.timeframes?.M15?.ma_order ?? null },
        },
        candidates: cands.map((c) => ({
          id: c.id,
          position: c.position,
          confidence: c.confidence,
          note: c.note || "",
        })),
      };
    }),
  };
}

/** Save the full premarket checklist report as markdown in docs/sessions/ inside the repo.
 *  Also saves to Neon (premarket_sessions table) if DATABASE_URL is configured.
 *  If brief_data (JSON string of morning_brief output) is provided, also generates a
 *  normalized premarket-YYYY-MM-DD.json for the unified dashboard (dashboard.js) to read.
 *  (T7, 2026-07-04: el HTML standalone premarket-YYYY-MM-DD.html se retiró — el dashboard
 *  unificado del vigía, validado en vivo, lo reemplaza.) */
export async function savePremarketReport({ content, date, brief_data } = {}) {
  if (!content || typeof content !== "string") {
    throw new Error("content is required and must be a string.");
  }
  const dateStr = date || new Date().toISOString().split("T")[0];
  assertSafeDate(dateStr);

  const sessionsDir = weekDirFor(dateStr);
  mkdirSync(sessionsDir, { recursive: true });

  const mdPath = join(sessionsDir, `premarket-${dateStr}.md`);
  writeFileSync(mdPath, content, "utf8");

  let jsonPath = null;
  let briefObj = null;
  if (brief_data) {
    try {
      briefObj = typeof brief_data === "string" ? JSON.parse(brief_data) : brief_data;
    } catch (e) {
      // parse failure is non-fatal — md already saved
    }
    try {
      const normalized = normalizePremarketData(briefObj);
      jsonPath = join(sessionsDir, `premarket-${dateStr}.json`);
      writeFileSync(jsonPath, JSON.stringify(normalized, null, 2), "utf8");
    } catch (e) {
      // JSON normalization is non-fatal — md already saved (dashboard.js
      // degrades gracefully to "sin checklist hoy" when the file is missing)
    }
  }

  // Persistir sesión en Supabase
  const sbResult = await savePremarketSession(dateStr, content, briefObj).catch(() => ({ saved: false }));

  // Extraer y guardar señales de los strategy_candidates del brief
  let signalsResult = { saved: false, count: 0 };
  if (briefObj?.symbols_scanned?.length) {
    const dateNoHyphen = dateStr.replace(/-/g, "");
    const signals = [];
    for (const sym of briefObj.symbols_scanned) {
      for (const cand of sym.strategy_candidates || []) {
        if (!cand.id || !cand.position) continue;
        const stratSlug = cand.id.replace(/[^A-Z0-9]/gi, "");
        signals.push({
          signal_code: `${dateNoHyphen}-${sym.symbol}-${cand.position}-${stratSlug}`,
          date: dateStr,
          session_id: sbResult.id || null,
          ticker: sym.symbol,
          strategy: cand.id,
          side: cand.position,
          confidence: cand.confidence || null,
          note: cand.note || null,
          source: "premarket",
        });
      }
    }
    if (signals.length) {
      signalsResult = await saveSignals(signals).catch(() => ({ saved: false, count: 0 }));
    }
  }

  return {
    success: true,
    path: mdPath,
    json_path: jsonPath,
    date: dateStr,
    neon: sbResult,
    signals: signalsResult,
  };
}

// ─── Drawn lines tracking ─────────────────────────────────────────────────────

const DRAWN_LINES_FILE = join(PROJECT_ROOT, "docs", "sessions", "drawn-lines.json");

/**
 * Guarda los entity IDs de las líneas dibujadas por Claude en esta sesión.
 * Se llama AL FINAL del checklist con todas las IDs creadas.
 */
export function saveDrawnLines(entityIds = []) {
  mkdirSync(join(PROJECT_ROOT, "docs", "sessions"), { recursive: true });
  writeFileSync(DRAWN_LINES_FILE, JSON.stringify({ ids: entityIds, saved_at: new Date().toISOString() }), "utf8");
  return { success: true, saved: entityIds.length };
}

/**
 * Elimina SOLO las líneas que Claude dibujó en la sesión anterior (por entity ID guardado).
 * NO toca las líneas manuales del usuario.
 * Se llama AL INICIO del checklist, antes de dibujar nuevas líneas.
 */
export async function clearDrawnLines() {
  if (!existsSync(DRAWN_LINES_FILE)) {
    return { success: true, deleted: 0, note: "No hay líneas previas guardadas" };
  }

  let ids = [];
  try {
    const parsed = JSON.parse(readFileSync(DRAWN_LINES_FILE, "utf8"));
    ids = parsed.ids || [];
  } catch {
    return { success: true, deleted: 0, note: "Archivo de líneas inválido — ignorado" };
  }

  let deleted = 0;
  const errors = [];
  for (const id of ids) {
    try {
      await removeOne({ entity_id: id });
      deleted++;
    } catch (e) {
      errors.push(id); // La línea ya no existía — no es error crítico
    }
  }

  // Limpiar el archivo después de borrar
  try { unlinkSync(DRAWN_LINES_FILE); } catch {}

  return { success: true, deleted, skipped: errors.length, note: `${deleted} líneas previas eliminadas` };
}
