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
import { readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import * as chart from "./src/core/chart.js";
import * as data from "./src/core/data.js";
import * as alerts from "./src/core/alerts.js";
import {
  extractBB,
  extractSMAs,
  bbPosition,
  maOrder,
  screenStrategies,
} from "./src/core/signals.js";

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

function signalLogPath() {
  const dir = join(homedir(), ".tradingview-mcp");
  mkdirSync(dir, { recursive: true });
  return join(dir, `signals-${todayET()}.jsonl`);
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

// ─── Email (optional — configure NODEMAILER_* in .env) ───────────────────────

async function sendEmail(subject, body) {
  const host = process.env.NODEMAILER_HOST;
  const user = process.env.NODEMAILER_USER;
  const pass = process.env.NODEMAILER_PASS;
  const to   = process.env.NODEMAILER_TO;
  if (!host || !user || !pass || !to) return;

  try {
    const { createTransport } = await import("nodemailer");
    const t = createTransport({ host, port: 465, secure: true, auth: { user, pass } });
    await t.sendMail({ from: user, to, subject, text: body });
    console.log("[VIGIA] ✉️  Email:", subject);
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND") {
      console.warn("[VIGIA] ℹ️  Email omitido — instala nodemailer: npm install nodemailer");
    } else {
      console.warn("[VIGIA] ⚠️ Email falló:", e.message);
    }
  }
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

  if (DRY_RUN) {
    console.log("        [dry-run] — sin alerta nativa ni email");
    return;
  }

  if (price != null) {
    await alerts.create({ price, message: msg }).catch((e) =>
      console.warn("[VIGIA] ⚠️ alert_create falló:", e.message)
    );
  }

  await sendEmail(
    `[VIGIA] ${candidate.id} ${candidate.position} ${symbol}`,
    [
      `Señal: ${candidate.id} ${candidate.position} en ${symbol}`,
      `Precio: $${price?.toFixed(2) ?? "?"}`,
      `Confianza: ${candidate.confidence}`,
      `Nota: ${candidate.note}`,
      vetoFlags.length ? `⚠️ Veto: ${vetoFlags.join(", ")}` : "",
      `Hora: ${new Date().toLocaleString("es-MX", { timeZone: "America/New_York" })} ET`,
    ].filter(Boolean).join("\n")
  );
}

// ─── Signal state — only fire when confidence improves ───────────────────────

const firedSignals = new Map(); // key → last confidence rank fired
const CONFIDENCE_RANK = { watch: 0, setup_forming: 1, conditions_met: 2 };

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
const REFRESH_EVERY = 10;
const TICK_MS = 30_000;

async function tick(rules) {
  const { watchlist = [], session = {} } = rules;

  const today = todayET();
  if (lastTickDay && lastTickDay !== today) {
    firedSignals.clear();
    tfCache.clear();
    tickCount = 0;
    console.log(`\n[VIGIA] 📅 Nuevo día (${today}) — estado reiniciado`);
  }
  lastTickDay = today;

  if (!isInSessionWindow(session.primary_window)) {
    process.stdout.write(".");
    return;
  }

  tickCount++;
  const doRefresh = tickCount % REFRESH_EVERY === 1; // refresh on tick 1, 11, 21...

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

      const candidates = screenStrategies(price, tfData);
      const vetoFlags  = buildVetoFlags(rules, symbol);

      for (const cand of candidates) {
        if (shouldFire(symbol, cand)) {
          await fireAlert(symbol, cand, price, vetoFlags);
          markFired(symbol, cand);
        }
      }
    } catch (err) {
      console.warn(`\n[VIGIA] ⚠️ Error procesando ${symbol}: ${err.message}`);
    }
  }
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
  console.log(`  Ventana   : ${rules.session?.primary_window || "09:30-11:30 ET"}`);
  console.log(`  Log JSONL : ${signalLogPath()}`);
  console.log("  Ctrl+C para detener\n");

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
