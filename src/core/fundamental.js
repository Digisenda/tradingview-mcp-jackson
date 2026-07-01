/**
 * Fundamental filters — FED calendar + Earnings check.
 * Scrapes Finviz for live data; falls back to rules.json dates if fetch fails.
 */
import { get } from "node:https";

const MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

// ETFs never have earnings
const ETF_SYMBOLS = new Set(["SPY", "QQQ", "IWM", "DIA", "GLD", "TLT", "XLF", "XLE"]);

// ─── HTTP helper ──────────────────────────────────────────────────────────────

export function fetchHtml(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { clearTimeout(timer); resolve(body); });
    }).on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** "Jul 29 AMC" → "2026-07-29"  (assumes current year, bumps to next if past) */
export function parseFinvizDate(raw, today = new Date()) {
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  const day = parseInt(m[2], 10);
  if (!month || !day) return null;

  const year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  // If more than 30 days in the past → must be next year
  if (candidate < new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)) {
    candidate.setFullYear(year + 1);
  }
  return candidate.toISOString().split("T")[0];
}

/** Calendar days between isoDate and today (negative = past) */
export function daysDiff(isoDate, today = new Date()) {
  const t = new Date(isoDate);
  const d = new Date(today.toISOString().split("T")[0]);
  return Math.round((t - d) / 864e5);
}

// ─── Finviz scrapers ──────────────────────────────────────────────────────────
//
// Finviz retired the old /quote.ashx and /calendar.ashx URLs and redesigned
// both pages' markup (2026-06/07). Both old URLs now chain THROUGH multiple
// 301s (.ashx → /quote?t=X → /stock?t=X ; .ashx → /calendar → /calendar/economic)
// — fetchHtml() does not follow redirects, so these must be the final URLs,
// not just the first Location header. The earnings snapshot table moved to a
// class-based layout; the calendar page now embeds its event list as inline
// JSON (`{"calendarId":...}` objects) — more reliable to parse than the old
// HTML table scrape. Verified against the live pages 2026-07-01.

async function scrapeEarnings(symbol) {
  const html = await fetchHtml(`https://finviz.com/stock?t=${symbol}`);
  // "Earnings" label cell closes, then the value sits inside
  // <div class="snapshot-td-content"><a...><b><small class="text-2xs">May 20 AMC</small>
  const m = html.match(/Earnings<\/a><\/div><\/td>[\s\S]{0,400}?<small class="text-2xs">([^<]+)<\/small>/);
  if (!m) return null;
  const raw = m[1].trim();
  if (raw === "-" || raw.toUpperCase() === "N/A") return null;
  return raw;
}

async function scrapeCalendarFedEvents() {
  const html = await fetchHtml("https://finviz.com/calendar/economic");

  // Events are embedded as flat (no nested braces) JSON objects, e.g.:
  // {"calendarId":420648,"ticker":"FDTR","event":"Fed Interest Rate Decision",
  //  "category":"Interest Rate","date":"2026-07-01T09:00:00", ...}
  // Note: the default page only renders ~1 week of events — farther-out FOMC
  // dates rely on the rules.json fallback merge in checkFundamentals() below.
  const raw = html.match(/\{"calendarId":\d+[^}]*\}/g) || [];
  const fedRe = /FOMC|Fed Funds|Federal Reserve|Interest Rate Decision/i;
  const events = [];

  for (const chunk of raw) {
    let obj;
    try { obj = JSON.parse(chunk); } catch { continue; }
    if (!obj.event || !obj.date) continue;
    if (fedRe.test(obj.event)) {
      events.push({ date: obj.date.split("T")[0], event: obj.event.slice(0, 80) });
    }
  }

  return events;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check FED and earnings filters for a list of symbols.
 * @param {string[]} symbols  Watchlist (e.g. ["AAPL","NVDA","SPY"])
 * @param {object}   rules    Parsed rules.json object (may contain fundamental_filters)
 * @returns {object} { checked_at, fed, earnings, warnings }
 */
export async function checkFundamentals(symbols = [], rules = {}) {
  const today = new Date();
  const rf = rules.fundamental_filters || {};

  // ── FED ──────────────────────────────────────────────────────────────────
  let fedEvents = [];

  // 1. Try Finviz calendar
  try {
    const live = await scrapeCalendarFedEvents();
    fedEvents = live;
  } catch (_) {
    // Finviz unreachable — proceed with rules.json fallback
  }

  // 2. Merge rules.json fed_dates fallback (avoid duplicates)
  const seenDates = new Set(fedEvents.map((e) => e.date));
  for (const d of rf.fed_dates || []) {
    if (!seenDates.has(d)) {
      fedEvents.push({ date: d, event: "FOMC Meeting", source: "rules.json" });
    }
  }

  // Classify FED events
  const fedUpcoming = fedEvents
    .map((e) => ({ ...e, days_away: daysDiff(e.date, today) }))
    .filter((e) => e.days_away >= -2 && e.days_away <= 30)
    .sort((a, b) => a.days_away - b.days_away);

  const fedActive = fedUpcoming.some((e) => Math.abs(e.days_away) <= 2);

  // ── EARNINGS ──────────────────────────────────────────────────────────────
  const earnings = {};

  for (const symbol of symbols) {
    if (ETF_SYMBOLS.has(symbol)) {
      earnings[symbol] = { is_etf: true, active: false };
      continue;
    }

    let dateStr = null;
    let source = null;

    // 1. Try Finviz
    try {
      const raw = await scrapeEarnings(symbol);
      if (raw) {
        dateStr = parseFinvizDate(raw, today);
        source = "finviz";
      }
    } catch (_) {}

    // 2. Fallback to rules.json
    if (!dateStr && rf.earnings?.[symbol]) {
      dateStr = rf.earnings[symbol];
      source = "rules.json";
    }

    if (!dateStr) {
      earnings[symbol] = { date: null, active: false, days_away: null, source: null };
      continue;
    }

    const days = daysDiff(dateStr, today);
    earnings[symbol] = {
      date: dateStr,
      active: Math.abs(days) <= 7,
      days_away: days,
      source,
    };
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = [];
  if (fedActive) {
    const next = fedUpcoming.find((e) => Math.abs(e.days_away) <= 2);
    warnings.push(
      `⚠️ FILTRO FED ACTIVO — evento "${next?.event}" el ${next?.date} (${next?.days_away >= 0 ? "en " + next.days_away : "hace " + Math.abs(next.days_away)} días). Considerar NO operar hoy.`,
    );
  }
  for (const [sym, data] of Object.entries(earnings)) {
    if (data.active) {
      const dir = data.days_away >= 0 ? `en ${data.days_away} días` : `hace ${Math.abs(data.days_away)} días`;
      warnings.push(
        `⚠️ FILTRO EARNINGS ${sym} — earnings ${dir} (${data.date}). NO operar ${sym}.`,
      );
    }
  }

  return {
    checked_at: today.toISOString().split("T")[0],
    fed: {
      active: fedActive,
      upcoming: fedUpcoming,
    },
    earnings,
    warnings,
  };
}
