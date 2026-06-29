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
 * Full confirmation (trendlines, M15 signals) is evaluated by Claude or the watcher.
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
  const m15Width = m15.bb?.width;

  // STRAT-01 CALL — Cambio tendencia al alza
  if (h1BBPos === "below_middle" || h1MAOrd === "bajista" || h1MAOrd === "mixto_bajista") {
    candidates.push({
      id: "STRAT-01", position: "CALL", confidence: "setup_forming",
      note: "H1 bajista → vigilar ruptura trendline bajista H1 + cierre sobre MA20 H1 + confirmación M15 alcista",
    });
  }

  // STRAT-02 PUT — Cambio tendencia a la baja
  if (h1BBPos === "above_middle" || h1MAOrd === "alcista" || h1MAOrd === "mixto_alcista") {
    candidates.push({
      id: "STRAT-02", position: "PUT", confidence: "setup_forming",
      note: "H1 alcista → vigilar ruptura trendline alcista H1 + cierre bajo MA20 H1 + confirmación M15 bajista",
    });
  }

  // STRAT-03 PUT — Rebote punto medio D1 bajista
  const d1Bajista = d1BBPos === "below_middle" || d1MAOrd === "bajista";
  const h1Alcista = h1BBPos === "above_middle" || h1MAOrd === "alcista";
  if (d1Bajista && h1Alcista) {
    candidates.push({
      id: "STRAT-03", position: "PUT", confidence: "conditions_met",
      note: "D1 bajista + H1 en retroceso alcista → precio acercándose a BB Middle D1, vigilar rechazo",
    });
  }

  // STRAT-04/05 — Apertura fuera de Bollinger (requiere BB M15 estrecho)
  if (m15Width != null && m15Width < NARROW) {
    candidates.push({
      id: "STRAT-04", position: "PUT", confidence: "watch",
      note: `BB M15 estrecho (ancho: ${m15Width.toFixed(2)}) → vigilar GAP extremo sobre banda superior M15 en apertura`,
    });
    candidates.push({
      id: "STRAT-05", position: "CALL", confidence: "watch",
      note: `BB M15 estrecho (ancho: ${m15Width.toFixed(2)}) → vigilar GAP extremo bajo banda inferior M15 en apertura`,
    });
  }

  // STRAT-08/09 — Double Green CT15 (Cambio de Tendencia M15)
  const h1BearishCtx = h1BBPos === "below_middle" || h1MAOrd === "bajista" || h1MAOrd === "mixto_bajista";
  const h1BullishCtx = h1BBPos === "above_middle" || h1MAOrd === "alcista" || h1MAOrd === "mixto_alcista";
  const d1BearishCtx = d1BBPos === "below_middle" || d1MAOrd === "bajista" || d1MAOrd === "mixto_bajista";
  const d1BullishCtx = d1BBPos === "above_middle" || d1MAOrd === "alcista" || d1MAOrd === "mixto_alcista";
  const m15InsideBands = m15BBPos != null && !["above_upper", "below_lower"].includes(m15BBPos);
  const m15BelowMid   = m15BBPos === "below_middle";
  const m15AboveMid   = m15BBPos === "above_middle";

  // STRAT-08 CALL: precio M15 bajo PM (o en PM) y dentro de BB — contexto D1/H1 bajista
  if (m15InsideBands && !m15AboveMid) {
    const confirmed = [];
    const pending   = [];
    if (m15BelowMid)   confirmed.push("M15 bajo PM dentro BB"); else pending.push("M15 bajo PM");
    if (d1BearishCtx)  confirmed.push("D1 bajista");            else pending.push("D1 bajista");
    if (h1BearishCtx)  confirmed.push("H1 bajista");            else pending.push("H1 bajista");
    pending.push("trendline M15 trazada", "gap up rompe PM+trendline al abrir", "BB abre 1ª~3ª vela M15");
    candidates.push({
      id: "STRAT-08", position: "CALL",
      confidence: (m15BelowMid && (d1BearishCtx || h1BearishCtx)) ? "setup_forming" : "watch",
      note: `CT15 CALL: ${confirmed.map(x => x + " ✅").join(" + ")}${pending.map(x => " · " + x + " 🔲").join("")}`,
    });
  }

  // STRAT-09 PUT: precio M15 sobre PM (o en PM) y dentro de BB — contexto D1/H1 alcista
  if (m15InsideBands && !m15BelowMid) {
    const confirmed = [];
    const pending   = [];
    if (m15AboveMid)   confirmed.push("M15 sobre PM dentro BB"); else pending.push("M15 sobre PM");
    if (d1BullishCtx)  confirmed.push("D1 alcista");             else pending.push("D1 alcista");
    if (h1BullishCtx)  confirmed.push("H1 alcista");             else pending.push("H1 alcista");
    pending.push("trendline M15 trazada", "gap down rompe PM+trendline al abrir", "BB abre 1ª~3ª vela M15");
    candidates.push({
      id: "STRAT-09", position: "PUT",
      confidence: (m15AboveMid && (d1BullishCtx || h1BullishCtx)) ? "setup_forming" : "watch",
      note: `CT15 PUT: ${confirmed.map(x => x + " ✅").join(" + ")}${pending.map(x => " · " + x + " 🔲").join("")}`,
    });
  }

  // STRAT-10/11 — Ruptura lateral mediano plazo
  if (d1MAOrd === "entrelazado") {
    candidates.push({
      id: "STRAT-10", position: "CALL", confidence: "watch",
      note: "MAs D1 entrelazadas → vigilar señal alcista potente que rompa canal en H1 con alta volatilidad BB",
    });
    candidates.push({
      id: "STRAT-11", position: "PUT", confidence: "watch",
      note: "MAs D1 entrelazadas → vigilar señal bajista potente que rompa canal en H1 con alta volatilidad BB",
    });
  }

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
  // CORRECCIÓN CRÍTICA: trigger es precio DENTRO de BB (NO tocando ni fuera).
  // STRAT-13-CF-001: si precio ya está fuera del BB, NO entrar.
  // Requiere m15.bb_prev_width pre-computado; sin él → confidence='watch'.
  const m15CurrentWidth = m15.bb?.width ?? null;
  const m15PrevWidth = m15.bb_prev_width ?? null;
  const m15PriceInside =
    m15BBPos != null && !["above_upper", "below_lower"].includes(m15BBPos);
  const widthExpanding =
    m15CurrentWidth != null && m15PrevWidth != null && m15CurrentWidth > m15PrevWidth;

  if (m15PriceInside) {
    const callDir = m15BBPos === "above_middle"; // precio > basis, expansión alcista esperada
    const putDir  = m15BBPos === "below_middle"; // precio < basis, expansión bajista esperada
    if (callDir || putDir) {
      if (widthExpanding) {
        candidates.push({
          id: "STRAT-13",
          position: callDir ? "CALL" : "PUT",
          confidence: "conditions_met",
          note: `STRAT-13: precio dentro de BB (${m15BBPos}), width expandiendo (${m15PrevWidth.toFixed(2)} → ${m15CurrentWidth.toFixed(2)}). CF-001: precio dentro de banda ✅`,
        });
      }
    }
  }

  return candidates;
}
