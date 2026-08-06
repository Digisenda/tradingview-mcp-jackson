/**
 * paper-executor.js — Simulador de ejecución para paper trading local.
 *
 * Recibe señales de watcher.js (called alongside fireAlert, NOT inside it).
 * Registra posiciones en paper-ledger.js y monitorea OCO (+12% / -15%) basado en
 * precio del subyacente (proxy — no datos de opciones).
 *
 * Habilitado únicamente cuando rules.paper_trading.enabled === true.
 * Score mapping: watch=40, setup_forming=60, conditions_met=80.
 */

import {
  openPosition,
  closePosition,
  checkOCO,
  hasOpenPosition,
  ledgerPath,
  loadOpenPositions,
  todayET,
  etDateFromISO,
} from "./paper-ledger.js";

// ─── Score mapping ────────────────────────────────────────────────────────────

/** Map confidence level to numeric score. Returns 0 for unknown. */
export function scoreFromConfidence(confidence) {
  switch (confidence) {
    case "watch":           return 40;
    case "setup_forming":   return 60;
    case "conditions_met":  return 80;
    default:                return 0;
  }
}

// ─── Position ID ──────────────────────────────────────────────────────────────

function makePositionId(ticker, stratId, side) {
  return `${ticker}-${stratId}-${side}-${Date.now()}`;
}

// ─── Signal handler ───────────────────────────────────────────────────────────

/**
 * Called alongside fireAlert() in watcher tick when paper_trading.enabled === true.
 *
 * @param {{ ticker, strategy_id, side, confidence, veto_flags, note }} signalEvent
 * @param {number} price  current underlying price
 * @param {{ enabled, min_score }} ptConfig  from rules.paper_trading
 */
export async function onSignal(signalEvent, price, ptConfig) {
  try {
    const { ticker, strategy_id, side, confidence, veto_flags = [], note } = signalEvent;

    if (!price || price <= 0) {
      console.warn(`[PAPER] ⚠️ ${ticker}: precio inválido ($${price}) — señal omitida`);
      return;
    }

    const score = scoreFromConfidence(confidence);
    const minScore = ptConfig.min_score ?? 60;

    if (score < minScore) {
      return;
    }

    if (hasOpenPosition(ticker, side)) {
      console.log(`[PAPER] ⏭️ ${ticker} ${side}: ya hay posición abierta — señal omitida`);
      return;
    }

    openPosition({
      id: makePositionId(ticker, strategy_id, side),
      ticker,
      strategy_id,
      side,
      confidence,
      score,
      underlying_entry_price: price,
      veto_flags,
      ...(note != null && { note }),
    });
  } catch (e) {
    console.error("[PAPER] ⚠️ Error en onSignal:", e.message);
  }
}

// ─── OCO monitor ──────────────────────────────────────────────────────────────

/**
 * Called on each watcher tick for each symbol to check OCO levels.
 * Session-end expiry is handled separately via onSessionEnd.
 *
 * @param {string} ticker
 * @param {number} currentPrice  current underlying price
 */
export async function onTick(ticker, currentPrice) {
  try {
    checkOCO(ticker, currentPrice);
  } catch (e) {
    console.error("[PAPER] ⚠️ Error en onTick:", e.message);
  }
}

// ─── Session end ──────────────────────────────────────────────────────────────

/**
 * Called by watcher when the session window closes (NOT inside the tick path).
 * Uses last known underlying price so no extra fetch is needed.
 *
 * Strategies whose rules.json entry declares `exit_override.sell_at_market_open
 * === false` (e.g. STRAT-12, an overnight swing) are held open instead of
 * expired — checkOCO() picks them back up on the next session's ticks. An
 * unknown/missing strategy_id or a missing `rules` argument fails toward the
 * safe default (expire), matching the pre-existing behavior.
 *
 * @param {string} ticker
 * @param {number} lastPrice  last underlying price seen during the session
 * @param {object} [rules]  parsed rules.json — used to look up exit_override per strategy
 */
