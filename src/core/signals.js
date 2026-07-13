/**
 * Pure signal-detection engine shared by morning_brief, watcher, and future backtest.
 * No I/O, no side effects — input is price + multi-TF data, output is strategy candidates.
 *
 * Each tfData slot (D1 / H1 / M15) expects:
 *   { bb: {basis, upper, lower, width}, smas: number[],
 *     bb_position: string, ma_order: string }
 */

/** Parse locale number string "284,26" → 284.26 */
export function parseNum(str) {
  if (!str || typeof str !== "string") return null;
  const clean = str.trim().split(" ")[0];
  const val = parseFloat(clean.replace(",", "."));
  return isNaN(val) ? null : val;
}

/** Extract Bollinger Bands values from raw study data */
export function extractBB(studies) {
  const bb = studies?.studies?.find((s) => s.name === "Bollinger Bands");
  if (!bb?.values) return null;
  const basis = parseNum(bb.values.Basis);
  const upper = parseNum(bb.values.Upper);
  const lower = parseNum(bb.values.Lower);
  if (basis == null || upper == null || lower == null) return null;
  return { basis, upper, lower, width: parseFloat((upper - lower).toFixed(4)) };
}

/** Extract SMA values ordered as returned (assumed MA20, MA40, MA100, MA200) */
export function extractSMAs(studies) {
  return (studies?.studies || [])
    .filter((s) => s.name === "Simple Moving Average" || s.name === "Moving Average")
    .map((s) => parseNum(s.values?.MA))
    .filter((v) => v != null);
}

/** Assess price position relative to BB middle band */
export function bbPosition(price, bb) {
  if (!bb || price == null) return "unknown";
  if (price > bb.upper) return "above_upper";
  if (price < bb.lower) return "below_lower";
  if (price > bb.basis) return "above_middle";
  if (price < bb.basis) return "below_middle";
  return "at_middle";
}

/**
 * Assess MA trend order.
 * Returns: alcista | bajista | entrelazado | mixto_alcista | mixto_bajista
 */
export function maOrder(price, smas) {
  if (!smas || smas.length < 4) return "insufficient_data";
  const [ma20, ma40, ma100, ma200] = smas;
  const ordered_up = ma20 > ma40 && ma40 > ma100 && ma100 > ma200;
  const ordered_dn = ma20 < ma40 && ma40 < ma100 && ma100 < ma200;
  if (ordered_up && price > ma20) return "alcista";
  if (ordered_dn && price < ma20) return "bajista";
  if (!ordered_up && !ordered_dn) return "entrelazado";
  return price > ma20 ? "mixto_alcista" : "mixto_bajista";
}

// Convert a UTC Date to minutes since midnight in ET (approximate DST)
function toETMinutes(date) {
  const month = date.getUTCMonth() + 1; // 1-12
  const offsetH = month >= 3 && month <= 11 ? 4 : 5; // EDT vs EST
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes();
  return utcMin - offsetH * 60;
}

/**
 * Preliminary strategy screening based on multi-TF data.
 * STRAT-01/02 trendline+MA20+M15 triggers are fully automated (2026-07-13) when
 * tfData.H1 carries trendline_up/trendline_dn/last_closed_close (computed in watcher.js
 * from live OHLCV via computeTrendlineAt()); without those fields they degrade gracefully
 * to the PC-001-only "watch" behavior. STRAT-08/09's M15 trendline remains manual.
 *
 * @param {number|null} price    Current price
 * @param {{ D1: object, H1: object, M15: object }} tfData  Per-TF indicators
 * @param {Date|null} [barTime]  Timestamp of current bar (UTC). Required for STRAT-12 timing gate.
 * @returns {{ id, position, confidence, note }[]}
 */
