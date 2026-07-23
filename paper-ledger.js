/**
 * paper-ledger.js — Ledger local de paper trades (sin broker).
 *
 * Escribe JSONL a PAPER_LEDGER_DIR (default: ~/.tradingview-mcp/paper-trades/).
 * Mantiene open-positions.json para sobrevivir reinicios del watcher.
 *
 * OCO basado en precio del subyacente (proxy — no refleja theta decay ni spread de opciones).
 * Target: +12% sobre subyacente · Stop: -15% sobre subyacente.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

// ─── Paths ────────────────────────────────────────────────────────────────────

let _ledgerDir = null;
function ledgerDir() {
  if (_ledgerDir) return _ledgerDir;
  const dir = process.env.PAPER_LEDGER_DIR
    ? resolve(process.env.PAPER_LEDGER_DIR)
    : join(homedir(), ".tradingview-mcp", "paper-trades");
  mkdirSync(dir, { recursive: true });
  _ledgerDir = dir;
  return dir;
}

/** ET calendar date (YYYY-MM-DD) for an arbitrary ISO timestamp. */
export function etDateFromISO(iso) {
  return new Date(iso)
    .toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/(\d+)\/(\d+)\/(\d+)/, "$3-$1-$2");
}

export function todayET() {
  return etDateFromISO(new Date().toISOString());
}

function ledgerFilePath() {
  return join(ledgerDir(), `paper-trades-${todayET()}.jsonl`);
}

function openPositionsPath() {
  return join(ledgerDir(), "open-positions.json");
}

// ─── Open positions (persisted to disk) ──────────────────────────────────────

export function loadOpenPositions() {
  const p = openPositionsPath();
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveOpenPositions(positions) {
  try {
    writeFileSync(openPositionsPath(), JSON.stringify(positions, null, 2), "utf8");
  } catch (e) {
    console.error("[PAPER] ⚠️ No se pudo guardar open-positions.json:", e.message);
  }
}

// ─── Position lifecycle ───────────────────────────────────────────────────────

/**
 * Open a new paper position.
 * @param {{ id, ticker, strategy_id, side, confidence, score, underlying_entry_price, veto_flags }} pos
 */
export function openPosition(pos) {
  const positions = loadOpenPositions();
  // CALL profits when the underlying rises, so target sits above entry and stop below.
  // PUT profits when the underlying falls, so the bands are mirrored.
  const isPut = pos.side === "PUT";
  const targetMult = isPut ? 0.88 : 1.12;
  const stopMult = isPut ? 1.15 : 0.85;
  const entry = {
    ...pos,
    opened_at: new Date().toISOString(),
    target_price_underlying: parseFloat((pos.underlying_entry_price * targetMult).toFixed(4)),
    stop_price_underlying: parseFloat((pos.underlying_entry_price * stopMult).toFixed(4)),
  };
  positions.push(entry);
  saveOpenPositions(positions);
  console.log(
    `[PAPER] 📋 Posición abierta: ${pos.ticker} ${pos.side} ${pos.strategy_id}` +
    ` @$${pos.underlying_entry_price} | target $${entry.target_price_underlying} | stop $${entry.stop_price_underlying}`
  );
  return entry;
}

/**
 * Close an open position and append the completed trade to JSONL.
 * @param {string} posId
 * @param {number} exitPrice  underlying exit price
 * @param {string} exitReason  "target" | "stop" | "expiry"
 */
export function closePosition(posId, exitPrice, exitReason) {
  const positions = loadOpenPositions();
  const idx = positions.findIndex((p) => p.id === posId);
  if (idx === -1) return;

  const pos = positions[idx];
  positions.splice(idx, 1);
  saveOpenPositions(positions);

  const rawDelta = exitPrice - pos.underlying_entry_price;
  // PUT profits on a price drop — flip the sign so R_result stays positive on a win either way.
  const priceDelta = pos.side === "PUT" ? -rawDelta : rawDelta;
  const riskAmount = pos.underlying_entry_price * 0.15;
  const R_result = parseFloat((priceDelta / riskAmount).toFixed(3));

  const trade = {
    ...pos,
    closed_at: new Date().toISOString(),
    underlying_exit_price: exitPrice,
    exit_reason: exitReason,
    R_result,
    proxy_note: `proxy subyacente — no refleja theta decay ni spread bid/ask de opción`,
  };

  try {
    appendFileSync(ledgerFilePath(), JSON.stringify(trade) + "\n", "utf8");
  } catch (e) {
    console.error("[PAPER] ⚠️ No se pudo escribir ledger JSONL:", e.message);
  }

  const rSign = R_result >= 0 ? "+" : "";
  console.log(
    `[PAPER] ✅ Posición cerrada: ${pos.ticker} ${pos.side} ${pos.strategy_id}` +
    ` @$${exitPrice} (${exitReason}) | R=${rSign}${R_result}`
  );
  return trade;
}

// ─── OCO check (called every tick per symbol) ─────────────────────────────────

/**
 * Check if any open position for `ticker` has hit its target or stop.
 * @param {string} ticker
 * @param {number} currentPrice  current underlying price
 * @returns {string[]}  IDs of positions that were closed
 */
export function checkOCO(ticker, currentPrice) {
  const positions = loadOpenPositions();
  const closed = [];

  for (const pos of positions) {
    if (pos.ticker !== ticker) continue;

    // CALL: target is above entry (price rising), stop is below.
    // PUT: mirrored — target is below entry (price falling), stop is above.
    const isPut = pos.side === "PUT";
    const hitTarget = isPut
      ? currentPrice <= pos.target_price_underlying
      : currentPrice >= pos.target_price_underlying;
    const hitStop = isPut
      ? currentPrice >= pos.stop_price_underlying
      : currentPrice <= pos.stop_price_underlying;

    if (hitTarget) {
      closePosition(pos.id, currentPrice, "target");
      closed.push(pos.id);
    } else if (hitStop) {
      closePosition(pos.id, currentPrice, "stop");
      closed.push(pos.id);
    }
  }

  return closed;
}

/**
 * Close all open positions for a ticker at end of session (expiry).
 * @param {string} ticker
 * @param {number} currentPrice
 */
export function expirePositions(ticker, currentPrice) {
  const positions = loadOpenPositions();
  for (const pos of positions) {
    if (pos.ticker !== ticker) continue;
    closePosition(pos.id, currentPrice, "expiry");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True if there is already an open position for this ticker+side combo */
export function hasOpenPosition(ticker, side) {
  return loadOpenPositions().some((p) => p.ticker === ticker && p.side === side);
}

export function ledgerPath() {
  return ledgerFilePath();
}
