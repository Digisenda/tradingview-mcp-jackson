#!/usr/bin/env node
/**
 * Vigía en tiempo real — lazo caliente del sistema de señales.
 *
 * Lee precios en vivo de TradingView Desktop (ya abierto) y detecta señales técnicas
 * usando screenStrategies() de signals.js. NUNCA ejecuta operaciones — solo avisa.
 *
 * Uso: node watcher.js [--dry-run] [--rules=./rules.json]
 *
 * Flags:
 *   --dry-run      Detecta señales pero no crea alertas nativas ni envía email
 *   --rules=<path> Ruta alternativa a rules.json
 */

import "dotenv/config";
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import * as chart from "./src/core/chart.js";
import * as data from "./src/core/data.js";
import {
  extractBB,
  extractSMAs,
  bbPosition,
  maOrder,
  screenStrategies,
} from "./src/core/signals.js";
import { onSignal, onTick, onSessionEnd, reportStartupState } from "./paper-executor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const rulesFlag = args.find((a) => a.startsWith("--rules="));
const RULES_PATH = rulesFlag ? rulesFlag.split("=")[1] : null;

// ─── Config / rules ───────────────────────────────────────────────────────────

function loadRules() {
  if (RULES_PATH) {
    const resolved = resolve(RULES_PATH);
    const safeProject = resolve(__dirname);
    const safeUser = resolve(homedir(), ".tradingview-mcp");
    const underProject = resolved === safeProject || resolved.startsWith(safeProject + sep);
    const underUser = resolved === safeUser || resolved.startsWith(safeUser + sep);
    if (!underProject && !underUser) {
      throw new Error(`--rules path fuera del directorio permitido: ${resolved}`);
    }
  }

  const candidates = [
    RULES_PATH,
    join(__dirname, "rules.json"),
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
  throw new Error("No rules.json found. Run from project root or pass --rules=<path>");
}

// ─── Session window helpers ───────────────────────────────────────────────────

function nowHM() {
  const etStr = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etStr);
  return et.getHours() * 60 + et.getMinutes();
}

function isInSessionWindow(sessionStr) {
  const match = (sessionStr || "09:30–11:30 ET").match(/(\d{1,2}):(\d{2})[–-](\d{1,2}):(\d{2})/);
  if (!match) return true;
  const start = parseInt(match[1]) * 60 + parseInt(match[2]);
  const end = parseInt(match[3]) * 60 + parseInt(match[4]);
  const hm = nowHM();
  return hm >= start && hm <= end;
}

// True during the `warmupMinutes` window right before primary_window opens.
function isInWarmupWindow(sessionStr, warmupMinutes) {
  const match = (sessionStr || "09:30–11:30 ET").match(/(\d{1,2}):(\d{2})[–-](\d{1,2}):(\d{2})/);
  if (!match || !warmupMinutes) return false;
  const start = parseInt(match[1]) * 60 + parseInt(match[2]);
  const hm = nowHM();
  return hm >= start - warmupMinutes && hm < start;
}

function todayET() {
  return new Date()
    .toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");
}

// ─── FED/Earnings veto check ──────────────────────────────────────────────────

function buildVetoFlags(rules, ticker) {
  const today = new Date().toISOString().split("T")[0]; // UTC, consistent with fundamental.js
  const flags = [];

  for (const fd of rules.fundamental_filters?.fed_dates || []) {
    const diff = Math.abs((new Date(fd) - new Date(today)) / 86400000);
    if (diff <= 2) { flags.push(`FED ${fd}`); break; }
  }

  const earnDate = rules.fundamental_filters?.earnings?.[ticker];
  if (earnDate) {
    const diff = Math.abs((new Date(earnDate) - new Date(today)) / 86400000);
    if (diff <= 7) flags.push(`EARNINGS ${earnDate}`);
  }

  return flags;
}

// ─── Multi-TF scan (initial load + periodic refresh) ─────────────────────────

const TIMEFRAMES = [
  { key: "D1", tf: "D" },
  { key: "H1", tf: "60" },
  { key: "M15", tf: "15" },
];