export async function onSessionEnd(ticker, lastPrice, rules = null) {
  try {
    const open = loadOpenPositions().filter((p) => p.ticker === ticker);
    if (open.length === 0) return;

    const strategies = rules?.strategies || [];
    let closedCount = 0;

    for (const pos of open) {
      const stratDef = strategies.find((s) => s.id === pos.strategy_id);
      const holdsOvernight = stratDef?.exit_override?.sell_at_market_open === false;

      if (holdsOvernight) {
        console.log(
          `[PAPER] 🌙 ${pos.ticker} ${pos.side} ${pos.strategy_id} — ` +
          `exit_override.sell_at_market_open=false, mantiene overnight (no expira)`
        );
        continue;
      }
      closePosition(pos.id, lastPrice, "expiry");
      closedCount++;
    }

    if (closedCount > 0) {
      console.log(
        `[PAPER] 🕐 Fin de sesión — expiradas ${closedCount} posición(es) para ${ticker} @$${lastPrice}`
      );
    }
  } catch (e) {
    console.error("[PAPER] ⚠️ Error en onSessionEnd:", e.message);
  }
}

// ─── Carried-over position cleanup ───────────────────────────────────────────

/**
 * Expire positions opened on a prior ET trading day that don't have an overnight
 * exit_override (e.g. STRAT-12). onSessionEnd() only fires when the SAME watcher
 * process is still alive at market close — since the normal workflow is to stop
 * the vigía with Ctrl+C once the user is done trading (well before 16:00 ET), that
 * path never runs and same-day-only strategies (STRAT-01/02/etc.) can accumulate
 * indefinitely in open-positions.json across restarts. Call this once at startup,
 * before reportStartupState(), so stale positions get closed with a real price
 * instead of being re-reported forever.
 *
 * @param {object} rules  parsed rules.json — used to look up exit_override per strategy
 * @param {Map<string, number>} priceByTicker  fresh quote per ticker that has a stale position
 * @param {{ sessionEndedToday?: boolean }} [opts]  when true, also expires positions
 *   opened TODAY (not just prior days) — for restarts that happen after today's
 *   session already closed, where onSessionEnd() never got a chance to run either.
 * @returns {{ expiredCount: number, skipped: string[] }}  skipped = position ids left open (no price available)
 */
export function expireStalePositions(rules, priceByTicker, { sessionEndedToday = false } = {}) {
  const positions = loadOpenPositions();
  const today = todayET();
  const strategies = rules?.strategies || [];
  let expiredCount = 0;
  const skipped = [];

  for (const pos of positions) {
    const posDay = etDateFromISO(pos.opened_at);
    // Opened today, and today's session hasn't closed yet — leave to normal OCO/session-end handling.
    if (posDay === today && !sessionEndedToday) continue;

    const stratDef = strategies.find((s) => s.id === pos.strategy_id);
    const holdsOvernight = stratDef?.exit_override?.sell_at_market_open === false;
    if (holdsOvernight) continue; // e.g. STRAT-12 — legitimately carried over

    const price = priceByTicker.get(pos.ticker);
    if (price == null || price <= 0) {
      skipped.push(pos.id);
      continue;
    }

    closePosition(pos.id, price, "expiry");
    console.log(
      `[PAPER] 🧹 ${pos.ticker} ${pos.side} ${pos.strategy_id} — expirada al reiniciar` +
      ` (abierta ${posDay}, sin exit_override overnight) @$${price}`
    );
    expiredCount++;
  }

  return { expiredCount, skipped };
}

// ─── Startup report ───────────────────────────────────────────────────────────

export function reportStartupState() {
  const open = loadOpenPositions();
  if (open.length === 0) {
    console.log(`[PAPER] ✅ Sin posiciones abiertas al inicio. Ledger: ${ledgerPath()}`);
    return;
  }
  console.log(`[PAPER] ⚠️ ${open.length} posición(es) abiertas al reiniciar:`);
  for (const p of open) {
    console.log(
      `  ${p.ticker} ${p.side} ${p.strategy_id} — entrada $${p.underlying_entry_price}` +
      ` | target $${p.target_price_underlying} | stop $${p.stop_price_underlying}` +
      ` | desde ${p.opened_at}`
    );
  }
  console.log(`  Ledger: ${ledgerPath()}`);
}
