/**
 * Morning brief core logic.
 * Scans watchlist across D1, H1 and M15 timeframes.
 * Returns structured multi-TF data + strategy candidates for Claude to apply
 * the full 7-step premarket checklist.
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
      "ANÁLISIS PREMARKET — Aplica el checklist de 7 pasos por ticker usando los datos multi-timeframe.",
      "FILTROS FUNDAMENTALES (verificar PRIMERO): Si fundamental_filters.fed.active=true → advertir NO operar hoy. Si fundamental_filters.earnings[ticker].active=true → advertir NO operar ese ticker. Mostrar fundamental_filters.warnings al inicio del reporte si hay alguno activo.",
      "REGLA CRÍTICA: BB es el indicador primario (50% peso). Si bb.width es muy estrecho en todos los TF = baja volatilidad = NO operar ese día.",
      "PASO 1 — BB D1: bb_position='above_middle' → Middle=PISO | 'below_middle' → Middle=TECHO. Anotar nivel bb.basis.",
      "PASO 2 — BB H1: evaluar bb_position H1. Middle H1 = punto de rebote intraday. Anotar si es techo o piso.",
      "PASO 3 — MAs D1 (peso 30%): usar ma_order para tendencia. MAs a favor tendencia = rebotes. MAs en contra = continuación.",
      "PASO 4 — MAs H1: tendencia corto plazo, rebote más cercano, indicar máx/mín reciente (requiere data_get_ohlcv en H1).",
      "PASO 5 — Trendlines: indicar al usuario trazar manualmente en gráfico BB H1.",
      "PASO 6 — Bid/Ask: recordar verificar spread antes de entrar.",
      "PASO 7 — Premarket: usar quote.last para precio. Estimar gap up/down/flat.",
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

/** Escape HTML special characters */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Generate a self-contained HTML dashboard from morning_brief structured data */
export function generateHtml(briefData, date) {
  const { fundamental_filters, symbols_scanned = [] } = briefData;
  const dateStr = date || new Date().toISOString().split("T")[0];

  // ── Fundamental status ───────────────────────────────────────────────────────
  const fedActive = fundamental_filters?.fed?.active;
  const fedLabel = fedActive ? "⚠️ FED HOY" : "✓ FED OK";
  const fedCls = fedActive ? "text-red-400" : "text-green-400";

  const earningsActive = Object.entries(fundamental_filters?.earnings || {})
    .filter(([, v]) => v.active)
    .map(([k]) => k);
  const earnLabel = earningsActive.length
    ? `⚠️ EARN: ${earningsActive.join(", ")}`
    : "✓ EARN OK";
  const earnCls = earningsActive.length ? "text-red-400" : "text-green-400";

  const fundamentalWarnings = fundamental_filters?.warnings || [];

  // ── Daily strategies map (para Schwab auto-suggest) ─────────────────────────
  const dailyStrategiesJson = JSON.stringify(
    Object.fromEntries(
      symbols_scanned.map((sym) => [
        sym.symbol,
        (sym.strategy_candidates || []).map((c) => ({
          id: c.id,
          position: c.position,
          confidence: c.confidence,
          note: c.note || "",
        })),
      ])
    )
  );

  // ── Asset config (prima ranges) ──────────────────────────────────────────────
  let assetConfig = {};
  try { assetConfig = loadRules()?.rules?.asset_config || {}; } catch { /* ignore */ }

  function primaLabel(symbol) {
    const ac = assetConfig[symbol];
    if (!ac?.premium_range_optimal) return "—";
    const min = (ac.premium_range_optimal.min / 100).toFixed(2);
    const max = (ac.premium_range_optimal.max / 100).toFixed(2);
    return `$${min}–$${max}`;
  }

  // ── Classify tickers into briefing sections ───────────────────────────────────
  const bEjecutar = [];  // { sym, cand }
  const bVigilar  = [];  // { sym, cand }
  const bNoOperar = [];  // { symbol, reason, price }

  for (const sym of symbols_scanned) {
    const tickerEarn = fundamental_filters?.earnings?.[sym.symbol];
    const earnBlocked = tickerEarn?.active;
    const fedBlocked  = fundamental_filters?.fed?.active;

    // Veto FED/Earnings: NO colapsa a 🔴 automático. Se muestra el score técnico
    // real con advertencia ⚠️ visible en la línea del ticker — el operador decide.
    const warnings = [];
    if (earnBlocked) warnings.push(`EARNINGS ${tickerEarn.date}`);
    if (fedBlocked)  warnings.push("FED activo");

    const cands = sym.strategy_candidates || [];
    const metCands     = cands.filter((c) => c.confidence === "conditions_met");
    const formingCands = cands.filter((c) => c.confidence === "setup_forming");

    if (metCands.length > 0) {
      for (const cand of metCands) bEjecutar.push({ sym, cand, warnings });
    } else if (formingCands.length > 0) {
      for (const cand of formingCands) bVigilar.push({ sym, cand, warnings });
    } else {
      const best = cands[0];
      const reasonParts = [best ? `${best.id} ${best.position} — condiciones no alcanzadas` : "Sin setup identificado"];
      if (warnings.length) reasonParts.push(warnings.join(" · "));
      bNoOperar.push({
        symbol: sym.symbol,
        reason: reasonParts.join(" · "),
        price: sym.quote?.last ?? sym.quote?.close,
      });
    }
  }

  // ── Condition chips builder ───────────────────────────────────────────────────
  function buildCondHtml(sym, cand) {
    const d1  = sym.timeframes?.D1  || {};
    const h1  = sym.timeframes?.H1  || {};
    const m15 = sym.timeframes?.M15 || {};
    const pos = cand.position; // "CALL" | "PUT"
    const items = [];

    if (cand.id === "STRAT-08" || cand.id === "STRAT-09") {
      // PC-003: precio dentro de BB M15 (no expuesto)
      const m15Pos = m15.bb_position;
      const m15Inside = m15Pos != null && !["above_upper", "below_lower"].includes(m15Pos);
      items.push({ ok: m15Inside || null, label: "M15 dentro BB (no expuesto)" });

      // PC-002: cuerpo último cierre bajo/sobre PM M15
      if (pos === "CALL") {
        items.push({ ok: m15Pos === "below_middle" || null, label: "M15 cierre bajo PM" });
      } else {
        items.push({ ok: m15Pos === "above_middle" || null, label: "M15 cierre sobre PM" });
      }

      // PC-001/PC-005 proxy: contexto D1
      const d1Bear = ["below_middle", "below_lower"].includes(d1.bb_position);
      const d1Bull = ["above_middle", "above_upper"].includes(d1.bb_position);
      if (pos === "CALL") items.push({ ok: d1Bear || null, label: "D1 bajista" });
      else                items.push({ ok: d1Bull || null, label: "D1 alcista" });

      // PC-001/PC-005 proxy: contexto H1
      const h1Bear = ["below_middle", "below_lower"].includes(h1.bb_position);
      const h1Bull = ["above_middle", "above_upper"].includes(h1.bb_position);
      if (pos === "CALL") items.push({ ok: h1Bear || null, label: "H1 bajista" });
      else                items.push({ ok: h1Bull || null, label: "H1 alcista" });

      // TR-001 + CF-001/002/003: solo verificables al abrir — siempre pendiente
      items.push({ ok: null, label: pos === "CALL" ? "Gap up rompe PM+trendline" : "Gap down rompe PM+trendline" });
      items.push({ ok: null, label: "BB abre 1ª~3ª vela M15" });

    } else {
      // Chips genéricos para STRAT-01~11
      const d1Bull = ["above_middle", "above_upper"].includes(d1.bb_position);
      const d1Bear = ["below_middle", "below_lower"].includes(d1.bb_position);
      if (pos === "CALL" && d1Bull)      items.push({ ok: true,  label: "BB D1 alcista" });
      else if (pos === "PUT" && d1Bear)  items.push({ ok: true,  label: "BB D1 bajista" });
      else                               items.push({ ok: false, label: "BB D1 dirección" });

      const maAlc = ["alcista", "mixto_alcista"].includes(d1.ma_order);
      const maBaj = ["bajista", "mixto_bajista"].includes(d1.ma_order);
      if (pos === "CALL" && maAlc)       items.push({ ok: true,  label: "MAs D1 ↑" });
      else if (pos === "PUT" && maBaj)   items.push({ ok: true,  label: "MAs D1 ↓" });
      else                               items.push({ ok: false, label: "MAs D1 alineación" });

      const m15w = m15.bb?.width;
      if (m15w != null) {
        if (m15w < 6) items.push({ ok: true,  label: `BB M15 comprimido (${m15w.toFixed(1)})` });
        else          items.push({ ok: false, label: `BB M15 ancho (${m15w.toFixed(1)})` });
      }

      items.push({ ok: null, label: "Vol M15 sube al abrir" });
      items.push({ ok: null, label: pos === "CALL" ? "PM virar al alza" : "PM virar a la baja" });
    }

    return items.map((item) => {
      let icon, cls;
      if (item.ok === true)        { icon = "✅"; cls = "text-green-400"; }
      else if (item.ok === false)  { icon = "🔲"; cls = "text-gray-500"; }
      else                         { icon = "🔲"; cls = "text-yellow-500"; }
      return `<span class="${cls} text-xs whitespace-nowrap">${icon} ${esc(item.label)}</span>`;
    }).join("");
  }

  function stratRowHtml(entry, urgency) {
    const { sym, cand, warnings } = entry;
    const price = sym.quote?.last ?? sym.quote?.close;
    const prima = primaLabel(sym.symbol);
    const posCls  = cand.position === "CALL" ? "text-green-400" : "text-red-400";
    const rowBg   = urgency === "ejecutar" ? "border-green-900/50" : "border-yellow-900/40";
    const rowInner = urgency === "ejecutar" ? "#0c1a0c" : "#171200";
    const condHtml = buildCondHtml(sym, cand);
    const noteHtml = cand.note
      ? `<div class="text-gray-500 text-xs mt-1 truncate">${esc(cand.note)}</div>` : "";
    const warnHtml = warnings?.length
      ? `<span class="text-red-400 text-xs font-bold">⚠️ ${esc(warnings.join(" · "))}</span>` : "";

    return `
    <div class="rounded-lg p-3 mb-2 border ${rowBg}" style="background:${rowInner}">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        <span class="font-bold text-white text-sm">${esc(sym.symbol)}</span>
        <span class="font-bold ${posCls} text-sm">${esc(cand.position)}</span>
        <span class="text-orange-300 text-xs font-bold bg-orange-900/40 px-1.5 py-0.5 rounded">${esc(cand.id)}</span>
        ${warnHtml}
        <span class="ml-auto text-xs text-gray-400">Prima: <span class="text-white font-bold">${prima}</span></span>
        <span class="text-red-400 text-xs">Stop <span class="font-bold">−25%</span></span>
        <span class="text-green-400 text-xs">Target <span class="font-bold">+12%</span></span>
        ${price != null ? `<span class="text-gray-600 text-xs font-mono">$${Number(price).toFixed(2)}</span>` : ""}
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1">${condHtml}</div>
      ${noteHtml}
    </div>`;
  }

  // ── Build briefing HTML ───────────────────────────────────────────────────────
  const ejecutarHtml = bEjecutar.length
    ? bEjecutar.map((e) => stratRowHtml(e, "ejecutar")).join("")
    : `<div class="text-gray-600 text-xs py-2 pl-1">Sin setups listos para ejecutar hoy</div>`;

  const vigilarHtml = bVigilar.length
    ? bVigilar.map((e) => stratRowHtml(e, "vigilar")).join("")
    : `<div class="text-gray-600 text-xs py-2 pl-1">Sin setups en formación</div>`;

  const noOperarHtml = bNoOperar.length
    ? bNoOperar.map((e) => `
      <div class="flex items-baseline gap-2 py-1 border-b border-gray-800/50 last:border-0 text-xs">
        <span class="font-bold text-gray-400 w-12 flex-shrink-0">${esc(e.symbol)}</span>
        ${e.price != null ? `<span class="text-gray-600 font-mono">$${Number(e.price).toFixed(2)}</span>` : ""}
        <span class="text-gray-500">→ ${esc(e.reason)}</span>
      </div>`).join("")
    : `<div class="text-gray-600 text-xs py-2 pl-1">Todos los tickers tienen setup activo</div>`;

  const briefingSection = `
  <!-- BRIEFING PREMARKET -->
  <div class="rounded-lg border border-gray-800 mb-4 overflow-hidden" style="background:#080d14">
    ${fundamentalWarnings.length ? `
    <div class="px-4 py-2.5 border-b border-red-900/60" style="background:#1a0505">
      <div class="text-red-400 font-bold text-xs tracking-wide">⚠️ ADVERTENCIA DEL DÍA · ${fundamentalWarnings.map((w) => esc(w)).join(" · ")}</div>
    </div>` : ""}

    <div class="p-4 border-b border-gray-800/60">
      <div class="text-green-400 font-bold text-xs tracking-widest mb-3">🟢 EJECUTAR AL ABRIR</div>
      ${ejecutarHtml}
    </div>

    <div class="p-4 border-b border-gray-800/60">
      <div class="text-yellow-400 font-bold text-xs tracking-widest mb-3">🟡 VIGILAR — falta confirmación al abrir</div>
      ${vigilarHtml}
    </div>

    <div class="p-4">
      <div class="text-red-400 font-bold text-xs tracking-widest mb-3">🔴 NO OPERAR</div>
      ${noOperarHtml}
    </div>
  </div>`;

  // ── Full HTML ─────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Premarket ${dateStr}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen p-4 font-mono text-gray-100" style="background:#030712">

  <!-- BANNER SESIÓN -->
  <div class="flex flex-wrap items-center justify-between rounded-lg p-3 mb-4 border border-gray-800" style="background:#111827">
    <div>
      <span class="text-gray-400 text-sm">PREMARKET</span>
      <span class="text-white font-bold ml-2">${dateStr}</span>
      <span class="text-gray-600 ml-4 text-sm" id="et-time">—</span>
    </div>
    <div class="flex gap-4 text-sm mt-1">
      <span class="${fedCls} font-bold">${fedLabel}</span>
      <span class="${earnCls} font-bold">${earnLabel}</span>
      <span id="session-status" class="font-bold text-gray-400">—</span>
    </div>
  </div>

  ${briefingSection}

  <!-- IMPORTAR DESDE SCHWAB -->
  <div id="schwab-section" class="rounded-lg p-4 border border-blue-900/40 mb-3" style="background:#0a1628">
    <div class="flex items-center justify-between mb-3">
      <div class="text-blue-400 text-sm font-bold">📷 IMPORTAR DESDE SCHWAB</div>
      <div id="watcher-status" class="text-xs font-mono px-2 py-0.5 rounded" style="background:#111827">
        <span class="text-gray-600">○ verificando...</span>
      </div>
    </div>
    <label id="schwab-dropzone"
      class="flex items-center justify-center border-2 border-dashed border-gray-700 rounded-lg p-5 cursor-pointer transition-colors"
      style="background:#111827">
      <input type="file" id="schwab-file" accept="image/*" class="hidden">
      <div id="schwab-idle" class="text-center pointer-events-none">
        <div class="text-2xl mb-1">📥</div>
        <div class="text-gray-400 text-xs">Arrastra captura de Schwab aquí · o haz clic para seleccionar</div>
        <div class="text-gray-600 text-xs mt-1">PNG · JPG · GIF</div>
      </div>
    </label>
    <div id="schwab-ready" class="hidden mt-3 flex gap-3 items-center">
      <img id="schwab-thumb" class="w-20 h-14 object-cover rounded border border-gray-700 flex-shrink-0" src="" alt="preview">
      <div class="flex-1 min-w-0">
        <div id="schwab-fname" class="text-xs text-gray-300 truncate font-mono"></div>
        <div id="schwab-analyze-status" class="text-xs text-gray-500 mt-0.5"></div>
      </div>
      <button onclick="analyzeSchwabImage()" id="schwab-btn"
        class="px-3 py-2 rounded text-xs font-bold text-white flex-shrink-0 hover:opacity-90 transition"
        style="background:#1d4ed8">
        🔍 Analizar
      </button>
    </div>
    <div id="schwab-extracted" class="hidden mt-3 rounded p-3 border border-green-900/50 text-xs" style="background:#071a07">
      <div class="text-green-400 font-bold mb-2">✓ Campos extraídos — revisa y confirma</div>
      <div id="schwab-extracted-fields" class="grid grid-cols-4 gap-2 text-gray-300 mb-3"></div>
      <button onclick="fillFormFromSchwab()"
        class="w-full py-1.5 rounded text-xs font-bold text-white hover:opacity-90 transition"
        style="background:#16a34a">
        ↓ Rellenar formulario con estos datos
      </button>
    </div>
  </div>

  <!-- LOG TRADE -->
  <div class="rounded-lg p-4 border border-gray-800" style="background:#111827">
    <div class="text-gray-400 text-sm font-bold mb-3">📝 LOG TRADE</div>
    <form id="trade-form" onsubmit="submitTrade(event)">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label class="text-xs text-gray-500 block mb-1">TICKER</label>
          <select id="t-ticker" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
            ${symbols_scanned.map(s => `<option value="${s.symbol}">${s.symbol}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">SEÑAL / ESTRATEGIA</label>
          <select id="t-strategy" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
            <option value="">— seleccionar —</option>
            <option>STRAT-01</option><option>STRAT-02</option><option>STRAT-03</option>
            <option>STRAT-04</option><option>STRAT-05</option><option>STRAT-08</option>
            <option>STRAT-09</option><option>STRAT-10</option><option>STRAT-11</option>
            <option>STRAT-12</option><option>STRAT-13</option>
          </select>
          <input type="hidden" id="t-signal-code" value="">
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">LADO</label>
          <select id="t-side" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
            <option value="CALL">CALL</option><option value="PUT">PUT</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">MODO</label>
          <select id="t-mode" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
            <option value="paper">PAPER</option><option value="real">REAL</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <div>
          <label class="text-xs text-gray-500 block mb-1">STRIKE</label>
          <input id="t-strike" type="number" step="0.5" placeholder="0.00" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">EXPIRACIÓN</label>
          <input id="t-expiry" type="date" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">PRIMA ENTRADA</label>
          <input id="t-entry" type="number" step="0.01" placeholder="0.00" oninput="calcResult()" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">PRIMA SALIDA</label>
          <input id="t-exit" type="number" step="0.01" placeholder="0.00" oninput="calcResult()" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
        </div>
        <div>
          <label class="text-xs text-gray-500 block mb-1">CONTRATOS</label>
          <input id="t-contracts" type="number" value="1" min="1" class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3 mb-3">
        <div class="rounded p-2 text-center border border-gray-700" style="background:#1f2937">
          <div class="text-xs text-gray-400 mb-1">RESULTADO %</div>
          <div id="t-result-display" class="font-bold text-lg text-gray-400">—</div>
        </div>
        <div class="col-span-2">
          <label class="text-xs text-gray-500 block mb-1">NOTAS</label>
          <input id="t-notes" type="text" placeholder="Contexto, setup, condiciones..." class="w-full rounded px-2 py-1.5 text-white text-sm border border-gray-700 focus:outline-none" style="background:#1f2937">
        </div>
      </div>
      <button type="submit" class="w-full rounded py-2 text-sm font-bold text-white hover:opacity-90 transition" style="background:#2563eb">
        GUARDAR TRADE
      </button>
    </form>
    <div id="trade-msg" class="text-xs mt-2 text-center hidden"></div>
  </div>

  <!-- POSICIONES ABIERTAS -->
  <div id="open-positions-section" class="rounded-lg p-4 border border-yellow-900/40 mb-3" style="background:#111822">
    <div class="flex justify-between items-center mb-3">
      <div class="text-yellow-400 text-sm font-bold">🟡 POSICIONES ABIERTAS</div>
      <button onclick="loadOpenPositions()" class="text-xs text-yellow-500 hover:text-yellow-300">↻ Actualizar</button>
    </div>
    <div id="open-positions-body" class="text-xs text-gray-500">Cargando...</div>
  </div>

  <!-- HISTORIAL RECIENTE -->
  <div class="rounded-lg p-4 border border-gray-800" style="background:#111827">
    <div class="flex justify-between items-center mb-3">
      <div class="text-gray-400 text-sm font-bold">📊 HISTORIAL RECIENTE</div>
      <button onclick="loadTrades()" class="text-xs text-blue-400 hover:text-blue-300">↻ Recargar</button>
    </div>
    <div id="trades-table" class="text-xs text-gray-500">Cargando...</div>
  </div>

  <!-- CALCULADORA BID/ASK -->
  <div class="rounded-lg p-4 border border-gray-800" style="background:#111827">
    <div class="text-gray-400 text-sm font-bold mb-3">CALCULADORA BID/ASK</div>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
      <div>
        <label class="text-xs text-gray-500 block mb-1">BID</label>
        <input id="bid" type="number" step="0.01" min="0" placeholder="0.00"
          class="w-full rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 border border-gray-700" style="background:#1f2937"
          oninput="calc()">
      </div>
      <div>
        <label class="text-xs text-gray-500 block mb-1">ASK</label>
        <input id="ask" type="number" step="0.01" min="0" placeholder="0.00"
          class="w-full rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 border border-gray-700" style="background:#1f2937"
          oninput="calc()">
      </div>
      <div>
        <label class="text-xs text-gray-500 block mb-1">CONTRATOS</label>
        <input id="contracts" type="number" value="1" min="1" placeholder="1"
          class="w-full rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 border border-gray-700" style="background:#1f2937"
          oninput="calc()">
      </div>
      <div>
        <label class="text-xs text-gray-500 block mb-1">INVERSIÓN</label>
        <span id="inversion" class="block text-white text-sm mt-1.5 font-bold">—</span>
      </div>
    </div>
    <div class="grid grid-cols-3 gap-3">
      <div class="rounded p-2 text-center border border-gray-700" style="background:#1f2937">
        <div class="text-xs text-gray-400 mb-1">MID</div>
        <div id="mid" class="text-white font-bold text-lg">—</div>
      </div>
      <div class="rounded p-2 text-center border border-red-900" style="background:#1a0a0a">
        <div class="text-xs text-red-400 mb-1">STOP −25%</div>
        <div id="stop" class="text-red-400 font-bold text-lg">—</div>
        <div id="stop-usd" class="text-xs text-red-500 mt-0.5">—</div>
      </div>
      <div class="rounded p-2 text-center border border-green-900" style="background:#0a1a0a">
        <div class="text-xs text-green-400 mb-1">TARGET +12%</div>
        <div id="target" class="text-green-400 font-bold text-lg">—</div>
        <div id="target-usd" class="text-xs text-green-500 mt-0.5">—</div>
      </div>
    </div>
  </div>

<script>
  // ── Estrategias propuestas hoy (inyectadas desde morning_brief) ──────────────
  var DAILY_STRATEGIES = ${dailyStrategiesJson};

  // Busca la mejor estrategia del día para ticker + lado dado
  function suggestStrategy(ticker, side) {
    var strats = DAILY_STRATEGIES[ticker] || [];
    var matches = strats.filter(function(s) { return s.position === side; });
    if (!matches.length) return null;
    var order = { conditions_met: 0, setup_forming: 1, watch: 2 };
    matches.sort(function(a, b) { return (order[a.confidence] || 3) - (order[b.confidence] || 3); });
    return matches[0];
  }

  (function () {
    function updateClock() {
      var now = new Date();
      var et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      var h = et.getHours(), m = et.getMinutes();
      document.getElementById('et-time').textContent =
        String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ' ET';
      var tot = h * 60 + m;
      var status = 'CERRADO', cls = 'text-gray-500';
      if (tot >= 570 && tot < 690)      { status = '● VENTANA ACTIVA 9:30–11:30'; cls = 'text-green-400'; }
      else if (tot >= 690 && tot < 960) { status = '○ MERCADO ABIERTO';           cls = 'text-yellow-400'; }
      var el = document.getElementById('session-status');
      el.textContent = status; el.className = 'font-bold ' + cls;
    }
    updateClock();
    setInterval(updateClock, 30000);
  })();

  function calc() {
    var bid       = parseFloat(document.getElementById('bid').value);
    var ask       = parseFloat(document.getElementById('ask').value);
    var contracts = parseInt(document.getElementById('contracts').value) || 1;
    var clear = function() {
      ['mid','stop','stop-usd','target','target-usd','inversion'].forEach(function(id){
        document.getElementById(id).textContent = '—';
      });
    };
    if (!bid || !ask || bid <= 0 || ask <= 0 || ask < bid) { clear(); return; }
    var mid    = (bid + ask) / 2;
    var stopPx = mid * 0.75;
    var tgtPx  = mid * 1.12;
    var inv    = mid * contracts * 100;
    var slUsd  = (stopPx - mid) * contracts * 100;
    var tpUsd  = (tgtPx  - mid) * contracts * 100;
    var f = function(v){ return '$' + v.toFixed(2); };
    var fu = function(v){ return (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(0); };
    document.getElementById('mid').textContent        = f(mid);
    document.getElementById('stop').textContent       = f(stopPx);
    document.getElementById('stop-usd').textContent   = fu(slUsd) + ' (×' + contracts + ')';
    document.getElementById('target').textContent     = f(tgtPx);
    document.getElementById('target-usd').textContent = fu(tpUsd) + ' (×' + contracts + ')';
    document.getElementById('inversion').textContent  = f(inv);
  }

  // ── Supabase trades ──────────────────────────────────────────────────────────
  var SB_URL = 'https://iunxftxvazpfwqtygzcu.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1bnhmdHh2YXpwZndxdHlnemN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTI4MjgsImV4cCI6MjA5NTE4ODgyOH0.6Gmf-JIwHnLQwXNfjsFwogHXiRXdPxgP7vhVtvDK1ac';

  function sbHeaders() {
    return { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
  }

  function calcResult() {
    var entry = parseFloat(document.getElementById('t-entry').value);
    var exit  = parseFloat(document.getElementById('t-exit').value);
    var el    = document.getElementById('t-result-display');
    if (!entry || !exit || entry <= 0) { el.textContent = '—'; el.className = 'font-bold text-lg text-gray-400'; return; }
    var pct = ((exit - entry) / entry) * 100;
    el.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    el.className = 'font-bold text-lg ' + (pct >= 0 ? 'text-green-400' : 'text-red-400');
  }

  async function submitTrade(e) {
    e.preventDefault();
    var msg = document.getElementById('trade-msg');
    var entry      = parseFloat(document.getElementById('t-entry').value) || null;
    var exitVal    = parseFloat(document.getElementById('t-exit').value)  || null;
    var resultPct  = (entry && exitVal && entry > 0)
                     ? parseFloat(((exitVal - entry) / entry * 100).toFixed(2)) : null;
    var signalCode = document.getElementById('t-signal-code').value || null;

    // Tomar entry_date/exit_date de _schwabData si hay (posición de Schwab)
    var entryDate = (_schwabData && _schwabData.entry_date) ? _schwabData.entry_date : '${dateStr}';
    var exitDate  = (_schwabData && _schwabData.exit_date)  ? _schwabData.exit_date  : null;
    var tradeStatus = exitVal ? 'closed' : 'open';

    var trade = {
      date:          '${dateStr}',
      entry_date:    entryDate,
      exit_date:     exitDate,
      status:        tradeStatus,
      ticker:        document.getElementById('t-ticker').value,
      strategy:      document.getElementById('t-strategy').value || null,
      signal_code:   signalCode,
      side:          document.getElementById('t-side').value,
      mode:          document.getElementById('t-mode').value,
      strike:        parseFloat(document.getElementById('t-strike').value) || null,
      expiration:    document.getElementById('t-expiry').value || null,
      premium_entry: entry,
      premium_exit:  exitVal,
      contracts:     parseInt(document.getElementById('t-contracts').value) || 1,
      result_pct:    resultPct,
      notes:         document.getElementById('t-notes').value || null
    };
    try {
      var res = await fetch(SB_URL + '/rest/v1/trades', {
        method: 'POST', headers: Object.assign(sbHeaders(), { 'Prefer': 'return=minimal' }),
        body: JSON.stringify(trade)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var label = tradeStatus === 'open' ? '✅ Posición abierta registrada' : '✅ Trade cerrado guardado';
      if (signalCode) label += ' · señal: ' + signalCode;
      msg.textContent = label;
      msg.className = 'text-xs mt-2 text-center text-green-400';
      msg.classList.remove('hidden');
      document.getElementById('trade-form').reset();
      document.getElementById('t-signal-code').value = '';
      document.getElementById('t-result-display').textContent = '—';
      _schwabData = null;
      setTimeout(function(){ msg.classList.add('hidden'); }, 4000);
      loadTrades();
    } catch(err) {
      msg.textContent = '❌ Error: ' + err.message;
      msg.className = 'text-xs mt-2 text-center text-red-400';
      msg.classList.remove('hidden');
    }
  }

  async function loadTrades() {
    var el = document.getElementById('trades-table');
    try {
      var res = await fetch(SB_URL + '/rest/v1/trades?select=date,ticker,strategy,side,mode,premium_entry,premium_exit,result_pct,notes&order=created_at.desc&limit=15', {
        headers: sbHeaders()
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var trades = await res.json();
      if (!trades.length) { el.innerHTML = '<p class="text-gray-600 text-center py-4">Sin trades registrados aún.</p>'; return; }
      var rows = trades.map(function(t) {
        var pct = t.result_pct != null ? t.result_pct : null;
        var pctHtml = pct != null
          ? '<span class="font-bold ' + (pct >= 0 ? 'text-green-400' : 'text-red-400') + '">' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%</span>'
          : '<span class="text-gray-600">—</span>';
        var modeBadge = t.mode === 'real'
          ? '<span class="text-yellow-400 font-bold">REAL</span>'
          : '<span class="text-gray-500">paper</span>';
        return '<tr class="border-b border-gray-800 hover:bg-gray-800/30">'
          + '<td class="py-1.5 pr-3 text-gray-400">' + t.date + '</td>'
          + '<td class="py-1.5 pr-3 font-bold text-white">' + t.ticker + '</td>'
          + '<td class="py-1.5 pr-3 text-gray-400">' + t.strategy + '</td>'
          + '<td class="py-1.5 pr-3 ' + (t.side === 'CALL' ? 'text-green-400' : 'text-red-400') + ' font-bold">' + t.side + '</td>'
          + '<td class="py-1.5 pr-3">' + pctHtml + '</td>'
          + '<td class="py-1.5 pr-3">' + modeBadge + '</td>'
          + '<td class="py-1.5 text-gray-500 truncate max-w-xs">' + (t.notes || '') + '</td>'
          + '</tr>';
      }).join('');
      el.innerHTML = '<table class="w-full text-xs"><thead><tr class="text-gray-600 text-left border-b border-gray-800">'
        + '<th class="pb-1 pr-3">FECHA</th><th class="pb-1 pr-3">TICKER</th><th class="pb-1 pr-3">STRAT</th>'
        + '<th class="pb-1 pr-3">LADO</th><th class="pb-1 pr-3">RESULT</th><th class="pb-1 pr-3">MODO</th><th class="pb-1">NOTAS</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>';
    } catch(err) {
      el.innerHTML = '<p class="text-red-500 text-xs">Error cargando trades: ' + err.message + '</p>';
    }
  }

  // ── Posiciones abiertas ──────────────────────────────────────────────────────
  async function loadOpenPositions() {
    var el = document.getElementById('open-positions-body');
    var sec = document.getElementById('open-positions-section');
    try {
      var res = await fetch(
        SB_URL + '/rest/v1/trades?select=id,entry_date,ticker,strategy,signal_code,side,strike,expiration,premium_entry,contracts,mode&status=eq.open&order=entry_date.desc',
        { headers: sbHeaders() }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var positions = await res.json();
      if (!positions.length) {
        el.innerHTML = '<p class="text-gray-600 text-center py-2">Sin posiciones abiertas.</p>';
        sec.style.borderColor = '';
        return;
      }
      // Marcar sección en amarillo si hay posiciones
      sec.style.borderColor = '#ca8a04';
      var rows = positions.map(function(p) {
        var daysOpen = p.entry_date
          ? Math.floor((Date.now() - new Date(p.entry_date)) / 86400000) : '?';
        var sigHtml = p.signal_code
          ? '<span class="text-blue-400">' + p.signal_code + '</span>'
          : '<span class="text-gray-600">—</span>';
        return '<tr class="border-b border-gray-800">'
          + '<td class="py-1.5 pr-2 text-yellow-400 font-bold">' + (p.ticker||'—') + '</td>'
          + '<td class="py-1.5 pr-2 ' + (p.side==='CALL'?'text-green-400':'text-red-400') + ' font-bold">' + (p.side||'—') + '</td>'
          + '<td class="py-1.5 pr-2 text-gray-300">' + (p.strike ? '$'+p.strike : '—') + '</td>'
          + '<td class="py-1.5 pr-2 text-gray-400">' + (p.expiration||'—') + '</td>'
          + '<td class="py-1.5 pr-2 text-gray-300">' + (p.premium_entry ? '$'+p.premium_entry : '—') + '</td>'
          + '<td class="py-1.5 pr-2 text-gray-500">' + (p.contracts||1) + ' cto.</td>'
          + '<td class="py-1.5 pr-2 text-gray-500">' + (p.entry_date||'—') + ' <span class="text-orange-400">(+' + daysOpen + 'd)</span></td>'
          + '<td class="py-1.5 pr-2">' + sigHtml + '</td>'
          + '<td class="py-1.5">'
          + '<button onclick="handleCloseBtn(this)"'
          + ' data-id="' + p.id + '" data-ticker="' + (p.ticker||'') + '" data-side="' + (p.side||'') + '"'
          + ' data-entry="' + (p.premium_entry||0) + '" data-ctos="' + (p.contracts||1) + '" data-sig="' + (p.signal_code||'') + '"'
          + ' class="px-2 py-0.5 rounded text-xs font-bold text-white hover:opacity-80" style="background:#b45309">Cerrar</button>'
          + '</td>'
          + '</tr>';
      }).join('');
      el.innerHTML = '<table class="w-full text-xs"><thead><tr class="text-gray-600 text-left border-b border-gray-800">'
        + '<th class="pb-1 pr-2">TICKER</th><th class="pb-1 pr-2">LADO</th><th class="pb-1 pr-2">STRIKE</th>'
        + '<th class="pb-1 pr-2">EXP</th><th class="pb-1 pr-2">ENTRY</th><th class="pb-1 pr-2">CTOS</th>'
        + '<th class="pb-1 pr-2">FECHA</th><th class="pb-1 pr-2">SEÑAL</th><th class="pb-1">ACCIÓN</th>'
        + '</tr></thead><tbody>' + rows + '</tbody></table>';
    } catch(err) {
      el.innerHTML = '<p class="text-red-500 text-xs">Error: ' + err.message + '</p>';
    }
  }

  function prefillClosePosition(tradeId, ticker, side, premiumEntry, contracts, signalCode) {
    // Pre-rellenar el formulario para registrar el cierre
    function setSelect(id, val) {
      var s = document.getElementById(id);
      if (!s || !val) return;
      for (var i = 0; i < s.options.length; i++) {
        if (s.options[i].value === val || s.options[i].text === val) { s.selectedIndex = i; return; }
      }
    }
    setSelect('t-ticker', ticker);
    setSelect('t-side', side);
    document.getElementById('t-contracts').value = contracts;
    document.getElementById('t-entry').value = premiumEntry;
    document.getElementById('t-exit').value = '';
    document.getElementById('t-signal-code').value = signalCode || '';
    // Marcar que es un cierre de posición existente
    if (!_schwabData) _schwabData = {};
    _schwabData.entry_date = null; // la fecha de entry ya está en el registro original
    _schwabData.exit_date  = new Date().toISOString().split('T')[0];
    // Scroll al formulario con aviso
    var msg = document.getElementById('trade-msg');
    msg.textContent = '🔵 Registrando cierre de ' + ticker + ' ' + side + ' — ingresa la PRIMA SALIDA y guarda';
    msg.className = 'text-xs mt-2 text-center text-blue-400';
    msg.classList.remove('hidden');
    document.getElementById('trade-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    calcResult();
  }

  function handleCloseBtn(btn) {
    prefillClosePosition(
      btn.dataset.id,
      btn.dataset.ticker,
      btn.dataset.side,
      parseFloat(btn.dataset.entry) || 0,
      parseInt(btn.dataset.ctos) || 1,
      btn.dataset.sig || ''
    );
  }

  window.addEventListener('load', function() { loadTrades(); loadOpenPositions(); });

  // ── Schwab image analyzer (llamado también desde showExtractedFields) ─────────
  var WATCHER = 'http://127.0.0.1:9224';
  var _schwabFile = null;
  var _schwabData = null;

  // Ping watcher al cargar
  (async function pingWatcher() {
    var el = document.getElementById('watcher-status');
    if (!el) return;
    try {
      var r = await fetch(WATCHER + '/ping', { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        el.innerHTML = '<span class="text-green-400">● activo</span>';
      } else { throw new Error(); }
    } catch(e) {
      el.innerHTML = '<span class="text-yellow-600" title="En terminal del proyecto: npm run schwab">○ npm run schwab</span>';
    }
  })();

  // Drop zone setup
  (function initSchwab() {
    var dz = document.getElementById('schwab-dropzone');
    var fi = document.getElementById('schwab-file');
    if (!dz || !fi) return;
    dz.addEventListener('dragover', function(e) {
      e.preventDefault();
      dz.style.borderColor = '#3b82f6';
    });
    dz.addEventListener('dragleave', function() {
      dz.style.borderColor = '';
    });
    dz.addEventListener('drop', function(e) {
      e.preventDefault();
      dz.style.borderColor = '';
      var file = e.dataTransfer && e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) loadSchwabFile(file);
    });
    fi.addEventListener('change', function() {
      if (fi.files[0]) loadSchwabFile(fi.files[0]);
    });
  })();

  function loadSchwabFile(file) {
    _schwabFile = file;
    _schwabData = null;
    document.getElementById('schwab-fname').textContent = file.name;
    document.getElementById('schwab-analyze-status').textContent = 'Listo para analizar';
    document.getElementById('schwab-extracted').classList.add('hidden');
    var reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('schwab-thumb').src = e.target.result;
      document.getElementById('schwab-idle').classList.add('hidden');
      document.getElementById('schwab-ready').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }

  async function analyzeSchwabImage() {
    if (!_schwabFile) return;
    var btn = document.getElementById('schwab-btn');
    var status = document.getElementById('schwab-analyze-status');
    var wStatus = document.getElementById('watcher-status');
    btn.textContent = '⏳';
    btn.disabled = true;
    status.textContent = 'Enviando imagen a Claude Haiku...';
    try {
      var base64 = await new Promise(function(res, rej) {
        var r = new FileReader();
        r.onload = function(e) { res(e.target.result.split(',')[1]); };
        r.onerror = rej;
        r.readAsDataURL(_schwabFile);
      });
      var resp = await fetch(WATCHER + '/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, media_type: _schwabFile.type || 'image/png' }),
        signal: AbortSignal.timeout(45000)
      });
      var result;
      try { result = await resp.json(); } catch { throw new Error('HTTP ' + resp.status + ' (sin detalle)'); }
      if (!resp.ok || !result.success) throw new Error(result.error || 'HTTP ' + resp.status);
      _schwabData = result.fields;
      showExtractedFields(_schwabData);
      status.textContent = '✓ Análisis completo';
      wStatus.innerHTML = '<span class="text-green-400">● activo</span>';
    } catch(err) {
      var msg = err.message || '';
      if (msg.indexOf('fetch') >= 0 || msg.indexOf('Failed') >= 0 || msg.indexOf('NetworkError') >= 0 || msg.indexOf('timeout') >= 0) {
        status.textContent = '❌ Analizador no activo → ejecuta: npm run schwab';
        wStatus.innerHTML = '<span class="text-red-400">✗ offline</span>';
      } else {
        status.textContent = '❌ ' + msg;
      }
    } finally {
      btn.textContent = '🔍 Analizar';
      btn.disabled = false;
    }
  }

  async function showExtractedFields(f) {
    var statusLabel = { open: '🟡 ABIERTA', closed: '🔴 CERRADA', exit_only: '🔵 SOLO CIERRE' };
    var resultCls = f.result_pct != null ? (f.result_pct >= 0 ? 'text-green-400' : 'text-red-400') : 'text-gray-400';

    var items = [
      ['TICKER',        f.ticker],
      ['LADO',          f.side],
      ['STRIKE',        f.strike != null ? '$' + f.strike : null],
      ['EXPIRACIÓN',    f.expiration],
      ['CONTRATOS',     f.contracts],
      ['MODO',          f.mode],
      ['PRIMA ENTRADA', f.premium_entry != null ? '$' + f.premium_entry : null],
      ['PRIMA SALIDA',  f.premium_exit  != null ? '$' + f.premium_exit  : null],
    ];
    var fieldsHtml = items.map(function(item) {
      var val = item[1] != null ? String(item[1]) : '—';
      var cls = item[1] != null ? 'text-white font-bold' : 'text-gray-600';
      return '<div><span class="block text-gray-500 text-xs">' + item[0] + '</span>'
        + '<span class="' + cls + '">' + val + '</span></div>';
    }).join('');

    // Resultado + status de posición
    var resultHtml = '<div class="col-span-4 flex items-center gap-4 mt-1 pt-2 border-t border-gray-800">'
      + '<span class="text-gray-500 text-xs">POSICIÓN</span>'
      + '<span class="text-xs font-bold text-white">' + (statusLabel[f.status] || f.status || '—') + '</span>'
      + (f.result_pct != null
        ? '<span class="' + resultCls + ' font-bold text-sm ml-2">'
          + (f.result_pct >= 0 ? '+' : '') + f.result_pct + '%</span>'
        : '')
      + (f.entry_date ? '<span class="text-gray-600 text-xs ml-auto">Entrada: ' + f.entry_date + '</span>' : '')
      + (f.exit_date  ? '<span class="text-gray-600 text-xs ml-1">Salida: '  + f.exit_date  + '</span>' : '')
      + '</div>';

    // ── Señales exactas desde Supabase ────────────────────────────────────────
    var signalHtml = '<div class="col-span-4 mt-2 pt-2 border-t border-blue-900/40">'
      + '<div class="text-blue-400 text-xs font-bold mb-1">SEÑAL EXACTA PROPUESTA — elige la que ejecutaste</div>';

    try {
      var today = '${dateStr}';
      var url = SB_URL + '/rest/v1/signals?select=signal_code,strategy,side,confidence,note'
        + '&date=eq.' + today
        + (f.ticker ? '&ticker=eq.' + f.ticker : '')
        + (f.side   ? '&side=eq.'   + f.side   : '')
        + '&order=confidence.asc';
      var sr = await fetch(url, { headers: sbHeaders() });
      var sigs = sr.ok ? await sr.json() : [];

      if (sigs.length) {
        var confBadge = { conditions_met: '⭐', setup_forming: '🔶', watch: '👁' };
        signalHtml += '<div id="signal-picker" class="space-y-1">'
          + sigs.map(function(sig, i) {
            return '<label class="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-blue-900/20">'
              + '<input type="radio" name="signal_pick" value="' + sig.signal_code + '" data-strategy="' + sig.strategy + '"'
              + (i === 0 ? ' checked' : '') + ' class="accent-blue-500">'
              + '<span class="text-white font-bold text-xs">' + sig.strategy + '</span>'
              + '<span class="text-blue-300 text-xs">' + (confBadge[sig.confidence] || '') + ' ' + (sig.confidence || '') + '</span>'
              + (sig.note ? '<span class="text-gray-500 text-xs truncate">' + sig.note + '</span>' : '')
              + '</label>';
          }).join('') + '</div>';
      } else {
        signalHtml += '<div class="text-yellow-500 text-xs">⚠️ Sin señales para ' + (f.ticker||'') + ' ' + (f.side||'') + ' hoy'
          + ' — selecciona la estrategia manualmente en el formulario</div>';
      }
    } catch(e) {
      signalHtml += '<div class="text-gray-600 text-xs">No se pudieron cargar señales: ' + e.message + '</div>';
    }
    signalHtml += '</div>';

    document.getElementById('schwab-extracted-fields').innerHTML = fieldsHtml + resultHtml + signalHtml;
    document.getElementById('schwab-extracted').classList.remove('hidden');
  }

  function fillFormFromSchwab() {
    var f = _schwabData;
    if (!f) return;

    function setSelect(id, val, addIfMissing) {
      var s = document.getElementById(id);
      if (!s || val == null) return;
      var v = String(val);
      for (var i = 0; i < s.options.length; i++) {
        if (s.options[i].value === v || s.options[i].text === v) { s.selectedIndex = i; return; }
      }
      // Opción no encontrada: agregar dinámicamente si se permite
      if (addIfMissing) {
        var opt = document.createElement('option');
        opt.value = v; opt.text = v;
        s.insertBefore(opt, s.options[0]);
        s.selectedIndex = 0;
      }
    }

    // Leer señal seleccionada en el picker
    var picked = document.querySelector('input[name="signal_pick"]:checked');
    var signalCode   = picked ? picked.value                       : '';
    var strategyPicked = picked ? picked.dataset.strategy          : '';

    setSelect('t-ticker', f.ticker, true);   // addIfMissing=true — SPY, TSLA, etc. pueden no estar en el watchlist
    setSelect('t-side',   f.side);
    setSelect('t-mode',   f.mode || 'real');
    if (f.strike      != null) document.getElementById('t-strike').value    = f.strike;
    if (f.expiration)          document.getElementById('t-expiry').value    = f.expiration;
    if (f.premium_entry != null) document.getElementById('t-entry').value   = f.premium_entry;
    if (f.premium_exit  != null) document.getElementById('t-exit').value    = f.premium_exit;
    if (f.contracts     != null) document.getElementById('t-contracts').value = f.contracts;

    // Señal exacta elegida
    if (strategyPicked) setSelect('t-strategy', strategyPicked);
    document.getElementById('t-signal-code').value = signalCode;

    calcResult();
    document.getElementById('schwab-extracted').classList.add('hidden');
    document.getElementById('schwab-ready').classList.add('hidden');
    document.getElementById('schwab-idle').classList.remove('hidden');
    _schwabFile = null;
    document.getElementById('trade-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

</script>
</body>
</html>`;
}

/** Save the full premarket checklist report as markdown in docs/sessions/ inside the repo.
 *  Also saves to Supabase (premarket_sessions table) if configured.
 *  If brief_data (JSON string of morning_brief output) is provided, also generates an HTML dashboard. */
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

  let htmlPath = null;
  let briefObj = null;
  if (brief_data) {
    try {
      briefObj = typeof brief_data === "string" ? JSON.parse(brief_data) : brief_data;
      const html = generateHtml(briefObj, dateStr);
      htmlPath = join(sessionsDir, `premarket-${dateStr}.html`);
      writeFileSync(htmlPath, html, "utf8");
    } catch (e) {
      // HTML generation is non-fatal — md already saved
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
    html_path: htmlPath,
    date: dateStr,
    supabase: sbResult,
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
