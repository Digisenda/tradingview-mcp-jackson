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

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/** Sigue hasta `maxRedirects` saltos 3xx — Finviz ya rompió los scrapers una vez
 *  (2026-06/07) por retirar URLs viejas detrás de redirects; con esto un cambio
 *  de URL similar en el futuro no vuelve a requerir hardcodear el destino final. */
export function fetchHtml(url, timeoutMs = 6000, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("timeout")); }
    }, timeoutMs);
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    function request(currentUrl, redirectsLeft) {
      get(currentUrl, { headers: HEADERS }, (res) => {
        if (REDIRECT_CODES.has(res.statusCode) && res.headers?.location) {
          res.resume?.();
          if (redirectsLeft <= 0) {
            finish(reject, new Error(`demasiados redirects desde ${url}`));
            return;
          }
          let nextUrl;
          try {
            nextUrl = new URL(res.headers.location, currentUrl).toString();
          } catch {
            finish(reject, new Error(`Location de redirect inválida: ${res.headers.location}`));
            return;
          }
          request(nextUrl, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          finish(reject, new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => finish(resolve, body));
      }).on("error", (e) => finish(reject, e));
    }
    request(url, maxRedirects);
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
// both pages' markup (2026-06/07). Both old URLs chained THROUGH multiple 301s
// (.ashx → /quote?t=X → /stock?t=X ; .ashx → /calendar → /calendar/economic) —
// hardcoded here to the final URLs anyway (cheaper than a redirect hop), but
// fetchHtml() now follows redirects on its own (2026-07-04) so a future Finviz
// URL change breaks gracefully instead of silently falling back to rules.json.
// The earnings snapshot table moved to a class-based layout; the calendar page
// now embeds its event list as inline JSON (`{"calendarId":...}` objects) —
// more reliable to parse than the old HTML table scrape. Verified against the
// live pages 2026-07-01.

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

  // 2. Merge rules.json fed_dates fallback (avoid duplicates). Guarded on its own —
  // this reads user-edited config (not a network call), so a malformed fed_dates
  // (e.g. an object instead of an array, from a hand-edit typo) must not throw
  // uncaught out of checkFundamentals() and silence the veto for the caller.
  try {
    const seenDates = new Set(fedEvents.map((e) => e.date));
    for (const d of rf.fed_dates || []) {
      if (!seenDates.has(d)) {
        fedEvents.push({ date: d, event: "FOMC Meeting", source: "rules.json" });
      }
    }
  } catch (e) {
    console.warn("[FUNDAMENTAL] ⚠️ fed_dates fallback malformado, se ignora:", e.message);
  }

  // Classify FED events
  const fedUpcoming = fedEvents
    .map((e) => ({ ...e, days_away: daysDiff(e.date, today) }))
    .filter((e) => e.days_away >= -2 && e.days_away <= 30)
    .sort((a, b) => a.days_away - b.days_away);

  // Single source of truth for "which event made FED active" — buildVetoFlags()
  // in watcher.js reuses fed.activeEvent instead of re-deriving the ±2 day
  // threshold itself, so the two can never silently disagree.
  const fedActiveEvent = fedUpcoming.find((e) => Math.abs(e.days_away) <= 2) || null;
  const fedActive = fedActiveEvent != null;

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
  if (fedActiveEvent) {
    const daysLabel = fedActiveEvent.days_away >= 0
      ? `en ${fedActiveEvent.days_away} días`
      : `hace ${Math.abs(fedActiveEvent.days_away)} días`;
    warnings.push(
      `⚠️ FILTRO FED ACTIVO — evento "${fedActiveEvent.event}" el ${fedActiveEvent.date} (${daysLabel}). Considerar NO operar hoy.`,
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
      activeEvent: fedActiveEvent,
      upcoming: fedUpcoming,
    },
    earnings,
    warnings,
  };
}
