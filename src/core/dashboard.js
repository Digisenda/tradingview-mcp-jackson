/**
 * dashboard.js — renderer del dashboard unificado VIGÍA (reporte premercado +
 * señales en vivo + fundamentales automatizados), 4 zonas, sin scroll.
 * Tokens de color/tipografía/espaciado tomados de DESIGN.md (raíz de
 * TRADINGVIEW) — no cambiar valores aquí sin actualizar ese documento primero.
 *
 * Función pura: no hace I/O. watcher.js reúne los datos (premarketData desde
 * disco, signals desde el JSONL del día, fundamentals desde fundamentals.js)
 * y llama renderUnifiedDashboard() una vez por tick.
 */

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function fmtPrice(n) {
  return n == null ? "—" : `$${Number(n).toFixed(2)}`;
}

const CLASSIFICATION_LABEL = { ejecutar: "🟢 EJECUTAR", vigilar: "🟡 VIGILAR", no_operar: "🔴 NO OPERAR" };
const CLASSIFICATION_CLASS = { ejecutar: "green", vigilar: "yellow", no_operar: "red" };
const CONF_CLASS = { conditions_met: "met", setup_forming: "forming", watch: "watch" };

// ─── Zona 2: scorecard premercado ──────────────────────────────────────────────

function renderTickerCard(ticker) {
  const cls = CLASSIFICATION_CLASS[ticker.classification] || "watch";
  const label = CLASSIFICATION_LABEL[ticker.classification] || "—";
  const bbMid = ticker.timeframes?.D1?.bb?.middle ?? ticker.timeframes?.D1?.bb?.basis;
  const maD1 = ticker.timeframes?.D1?.ma_order || "—";
  const bestCandidate = ticker.candidates?.[0];

  return `<div class="ticker-card">
    <div class="row1">
      <span class="sym">${escapeHtml(ticker.symbol)}</span>
      <span class="score-badge ${cls}">${label}</span>
    </div>
    <div class="grid-nums mono">
      <div class="num-cell"><div class="k">Precio</div><div class="v">${fmtPrice(ticker.price)}</div></div>
      <div class="num-cell"><div class="k">BB Mid D1</div><div class="v">${bbMid != null ? Number(bbMid).toFixed(2) : "—"}</div></div>
      <div class="num-cell"><div class="k">MA Order D1</div><div class="v">${escapeHtml(maD1)}</div></div>
      <div class="num-cell"><div class="k">Estrategia</div><div class="v">${bestCandidate ? escapeHtml(bestCandidate.id) : "—"}</div></div>
    </div>
  </div>`;
}

function renderPremarketZone(premarketData) {
  if (!premarketData || !premarketData.tickers?.length) {
    return `<div class="placeholder">Sin checklist premercado hoy — corre "ejecuta checklist premarket" antes de la apertura.</div>`;
  }
  return premarketData.tickers.map(renderTickerCard).join("\n");
}

// ─── Zona 3: franja de fundamentales ────────────────────────────────────────────

function renderFundamentalsStrip(fundamentals) {
  const fedDate = fundamentals?.fedDate;
  const fedClass = fundamentals?.fedActive ? "warn" : "";
  const earningsItems = Object.entries(fundamentals?.earnings || {})
    .map(([sym, e]) => {
      const daysAway = e?.days_away;
      const label = daysAway == null ? "—" : daysAway === 0 ? "hoy" : daysAway > 0 ? `${daysAway}d` : `hace ${Math.abs(daysAway)}d`;
      const cls = e?.active ? "warn" : "";
      return `<div class="fund-item"><div class="k">Earnings ${escapeHtml(sym)}</div><div class="v ${cls}">${label}</div></div>`;
    })
    .join("\n");

  const newsItems = Object.entries(fundamentals?.news || {})
    .flatMap(([sym, items]) => (items || []).slice(0, 2).map((n) => ({ sym, ...n })))
    .slice(0, 4)
    .map((n) => `<span class="news-item"><span class="src">${escapeHtml(n.source)}</span> · ${escapeHtml(n.headline)}</span>`)
    .join("\n");

  return `<div class="fund-strip mono">
    <div class="fund-item"><div class="k">Próx. FED</div><div class="v ${fedClass}">${fedDate || "—"}</div></div>
    ${earningsItems}
    <div class="news-list">${newsItems || '<span class="news-item">Sin noticias recientes</span>'}</div>
  </div>`;
}

// ─── Zona 4: señales en vivo (mismo dato que signals-*.html) ───────────────────