async function scanSymbol(symbol) {
  let quoteData = null;
  const tfData = {};

  const origState = await chart.getState().catch(() => null);

  try {
    await chart.setSymbol({ symbol });
    await new Promise((r) => setTimeout(r, 900));

    for (const { key, tf } of TIMEFRAMES) {
      try {
        await chart.setTimeframe({ timeframe: tf });
        await new Promise((r) => setTimeout(r, 800));

        // Fetch quote first (with explicit symbol) so getQuote's internal
        // setSymbol+waitForChartReady guarantees the chart is on the right
        // ticker before getStudyValues reads indicators. Running both in
        // parallel was a race that caused price cross-contamination between
        // consecutive symbol scans.
        if (quoteData == null) {
          const q = await data.getQuote({ symbol });
          if (q?.success) quoteData = q;
        }
        const indicators = await data.getStudyValues();

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
  } finally {
    if (origState?.symbol) {
      await chart.setSymbol({ symbol: origState.symbol }).catch(() => {});
      if (origState?.resolution) {
        await chart.setTimeframe({ timeframe: origState.resolution }).catch(() => {});
      }
    }
  }

  const price = quoteData?.last ?? quoteData?.close ?? null;
  return { price, tfData };
}

// ─── JSONL persistence ────────────────────────────────────────────────────────

function outputDir() {
  const dir = process.env.VIGIA_OUTPUT_DIR
    ? resolve(process.env.VIGIA_OUTPUT_DIR)
    : join(homedir(), ".tradingview-mcp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function signalLogPath() {
  return join(outputDir(), `signals-${todayET()}.jsonl`);
}

function logSignal(entry) {
  try {
    appendFileSync(
      signalLogPath(),
      JSON.stringify({ ...entry, logged_at: new Date().toISOString() }) + "\n",
      "utf8"
    );
  } catch (e) {
    console.error("[VIGIA] ⚠️ No se pudo escribir log JSONL:", e.message);
  }
}

// ─── Dashboard HTML ───────────────────────────────────────────────────────────

function signalHtmlPath(date) {
  return join(outputDir(), `signals-${date}.html`);
}

function updateSignalsHtml() {
  const date = todayET();
  const jsonlPath = signalLogPath();
  const htmlPath  = signalHtmlPath(date);

  const entries = [];
  if (existsSync(jsonlPath)) {
    for (const line of readFileSync(jsonlPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }
  }

  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const rows = entries.map((e) => {
    const time = new Date(e.logged_at).toLocaleString("en-US", {
      timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const conf  = e.confidence || "";
    const side  = e.position || e.side || "";
    const veto  = e.veto_flags?.length ? ` ⚠️ ${e.veto_flags.join(" · ")}` : "";
    const mode  = e.dry_run ? '<span style="opacity:.5">dry-run</span>' : '<span style="color:#00ff88">REAL</span>';
    return `<tr class="${e.dry_run ? "dry" : ""}">
      <td>${time}</td>
      <td><b>${e.ticker}</b></td>
      <td>${e.strategy}</td>
      <td class="${side}">${side}</td>
      <td class="${conf}">${conf}</td>
      <td>$${e.price?.toFixed(2) ?? "?"}</td>
      <td style="font-size:.85em;max-width:420px">${e.note}${veto}</td>
      <td>${mode}</td>
    </tr>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <title>Vigía — ${date}</title>
  <style>
    body{font-family:monospace;background:#0d0d0d;color:#e0e0e0;padding:20px;margin:0}
    h1{color:#00d4ff;margin:0 0 4px}
    p{color:#666;margin:0 0 16px;font-size:.85em}
    table{border-collapse:collapse;width:100%}
    th{background:#1a1a2e;color:#00d4ff;padding:8px 12px;text-align:left;font-size:.85em}
    td{padding:6px 12px;border-bottom:1px solid #1a1a1a;font-size:.85em}
    tr:hover td{background:#111}
    .conditions_met{color:#00ff88;font-weight:bold}
    .setup_forming{color:#ffd700}
    .watch{color:#888}
    .CALL{color:#00ff88;font-weight:bold}
    .PUT{color:#ff4444;font-weight:bold}
    .dry td{opacity:.5}
  </style>
</head>
<body>
  <h1>📡 Vigía — Señales ${date}</h1>
  <p>Actualizado: ${now} ET · auto-refresh 30 s · ${entries.length} señal(es)</p>
  <table>
    <thead><tr>
      <th>Hora ET</th><th>Ticker</th><th>Estrategia</th><th>Lado</th>
      <th>Confianza</th><th>Precio</th><th>Nota</th><th>Modo</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="8" style="color:#555;text-align:center;padding:24px">Sin señales aún</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  try {
    writeFileSync(htmlPath, html, "utf8");
  } catch (e) {
    console.warn("[VIGIA] ⚠️ No se pudo escribir dashboard HTML:", e.message);
  }
  return htmlPath;
}

// ─── Email (optional — configure NODEMAILER_* in .env) ───────────────────────

// Cached across calls — creating a fresh TLS connection per signal is what caused
// Gmail to silently drop sends when several signals fired within the same second
// (backlog #17). Reused here; combined with the per-tick buffer below (backlog #18)
// this keeps well under one SMTP connection per 30s tick.
let _transporter; // undefined = not yet resolved, null = not configured / failed

async function getTransporter() {
  if (_transporter !== undefined) return _transporter;
  const host = (process.env.NODEMAILER_HOST || "").trim();
  const user = (process.env.NODEMAILER_USER || "").trim();
  const pass = (process.env.NODEMAILER_PASS || "").replace(/\s+/g, ""); // App Passwords: strip spaces
  const to   = (process.env.NODEMAILER_TO   || "").trim();
  if (!host || !user || !pass || !to) {
    _transporter = null;
    return null;
  }
  try {
    const { createTransport } = await import("nodemailer");
    _transporter = createTransport({ host, port: 587, secure: false, auth: { user, pass } }); // 587 STARTTLS
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND") {
      console.warn("[VIGIA] ℹ️  Email omitido — instala nodemailer: npm install nodemailer");
    } else {
      console.warn("[VIGIA] ⚠️ Email falló al crear transporte:", e.message);
    }
    _transporter = null;
  }
  return _transporter;
}

async function sendEmail(subject, body) {
  const user = (process.env.NODEMAILER_USER || "").trim();
  const to   = (process.env.NODEMAILER_TO   || "").trim();
  const t = await getTransporter();
  if (!t) return;

  try {
    await t.sendMail({ from: user, to, subject, text: body });
    console.log("[VIGIA] ✉️  Email:", subject);
  } catch (e) {
    console.warn("[VIGIA] ⚠️ Email falló:", e.message);
  }
}

// ─── Email buffer — one email per tick instead of one per signal (backlog #18) ─

let pendingEmailSignals = []; // { symbol, candidate, price, vetoFlags } accumulated during a tick

function queueEmail(symbol, candidate, price, vetoFlags) {
  pendingEmailSignals.push({ symbol, candidate, price, vetoFlags });
}

function formatSignalBlock({ symbol, candidate, price, vetoFlags }) {
  return [
    `Señal: ${candidate.id} ${candidate.position} en ${symbol}`,
    `Precio: $${price?.toFixed(2) ?? "?"}`,
    `Confianza: ${candidate.confidence}`,
    `Nota: ${candidate.note}`,
    vetoFlags.length ? `⚠️ Veto: ${vetoFlags.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

async function flushEmailBuffer() {
  if (pendingEmailSignals.length === 0) return;
  const items = pendingEmailSignals;
  pendingEmailSignals = [];

  const subject = items.length === 1
    ? `[VIGIA] ${items[0].candidate.id} ${items[0].candidate.position} ${items[0].symbol}`
    : `[VIGIA] ${items.length} señales`;
  const hora = `Hora: ${new Date().toLocaleString("es-MX", { timeZone: "America/New_York" })} ET`;
  const body = items.map(formatSignalBlock).join("\n\n---\n\n") + `\n\n${hora}`;

  await sendEmail(subject, body);
}

// ─── Alert dispatch ───────────────────────────────────────────────────────────

async function fireAlert(symbol, candidate, price, vetoFlags) {
  const vetoStr = vetoFlags.length ? ` ⚠️ ${vetoFlags.join(" · ")}` : "";
  const msg = `[VIGIA] ${candidate.id} ${candidate.position} ${symbol} @$${price?.toFixed(2) ?? "?"}${vetoStr}`;

  console.log(`\n[VIGIA] 🔔 SEÑAL: ${msg}`);
  console.log(`        Nota: ${candidate.note}`);
  if (vetoFlags.length)
    console.log(`        ⚠️ Veto activo — el operador decide, el vigía no calla`);

  logSignal({
    ticker: symbol,
    strategy: candidate.id,
    side: candidate.position,
    confidence: candidate.confidence,
    price,
    note: candidate.note,
    veto_flags: vetoFlags,
    dry_run: DRY_RUN,
  });

  const htmlPath = updateSignalsHtml();
  console.log(`        📊 Dashboard: ${htmlPath}`);

  if (DRY_RUN) {
    console.log("        [dry-run] — sin email");
    return;
  }

  queueEmail(symbol, candidate, price, vetoFlags);
}

// ─── Signal state — only fire when confidence improves ───────────────────────

const firedSignals = new Map(); // key → last confidence rank fired
const CONFIDENCE_RANK = { watch: 0, setup_forming: 1, conditions_met: 2 };
const lastKnownPrices = new Map(); // symbol → last price seen during session (for end-of-session expiry)
let wasInSession = false;

function shouldFire(symbol, cand) {
  if (!(cand.confidence in CONFIDENCE_RANK)) {
    console.warn(`[VIGIA] ⚠️ Confidence desconocida: "${cand.confidence}" (${symbol}/${cand.id}) — señal ignorada`);
    return false;
  }
  const key = `${symbol}:${cand.id}:${cand.position}`;
  const prevRank = firedSignals.has(key) ? (CONFIDENCE_RANK[firedSignals.get(key)] ?? -1) : -1;
  return CONFIDENCE_RANK[cand.confidence] > prevRank;
}

function markFired(symbol, cand) {
  firedSignals.set(`${symbol}:${cand.id}:${cand.position}`, cand.confidence);
}

// ─── Tick ─────────────────────────────────────────────────────────────────────

// tfData cache — refreshed every REFRESH_EVERY ticks (≈ every 5 min at 30s interval)
const tfCache = new Map();
let tickCount = 0;
let lastTickDay = null;
let warmedUpToday = false;
const REFRESH_EVERY = 10;
const TICK_MS = 30_000;

async function tick(rules) {
  const { watchlist = [], session = {} } = rules;

  const today = todayET();
  if (lastTickDay && lastTickDay !== today) {
    firedSignals.clear();
    tfCache.clear();
    lastKnownPrices.clear();
    wasInSession = false;
    tickCount = 0;
    warmedUpToday = false;
    console.log(`\n[VIGIA] 📅 Nuevo día (${today}) — estado reiniciado`);
  }
  lastTickDay = today;

  const inSession = isInSessionWindow(session.primary_window);
  if (!inSession) {
    if (wasInSession && rules.paper_trading?.enabled) {
      for (const symbol of watchlist) {
        const px = lastKnownPrices.get(symbol);
        if (px != null && px > 0) {
          await onSessionEnd(symbol, px);
        } else {
          console.warn(`[PAPER] ⚠️ Sin precio para ${symbol} al fin de sesión — posición permanece abierta`);
        }
      }
      wasInSession = false;
    }
    if (!warmedUpToday && isInWarmupWindow(session.primary_window, session.warmup_minutes)) {
      console.log(`\n[VIGIA] 🔥 Precalentando caché D1/H1/M15 (${session.warmup_minutes} min antes de apertura)...`);
      for (const symbol of watchlist) {
        try {
          const scan = await scanSymbol(symbol);
          tfCache.set(symbol, scan.tfData);
        } catch (err) {
          console.error(`[VIGIA] ⚠️ Precalentamiento falló para ${symbol}:`, err.message);
        }
      }
      warmedUpToday = true;
      console.log(`[VIGIA] ✅ Caché precalentada — lista para apertura`);
    }
    process.stdout.write(".");
    return;
  }
  wasInSession = true;

  tickCount++;
  // Skip the forced tick-1 refresh if the warmup pass already populated tfCache today.
  const doRefresh = tickCount % REFRESH_EVERY === 1 && !(tickCount === 1 && warmedUpToday);
  const tickBarTime = new Date(); // captured once per tick so all symbols share the same timestamp

  for (const symbol of watchlist) {
    try {
      let price, tfData;

      if (doRefresh || !tfCache.has(symbol)) {
        console.log(`\n[VIGIA] 🔄 Escaneando ${symbol} (D1/H1/M15)...`);
        const scan = await scanSymbol(symbol);
        price = scan.price;
        tfData = scan.tfData;
        tfCache.set(symbol, tfData);
      } else {
        // getQuote({ symbol }) switches chart internally — save and restore.
        const origFast = await chart.getState().catch(() => null);
        const q = await data.getQuote({ symbol }).catch(() => null);
        if (origFast?.symbol && origFast.symbol !== symbol) {
          await chart.setSymbol({ symbol: origFast.symbol }).catch(() => {});
        }
        price = q?.last ?? q?.close ?? null;
        tfData = tfCache.get(symbol);
      }

      if (price == null) continue;
      lastKnownPrices.set(symbol, price);

      // Paper trading: OCO monitor for open positions (independent of signals)
      if (rules.paper_trading?.enabled) {
        await onTick(symbol, price);
      }

      const candidates = screenStrategies(price, tfData, tickBarTime);
      const vetoFlags  = buildVetoFlags(rules, symbol);

      for (const cand of candidates) {
        if (shouldFire(symbol, cand)) {
          await fireAlert(symbol, cand, price, vetoFlags);
          markFired(symbol, cand);
          // Paper trading: open position alongside fireAlert (NOT inside it)
          if (rules.paper_trading?.enabled) {
            await onSignal(
              { ticker: symbol, strategy_id: cand.id, side: cand.position, confidence: cand.confidence, veto_flags: vetoFlags, note: cand.note },
              price,
              rules.paper_trading
            );
          }
        }
      }
    } catch (err) {
      console.warn(`\n[VIGIA] ⚠️ Error procesando ${symbol}: ${err.message}`);
    }
  }

  await flushEmailBuffer();
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  VIGÍA — Detector de señales en tiempo real");
  console.log(`  Modo: ${DRY_RUN ? "DRY-RUN (sin alertas reales)" : "ACTIVO"}`);
  console.log("═══════════════════════════════════════════════════");

  const { rules, path: rulesFrom } = loadRules();
  console.log(`  rules.json: ${rulesFrom}`);
  console.log(`  Watchlist : ${(rules.watchlist || []).join(", ")}`);
  console.log(`  Ventana   : ${rules.session?.primary_window || "09:30-11:30 ET"}` +
    (rules.session?.warmup_minutes ? ` (precalentamiento ${rules.session.warmup_minutes} min antes)` : ""));
  console.log(`  Log JSONL : ${signalLogPath()}`);
  const htmlPath = updateSignalsHtml();
  console.log(`  Dashboard : ${htmlPath}`);
  const paperEnabled = rules.paper_trading?.enabled === true;
  console.log(`  Paper trd : ${paperEnabled ? `ACTIVO (min_score=${rules.paper_trading.min_score ?? 60})` : "DESACTIVADO (enabled=false)"}`);
  console.log("  Ctrl+C para detener\n");

  if (paperEnabled) reportStartupState();

  // First tick immediately (forces full scan)
  await tick(rules);

  const interval = setInterval(async () => {
    try { await tick(rules); }
    catch (err) { console.error("[VIGIA] ❌ Error en tick:", err.message); }
  }, TICK_MS);

  process.on("SIGINT", () => {
    console.log("\n[VIGIA] Detenido.");
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[VIGIA] ❌ Error fatal:", err.message);
  process.exit(1);
});
