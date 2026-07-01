/**
 * Test de regresión para loadPremarketData() en watcher.js — antes cacheaba
 * `null` para siempre si el archivo no existía en la primera llamada del día
 * (bug #3 de /code-review 2026-07-01). Usa disco real (weekDirFor() no es
 * configurable por env var) con una fecha de prueba lejana para no chocar
 * con datos reales, limpiando el archivo/carpeta al final.
 *
 * Run: node --test tests/premarket-data-cache.test.js
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { weekDirFor } from "../src/core/paths.js";
import { loadPremarketData } from "../watcher.js";

const TEST_DATE = "2099-03-05"; // fecha lejana, no choca con datos reales
const TEST_DIR = weekDirFor(TEST_DATE);
const TEST_FILE = join(TEST_DIR, `premarket-${TEST_DATE}.json`);

before(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

after(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

test("loadPremarketData: si el archivo no existe aún, devuelve null pero NO lo cachea para siempre", () => {
  // 1ª llamada: el archivo todavía no existe (checklist no ha corrido)
  const first = loadPremarketData(TEST_DATE);
  assert.strictEqual(first, null);

  // El checklist termina y escribe el archivo DESPUÉS de la primera llamada
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_FILE, JSON.stringify({ tickers: [{ symbol: "NVDA", classification: "ejecutar" }] }), "utf8");

  // 2ª llamada, mismo día: antes del fix esto seguía devolviendo null (cacheado
  // para siempre); con el fix, reintenta y encuentra el archivo.
  const second = loadPremarketData(TEST_DATE);
  assert.ok(second, "debe encontrar el archivo en la segunda llamada, no quedarse pegado en null");
  assert.strictEqual(second.tickers[0].symbol, "NVDA");
});

test("loadPremarketData: una vez encontrado, lo cachea (no vuelve a leer disco)", () => {
  const first = loadPremarketData(TEST_DATE);
  assert.ok(first);

  // Borrar el archivo NO debe afectar la lectura cacheada del mismo día
  rmSync(TEST_FILE);
  const second = loadPremarketData(TEST_DATE);
  assert.ok(second, "debe seguir devolviendo el valor cacheado aunque el archivo ya no exista en disco");
  assert.strictEqual(second.tickers[0].symbol, "NVDA");
});