function renderSignalRow(entry) {
  const conf = CONF_CLASS[entry.confidence] || "watch";
  const time = entry.logged_at
    ? new Date(entry.logged_at).toLocaleString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    : "—";
  return `<div class="signal-row">
    <span class="t mono">${time}</span>
    <span class="conf-badge ${conf}">${escapeHtml((entry.confidence || "").toUpperCase())}</span>
    <span class="strat">${escapeHtml(entry.strategy)} ${escapeHtml(entry.position || entry.side || "")} ${escapeHtml(entry.ticker)}</span>
    <span class="px mono">${fmtPrice(entry.price)}</span>
  </div>`;
}

function renderSignalsZone(signals) {
  if (!signals?.length) {
    return `<div class="placeholder">Sin señales aún hoy.</div>`;
  }
  // Más recientes primero
  return [...signals].reverse().slice(0, 30).map(renderSignalRow).join("\n");
}

// ─── HTML completo ───────────────────────────────────────────────────────────

export function renderUnifiedDashboard({ date, sessionLabel, fedWarning, premarketData, signals, fundamentals }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="30">
<title>VIGÍA — ${escapeHtml(date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=General+Sans:wght@400;500;600;700&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #10141C; --surface: #161B24; --surface-2: #1D2330; --border: #262D3B;
    --text: #E4E7EC; --text-muted: #8B94A3;
    --amber: #F5A623; --amber-dim: #4A3A1A;
    --green: #22C55E; --green-dim: #14361F;
    --red: #EF4444; --red-dim: #3A1919;
    --radius-sm: 2px; --radius-md: 4px;
    --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-6: 24px; --sp-8: 32px;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }
  h1, .label { font-family: 'General Sans', sans-serif; }
  .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
  header.page { padding: var(--sp-3) var(--sp-6); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
  header.page h1 { margin: 0; font-size: 16px; font-weight: 600; }
  header.page .session { font-size: 12px; color: var(--text-muted); }
  .fed-banner { background: var(--amber-dim); color: var(--amber); border-bottom: 1px solid var(--border); padding: var(--sp-2) var(--sp-6); font-size: 12px; }
  .fund-strip { display: flex; flex-wrap: wrap; gap: var(--sp-6); align-items: center; padding: var(--sp-2) var(--sp-6); background: var(--surface-2); border-bottom: 1px solid var(--border); font-size: 12px; }
  .fund-item .k { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .fund-item .v { font-size: 13px; margin-top: 2px; }
  .fund-item .v.warn { color: var(--amber); }
  .news-list { display: flex; gap: var(--sp-4); overflow: hidden; flex: 1; min-width: 200px; }
  .news-item { color: var(--text-muted); font-size: 11px; white-space: nowrap; }
  .news-item .src { color: #5B8DEF; }
  .body-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1px; background: var(--border); }
  .col { background: var(--bg); padding: var(--sp-4); overflow-y: auto; max-height: calc(100vh - 140px); }
  .placeholder { color: var(--text-muted); font-size: 13px; padding: var(--sp-4); }
  .ticker-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3); }
  .ticker-card .row1 { display: flex; align-items: center; justify-content: space-between; }
  .ticker-card .sym { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
  .score-badge { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .score-badge.green { background: var(--green-dim); color: var(--green); }
  .score-badge.yellow { background: #3A2F14; color: #EAB308; }
  .score-badge.red { background: var(--red-dim); color: var(--red); }
  .grid-nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sp-2); margin-top: var(--sp-3); }
  .num-cell .k { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .num-cell .v { font-size: 14px; margin-top: 2px; }
  .signal-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2); border-bottom: 1px solid var(--border); font-size: 12px; }
  .signal-row:last-child { border-bottom: none; }
  .conf-badge { font-size: 10px; padding: 1px 6px; border-radius: var(--radius-sm); font-weight: 600; }
  .conf-badge.met { background: var(--green-dim); color: var(--green); }
  .conf-badge.forming { background: #3A2F14; color: #EAB308; }
  .conf-badge.watch { background: var(--surface-2); color: var(--text-muted); }
  .signal-row .px { margin-left: auto; }
</style>
</head>
<body>
<header class="page">
  <h1>VIGÍA — ${escapeHtml(date)}</h1>
  <span class="session mono">${escapeHtml(sessionLabel || "—")}</span>
</header>
${fedWarning ? `<div class="fed-banner">⚠️ ${escapeHtml(fedWarning)} — el operador decide, el sistema no calla.</div>` : ""}
${renderFundamentalsStrip(fundamentals)}
<div class="body-grid">
  <div class="col">${renderPremarketZone(premarketData)}</div>
  <div class="col">${renderSignalsZone(signals)}</div>
</div>
</body>
</html>`;
}
