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
    </div>
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
      if (tot >= 570 && tot < 960)      { status = '● VENTANA ACTIVA 9:30–16:00'; cls = 'text-green-400'; }
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

    var signalHtml = '';

    document.getElementById('schwab-extracted-fields').innerHTML = fieldsHtml + resultHtml + signalHtml;
    document.getElementById('schwab-extracted').classList.remove('hidden');
  }


</script>
</body>
</html>`;
}

/**
 * Normaliza el output crudo de morning_brief a un contrato explícito y estable,
 * para que dashboard.js (proceso separado, corre horas después) no dependa de la
 * forma interna de runBrief()/generateHtml(). No hay campo "score" numérico en
 * morning_brief hoy — el 0-100% del checklist lo calcula Claude en el chat y solo
 * queda en el .md. Aquí se deriva una clasificación por tier (ejecutar/vigilar/
 * no_operar) con la misma regla que ya usa generateHtml() para las 3 secciones
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
 *  If brief_data (JSON string of morning_brief output) is provided, also generates an HTML dashboard
 *  and a normalized premarket-YYYY-MM-DD.json for the unified dashboard (dashboard.js) to read. */
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
  let jsonPath = null;
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
    try {
      const normalized = normalizePremarketData(briefObj);
      jsonPath = join(sessionsDir, `premarket-${dateStr}.json`);
      writeFileSync(jsonPath, JSON.stringify(normalized, null, 2), "utf8");
    } catch (e) {
      // JSON normalization is non-fatal — md/html already saved (dashboard.js
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
    html_path: htmlPath,
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