export function screenStrategies(price, tfData, barTime = null) {
  if (price == null) return [];
  const candidates = [];
  const d1 = tfData.D1 || {};
  const h1 = tfData.H1 || {};
  const m15 = tfData.M15 || {};
  const NARROW = 5;

  const d1BBPos = d1.bb_position;
  const h1BBPos = h1.bb_position;
  const m15BBPos = m15.bb_position;
  const d1MAOrd = d1.ma_order;
  const h1MAOrd = h1.ma_order;
  const m15MAOrd = m15.ma_order;
  const m15Width = m15.bb?.width;

  // STRAT-01 CALL — Cambio tendencia al alza (rules.json PC-001/TR-001/TR-002/CF-001)
  // Automatizado 2026-07-13: los 3 triggers ya no requieren confirmación manual.
  // TR-001: cierre de la última vela H1 CERRADA por encima de la trendline de resistencia
  //   (regresión lineal sobre máximos, 20 velas H1 — tfData.H1.trendline_up, calculada en
  //   watcher.js desde OHLCV real vía computeTrendlineAt()).
  // TR-002: cierre de esa misma vela H1 por encima de la SMA20 H1 (vela de confirmación).
  // CF-001: M15 confirma alcista (bb_position/ma_order).
  // Se usa el cierre de vela YA CERRADA (last_closed_close), no el precio intradía en vivo,
  // para no disparar con una mecha que rompe y se devuelve — decisión explícita del usuario.
  {
    const h1TrendlineUp = h1.trendline_up;
    const h1LastClose = h1.last_closed_close;
    const h1Sma20 = h1.smas?.[0];
    const bearishCtx = h1BBPos === "below_middle" || h1MAOrd === "bajista" || h1MAOrd === "mixto_bajista";
    const trendlineBroken = h1TrendlineUp != null && h1LastClose != null && h1LastClose > h1TrendlineUp.value;
    const ma20Broken = h1Sma20 != null && h1LastClose != null && h1LastClose > h1Sma20;
    const m15Confirmed = m15BBPos === "above_middle" || m15MAOrd === "alcista";

    if (bearishCtx || trendlineBroken || ma20Broken) {
      const confirmed = [];
      const pending = [];
      if (bearishCtx) confirmed.push("H1 bajista (PC-001)");
      if (trendlineBroken) confirmed.push("ruptura trendline H1"); else pending.push("ruptura trendline H1");
      if (ma20Broken) confirmed.push("cierre sobre MA20 H1"); else pending.push("cierre sobre MA20 H1");
      if (m15Confirmed) confirmed.push("M15 confirmación alcista"); else pending.push("M15 confirmación alcista");

      const metCount = [trendlineBroken, ma20Broken, m15Confirmed].filter(Boolean).length;
      const confidence = metCount === 3 ? "conditions_met" : metCount >= 1 ? "setup_forming" : "watch";

      candidates.push({
        id: "STRAT-01", position: "CALL", confidence,
        note: `Cambio tendencia alcista: ${confirmed.map(x => x + " ✅").join(" + ")}${pending.map(x => " · " + x + " 🔲").join("")}`,
      });
    }
  }

  // STRAT-02 PUT — Cambio tendencia a la baja (rules.json PC-001/TR-001/TR-002/CF-001)
  // Automatizado 2026-07-13 — espejo de STRAT-01: trendline de soporte (mínimos,
  // tfData.H1.trendline_dn), ruptura por debajo de SMA20 H1, confirmación M15 bajista.
  // Ver comentario de STRAT-01 arriba.
  {
    const h1TrendlineDn = h1.trendline_dn;
    const h1LastClose = h1.last_closed_close;
    const h1Sma20 = h1.smas?.[0];
    const bullishCtx = h1BBPos === "above_middle" || h1MAOrd === "alcista" || h1MAOrd === "mixto_alcista";
    const trendlineBroken = h1TrendlineDn != null && h1LastClose != null && h1LastClose < h1TrendlineDn.value;
    const ma20Broken = h1Sma20 != null && h1LastClose != null && h1LastClose < h1Sma20;
    const m15Confirmed = m15BBPos === "below_middle" || m15MAOrd === "bajista";

    if (bullishCtx || trendlineBroken || ma20Broken) {
      const confirmed = [];
      const pending = [];
      if (bullishCtx) confirmed.push("H1 alcista (PC-001)");
      if (trendlineBroken) confirmed.push("ruptura trendline H1"); else pending.push("ruptura trendline H1");
      if (ma20Broken) confirmed.push("cierre bajo MA20 H1"); else pending.push("cierre bajo MA20 H1");
      if (m15Confirmed) confirmed.push("M15 confirmación bajista"); else pending.push("M15 confirmación bajista");

      const metCount = [trendlineBroken, ma20Broken, m15Confirmed].filter(Boolean).length;
      const confidence = metCount === 3 ? "conditions_met" : metCount >= 1 ? "setup_forming" : "watch";

      candidates.push({
        id: "STRAT-02", position: "PUT", confidence,
        note: `Cambio tendencia bajista: ${confirmed.map(x => x + " ✅").join(" + ")}${pending.map(x => " · " + x + " 🔲").join("")}`,
      });
    }
  }

  // STRAT-03 — non_operative en rules.json; no se emite.

  // STRAT-04/05 — Apertura fuera de Bollinger (rules.json CF-002: primeros 5 min; TR-001: precio ya fuera de banda)
  // Gate: 09:30–09:35 ET (CF-002). Precio debe estar FUERA de la banda (TR-001 ya ocurrió).
  // Sin barTime → no emite (no se puede verificar la ventana de apertura).
  const openingWindowOk = barTime ? (() => {
    const etMin = toETMinutes(barTime);
    return etMin >= 9 * 60 + 30 && etMin <= 9 * 60 + 35;
  })() : false;

  if (openingWindowOk && m15Width != null && m15Width < NARROW) {
    if (m15BBPos === "above_upper") {
      candidates.push({
        id: "STRAT-04", position: "PUT", confidence: "conditions_met",
        note: `BB M15 estrecho (${m15Width.toFixed(2)}) + precio sobre banda superior ✅ → GAP extremo al alza confirmado, esperar reversión (CF-002: ejecutar dentro de 5 min apertura)`,
      });
    }
    if (m15BBPos === "below_lower") {
      candidates.push({
        id: "STRAT-05", position: "CALL", confidence: "conditions_met",
        note: `BB M15 estrecho (${m15Width.toFixed(2)}) + precio bajo banda inferior ✅ → GAP extremo a la baja confirmado, esperar reversión (CF-002: ejecutar dentro de 5 min apertura)`,
      });
    }
  }

  // STRAT-08/09 — Double Green CT15 (Cambio de Tendencia M15)
  // Gate de tiempo: SOLO 1ª vela M15 (09:30–09:45 ET). Sin barTime → no emite.
  // Gate de contexto: D1 o H1 deben confirmar la dirección — sin contexto no hay CT15.
  const h1BearishCtx = h1BBPos === "below_middle" || h1MAOrd === "bajista" || h1MAOrd === "mixto_bajista";
  const h1BullishCtx = h1BBPos === "above_middle" || h1MAOrd === "alcista" || h1MAOrd === "mixto_alcista";
  const d1BearishCtx = d1BBPos === "below_middle" || d1MAOrd === "bajista" || d1MAOrd === "mixto_bajista";
  const d1BullishCtx = d1BBPos === "above_middle" || d1MAOrd === "alcista" || d1MAOrd === "mixto_alcista";
  const m15InsideBands = m15BBPos != null && !["above_upper", "below_lower"].includes(m15BBPos);
  const m15BelowMid   = m15BBPos === "below_middle";
  const m15AboveMid   = m15BBPos === "above_middle";

  let ct15TimingOk = false;
  if (barTime) {
    const etMin = toETMinutes(barTime);
    ct15TimingOk = etMin >= 9 * 60 + 30 && etMin <= 9 * 60 + 45;
  }

  // STRAT-08 CALL: M15 bajo PM dentro BB + contexto D1/H1 bajista + 1ª vela M15
  if (ct15TimingOk && m15InsideBands && !m15AboveMid && (d1BearishCtx || h1BearishCtx)) {
    const confirmed = [];
    const pending   = [];
    if (m15BelowMid)   confirmed.push("M15 bajo PM dentro BB"); else pending.push("M15 bajo PM");
    if (d1BearishCtx)  confirmed.push("D1 bajista");            else pending.push("D1 bajista");
    if (h1BearishCtx)  confirmed.push("H1 bajista");            else pending.push("H1 bajista");
    pending.push("trendline M15 trazada", "gap up rompe PM+trendline al abrir", "BB abre 1ª~3ª vela M15");
    candidates.push({
      id: "STRAT-08", position: "CALL",
      confidence: (m15BelowMid && d1BearishCtx && h1BearishCtx) ? "setup_forming" : "watch",
      note: `CT15 CALL: ${confirmed.map(x => x + " ✅").join(" + ")}${pending.map(x => " · " + x + " 🔲").join("")}`,
    });
  }

  // STRAT-09 PUT: M15 sobre PM dentro BB + contexto D1/H1 alcista + 1ª vela M15
  if (ct15TimingOk && m15InsideBands && !m15BelowMid && (d1BullishCtx || h1BullishCtx)) {
    const confirmed = [];
    const pending   = [];
    if (m15AboveMid)   confirmed.push("M15 sobre PM dentro BB"); else pending.push("M15 sobre PM");
    if (d1BullishCtx)  confirmed.push("D1 alcista");             else pending.push("D1 alcista");
    if (h1BullishCtx)  confirmed.push("H1 alcista");             else pending.push("H1 alcista");
    pending.push("trendline M15 trazada", "gap down rompe PM+trendline al abrir", "BB abre 1ª~3ª vela M15");
    candidates.push({
      id: "STRAT-09", position: "PUT",
      confidence: (m15AboveMid && d1BullishCtx && h1BullishCtx) ? "setup_forming" : "watch",
      note: `CT15 PUT: ${confirmed.map(x => x + " ✅").join(" + ")}${pending.map(x => " · " + x + " 🔲").join("")}`,
    });
  }

  // STRAT-10/11 — non_operative en rules.json; no se emiten.

  // STRAT-12 — Segundo Salto (timing gate: 15:45–15:55 ET)
  // Pre-conditions are pre-computed in d1.strat12 by screener.js or watcher enrichment.
  // Without d1.strat12, the signal is not emitted (complex multi-bar conditions).
  const strat12 = d1.strat12;
  if (strat12 && !strat12.fed_near && !strat12.earnings_near && strat12.tendencia_agotada) {
    const sma20D1 = d1.smas?.[0];
    const sma40D1 = d1.smas?.[1];
    const priceInsideBBD1 = d1BBPos && !["above_upper", "below_lower"].includes(d1BBPos);

    // Gate USD 1: |SMA20 - SMA40| spread > $1 (abs because MA order matches trend direction)
    const spread = sma20D1 != null && sma40D1 != null ? Math.abs(sma20D1 - sma40D1) : 0;
    const callGate = spread > 1 && price > sma20D1;
    const putGate  = spread > 1 && price < sma20D1;
    const gateOk = strat12.position === "CALL" ? callGate : putGate;

    if (priceInsideBBD1 && gateOk) {
      // Timing gate: 15:45–15:55 ET
      let timingOk = false;
      let timingNote = "sin barTime → watch";
      if (barTime) {
        const etMin = toETMinutes(barTime);
        timingOk = etMin >= 15 * 60 + 45 && etMin <= 15 * 60 + 55;
        const hh = Math.floor(Math.abs(etMin) / 60);
        const mm = String(Math.abs(etMin) % 60).padStart(2, "0");
        timingNote = timingOk
          ? `${hh}:${mm} ET ✅`
          : `fuera de horario (${hh}:${mm} ET)`;
      }
      candidates.push({
        id: "STRAT-12",
        position: strat12.position,
        confidence: timingOk ? "conditions_met" : "watch",
        note: `STRAT-12: primer_salto=gap overnight (${strat12.primer_salto_gap?.toFixed(2)}), gate USD 1 con SMA40 (aprox. EMA40), macro_filter=OK. Timing: ${timingNote}`,
      });
    }
  }

  // STRAT-13 — Saliendo de BB con Volatilidad
  // Prioridad (rules.json execution_profiles.double_green): si STRAT-08/09 ya está en candidates
  // para este tick, STRAT-13 se suprime — misma entrada no puede clasificarse con dos IDs.
  // STRAT-13-CF-001: precio debe estar DENTRO de BB (no tocando ni fuera).
  // Requiere m15.bb_prev_width pre-computado para detectar expansión de volatilidad (TR-001).
  const m15CurrentWidth = m15.bb?.width ?? null;
  const m15PrevWidth = m15.bb_prev_width ?? null;
  const m15PriceInside =
    m15BBPos != null && !["above_upper", "below_lower"].includes(m15BBPos);
  const widthExpanding =
    m15CurrentWidth != null && m15PrevWidth != null && m15CurrentWidth > m15PrevWidth;
  const ct15AlreadyFired = candidates.some(c => c.id === "STRAT-08" || c.id === "STRAT-09");

  if (!ct15AlreadyFired && m15PriceInside) {
    const callDir = m15BBPos === "above_middle";
    const putDir  = m15BBPos === "below_middle";
    if (callDir || putDir) {
      if (widthExpanding) {
        candidates.push({
          id: "STRAT-13",
          position: callDir ? "CALL" : "PUT",
          confidence: "conditions_met",
          note: `STRAT-13: precio dentro de BB (${m15BBPos}) ✅, width expandiendo (${m15PrevWidth.toFixed(2)} → ${m15CurrentWidth.toFixed(2)}) ✅. CF-001: no expuesto ✅`,
        });
      }
    }
  }

  return candidates;
}
