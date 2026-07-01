/**
 * fundamentals.js — capa de caché sobre fundamental.js + noticias Finviz, para
 * consumo del vigía (proceso de larga duración, no debe golpear Finviz cada tick).
 *
 * D3: FED/earnings se refrescan 1x por sesión (llamar warmup() al arrancar el
 * vigía); noticias tienen TTL de 15 min.
 * D4: degradación graceful — ninguna función de este módulo lanza. Si el scrape
 * falla, se devuelve el último valor bueno en caché, o un placeholder si nunca
 * hubo uno.
 */
import { checkFundamentals, fetchHtml } from "./fundamental.js";

const NEWS_TTL_MS = 15 * 60 * 1000;
const WARMUP_RETRY_COOLDOWN_MS = 10 * 60 * 1000; // no reintentar más seguido que esto

let _fedEarnings = null; // último resultado bueno de checkFundamentals()
let _lastWarmupAttempt = 0;
const _newsCache = new Map(); // symbol → { items, fetchedAt }

// ─── FED / Earnings — 1x por sesión, con auto-reintento si falló ──────────────

/** Llamar una vez al arrancar el vigía (o al detectar un nuevo día de sesión). */
export async function warmup(watchlist, rules) {
  _lastWarmupAttempt = Date.now();
  try {
    _fedEarnings = await checkFundamentals(watchlist, rules);
  } catch (e) {
    console.warn("[FUNDAMENTALS] ⚠️ warmup() falló, se mantiene el último valor bueno:", e.message);
    // _fedEarnings conserva lo que ya tenía (null la primera vez del día)
  }
  return _fedEarnings;
}

/**
 * Llamar en cada tick en sesión. Si warmup() nunca tuvo éxito hoy (ej. falló por
 * algo no relacionado a red, no solo un Finviz caído), reintenta con un cooldown
 * de 10 min en vez de esperar hasta el rollover del día siguiente — cierra el
 * hallazgo de /code-review "veto vacío todo el día sin reintento".
 */
export async function ensureWarmedUp(watchlist, rules) {
  if (_fedEarnings !== null) return _fedEarnings;
  if (Date.now() - _lastWarmupAttempt < WARMUP_RETRY_COOLDOWN_MS) return null;
  return warmup(watchlist, rules);
}

/** Último resultado de checkFundamentals() cacheado por warmup(). Nunca lanza. */
export function getFedEarnings() {
  return _fedEarnings;
}

/**
 * Fecha de la próxima reunión FED genuinamente futura (ISO, o null) — usado por
 * el dashboard bajo la etiqueta "Próx. FED". `upcoming` incluye eventos de hasta
 * 2 días en el pasado (para que el veto los detecte justo después de ocurrir);
 * filtrar days_away >= 0 evita mostrar una reunión ya pasada como "próxima".
 */
export function getFedDate() {
  const upcoming = _fedEarnings?.fed?.upcoming || [];
  const future = upcoming.find((e) => e.days_away >= 0);
  return future ? future.date : null;
}

/** Info de earnings para un símbolo — { date, active, days_away } o null. */
export function getEarnings(symbol) {
  return _fedEarnings?.earnings?.[symbol] || null;
}

// ─── Noticias — TTL 15 min, degradación graceful ───────────────────────────────

async function scrapeNews(symbol, limit) {
  const html = await fetchHtml(`https://finviz.com/stock?t=${symbol}`);
  const re = /<a class="tab-link-news" href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>[\s\S]{0,200}?<span>\(([^)]+)\)<\/span>/g;
  const items = [];
  let m;
  while ((m = re.exec(html)) && items.length < limit) {
    items.push({ url: m[1], headline: m[2].trim(), source: m[3].trim() });
  }
  return items;
}

/**
 * Noticias recientes para un símbolo, cacheadas 15 min. Si el scrape falla,
 * devuelve la última lista buena en caché (o [] si nunca hubo una) — nunca lanza.
 */
export async function getNews(symbol, { limit = 3 } = {}) {
  const cached = _newsCache.get(symbol);
  const fresh = cached && Date.now() - cached.fetchedAt < NEWS_TTL_MS;
  if (fresh) return cached.items;

  try {
    const items = await scrapeNews(symbol, limit);
    _newsCache.set(symbol, { items, fetchedAt: Date.now() });
    return items;
  } catch (e) {
    console.warn(`[FUNDAMENTALS] ⚠️ getNews(${symbol}) falló:`, e.message);
    return cached?.items || [];
  }
}

// ─── Reset (rollover de medianoche) ────────────────────────────────────────────

/** Limpia caché de noticias y fuerza un nuevo warmup() de FED/earnings. */
export function resetDaily() {
  _fedEarnings = null;
  _newsCache.clear();
}
