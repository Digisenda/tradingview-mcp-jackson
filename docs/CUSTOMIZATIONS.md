# Customizations — Digisenda Fork

Registro completo de todos los cambios realizados sobre el upstream
[LewisWJackson/tradingview-mcp-jackson](https://github.com/LewisWJackson/tradingview-mcp-jackson).

**Uso:** Este archivo es la fuente de verdad para actualizar README, CHANGELOG
y cualquier otro documento del repositorio. Antes de modificar documentación,
leer este archivo para entender qué se cambió, por qué, y cómo funciona.

---

## Relación con upstream

| Remote | URL | Rol |
|--------|-----|-----|
| `origin` | `github.com/Digisenda/tradingview-mcp-jackson` | Fork privado — cambios propios |
| `upstream` | `github.com/LewisWJackson/tradingview-mcp-jackson` | Original — jalar mejoras futuras |

Para jalar mejoras del upstream sin pisar cambios propios:
```bash
git fetch upstream
git merge upstream/main --no-ff
# resolver conflictos en CLAUDE.md y src/core/morning.js si los hay
```

---

## Fase 1 — Unificación morning_brief + checklist premarket
**Commit:** `12fc071` | **Fecha:** 2026-05-19

### Qué cambió
- **`CLAUDE.md`** — completamente reescrito. Contiene el sistema de trading real:
  - Decision tree de herramientas (qué tool usar en cada situación)
  - Flujo premarket completo (7 pasos por ticker)
  - Reglas de análisis: BB como indicador primario (50%), MAs secundario (30%)
  - Lógica de rebotes: MAs a favor = piso/techo, MAs en contra = continuación
  - Output esperado por ticker con formato estructurado
  - Tabla de modos: Rápido ("morning brief") / Completo ("checklist")
- **`src/core/morning.js`** — reescrito para sistema BB + SMAs:
  - `extractBB()` — extrae Bollinger Bands 20-2-0
  - `extractSMAs()` — extrae 4 SMAs (20/40/100/200)
  - `bbPosition()` — posición del precio vs bandas
  - `maOrder()` — orden de MAs: alcista/bajista/entrelazado/mixto
  - `screenStrategies()` — screening STRAT-01 a 11 basado en condiciones multi-TF
  - `runBrief()` — scan D1/H1/M15 por ticker, retorna datos estructurados
  - `savePremarketReport()` — guarda reporte en `docs/sessions/`
- **`rules.json`** — agregado `bias_criteria`, `watchlist: [AAPL, NVDA, SPY, QQQ, IWM, DIA]`,
  estrategias STRAT-01 a 11 en formato JSON, `risk_rules` con parámetros reales

### Por qué
El fork original estaba orientado a crypto/swing trading. El sistema real usa
opciones direccionales CALL/PUT sobre acciones US con Bollinger Bands como
indicador primario y SMAs como contexto.

---

## Fase 2 — Verificación end-to-end
**Sesión:** 2026-05-20 mañana

### Qué cambió
- Verificación manual: BB 20-2-0 y SMAs 20/40/100/200 visibles en chart para los 6 tickers
- Confirmación: MA20 = BB Basis en todos los tickers (consistencia validada)
- `SETUP_GUIDE.md` — corregido (referenciaba configuración incorrecta)
- Primera ejecución completa del checklist premarket con draw de niveles + screenshots

### Nota técnica
`indicator_set_inputs` **no funciona** para SMAs — configurar desde la UI de TradingView
directamente. Documentado en `CLAUDE.md`.

---

## Fase 3 — Análisis Fundamental Automatizado
**Commit:** `13dd344` | **Fecha:** 2026-05-20 tarde

### Qué cambió
- **`src/core/fundamental.js`** _(nuevo)_ — `checkFundamentals(watchlist, rules)`:
  - Scraping de Finviz para FED calendar y earnings por ticker
  - Ventanas: FED ±2 días hábiles, Earnings ±7 días
  - ETFs auto-saltados (SPY/QQQ/IWM/DIA nunca tienen earnings propios)
  - Fallback silencioso a `rules.json` si Finviz no responde (timeout 6 s)
  - Corre en paralelo con la obtención del estado del chart → sin latencia adicional
- **`src/core/morning.js`** — integración de `checkFundamentals()` en `runBrief()`
  como campo `fundamental_filters` en el output
- **`rules.json`** — nueva sección `fundamental_filters`:
  ```json
  {
    "fundamental_filters": {
      "fed_dates": ["2026-06-18", "2026-07-29", ...],
      "earnings": {
        "AAPL": { "date": "2026-07-28" },
        "NVDA": { "date": "2026-08-27" }
      }
    }
  }
  ```

### Cómo funciona en el checklist
`morning_brief` retorna `fundamental_filters` con `fed.active` y
`earnings[ticker].active`. Claude verifica estos campos antes de empezar el
análisis y advierte si hay restricción activa.

### Archivos que NO cambia upstream
`src/core/fundamental.js` es exclusivo de este fork. Ante un merge con upstream,
este archivo no tendrá conflicto (no existe en upstream).

---

## Fase 4 — Dashboard HTML Estático
**Commits:** `5ad8677`, `208f46a` | **Fecha:** 2026-05-21

### Qué cambió
- **`src/core/morning.js`** — nuevas funciones:
  - `esc(str)` — helper de escape HTML
  - `generateHtml(briefData, date)` — genera dashboard HTML completo desde el
    output de `morning_brief`
  - `savePremarketReport()` — acepta param opcional `brief_data` (JSON string);
    si está presente genera `.html` junto al `.md`
- **`src/tools/morning.js`** — `premarket_save` tool: nuevo param `brief_data`
  (Zod string optional)
- **`CLAUDE.md`** — sección "Paso final": instrucción para pasar `brief_data`
  y para abrir el browser automáticamente al terminar

### Estructura del HTML generado
```
docs/sessions/premarket-YYYY-MM-DD.html   (15 KB aprox, self-contained)
```

Layout de 3 zonas:
1. **Banner sesión** — fecha, reloj ET en vivo (JS), indicador ventana activa
   (9:30–16:00, horario completo de mercado), estado FED y Earnings
2. **Banner setup activo** (naranja, condicional) — si algún ticker tiene
   `confidence: "conditions_met"` aparece destacado antes del grid
3. **Grid de 6 cards** — una por ticker:
   - Precio actual, tendencia D1 (ALCISTA ↑ / BAJISTA ↓ / LATERAL ↔)
   - BB D1 Middle con rol (PISO/TECHO) en verde/rojo
   - BB H1 Middle con rol
   - BB M15 width — en rojo si < 3, naranja si < 6
   - Top 3 estrategias candidatas con badges: ACTIVO / SETUP / watch
   - Borde naranja en cards con setup activo
4. **Calculadora BID/ASK** — JS puro, sin API:
   - Inputs: BID, ASK, contratos
   - Outputs: MID, STOP −25% (precio + USD × contratos), TARGET +12%, inversión total

### Cómo se genera
```
premarket_save(
  content="...",          ← markdown del reporte
  date="YYYY-MM-DD",
  brief_data="..."        ← JSON.stringify(output de morning_brief)
)
```
Tras el guardado, Claude corre `start docs\sessions\premarket-YYYY-MM-DD.html`
para abrir el browser automáticamente.

### Archivos que NO cambia upstream
`generateHtml` y la lógica HTML son exclusivos de este fork.
`savePremarketReport` tiene firma extendida — ante merge, solo hay que mantener
el param `brief_data` que upstream no tiene.

---

## Fase 5 — Supabase Persistence + Signal Architecture
**Commits:** `1c8eaec`, `f1e222a` | **Fecha:** 2026-05-24 / 2026-05-25

### Qué cambió
- **`src/core/supabase.js`** _(nuevo)_ — cliente Supabase + helpers:
  - `savePremarketSession(date, content, briefData)` — guarda o actualiza el reporte del día
  - `saveScreenshot({ date, ticker, filename, localPath })` — sube PNG a Storage + metadata
  - `saveSignals(signals)` — upsert de señales propuestas por Claude
  - `getSignalsForDate(date)` — recupera señales de una fecha para el dashboard y checklist
  - `saveTrade(trade)` — inserta un trade en la tabla `trades`
  - `closeTrade(tradeId, exitData)` — cierra una posición: `premium_exit`, `exit_date`, `result_pct`, `status = 'closed'`
  - `getOpenPositions()` — posiciones abiertas para el dashboard
  - `getRecentTrades(limit)` — últimos N trades cerrados para retroalimentación
- **`src/core/morning.js`** — `savePremarketReport()` llama a `savePremarketSession()` y `saveSignals()` tras guardar el `.md`
- **`.env.example`** — añadidas variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`
- **`package.json`** — nuevo script `"schwab": "node --use-system-ca src/core/schwab-analyzer.js"`

### Tablas Supabase
| Tabla | Contenido |
|-------|-----------|
| `premarket_sessions` | Reporte diario (markdown + brief_data JSON). PK: `date` (YYYY-MM-DD) |
| `trades` | Operaciones ejecutadas. Campos: ticker, side, strike, expiration, premium_entry/exit, result_pct, status, signal_code |
| `screenshots` | Metadata de imágenes. Storage bucket: `screenshots` |
| `signals` | Señales propuestas por Claude por sesión. PK: `signal_code` |

### Arquitectura de señales (signal-first)
`signal_code` = `YYYYMMDD-TICKER-SIDE-STRATXX` (ej. `20260525-NVDA-CALL-STRAT08`)  
Claude genera signals en `premarket_save` → el trade los referencia al ejecutarse → cierre del loop análisis↔ejecución.

### Fix técnico: NULL en SQL
`.in("status", ["closed", null])` **NO** hace match de NULLs en PostgREST.  
Solución: `.or("status.eq.closed,status.is.null")` — incluye trades legacy sin `status`.

### Archivos que NO cambia upstream
`src/core/supabase.js` es exclusivo de este fork. `.env.example` puede tener conflicto leve con upstream — mantener la versión Digisenda con las 3 variables.

---

## Fase 6 — Schwab Screenshot Analyzer + Dashboard LOG TRADE
**Commits:** `9c50c83`, `0d132eb`, `a8cc06f` | **Fecha:** 2026-05-25

### Qué cambió
- **`src/core/schwab-analyzer.js`** _(nuevo)_ — servidor HTTP local en puerto 9224:
  - `GET /ping` — health check
  - `POST /analyze` — recibe `{ image_base64, media_type }` → llama a Claude Haiku via `tool_use` → retorna campos estructurados del trade
  - Usa `tool_choice: { type: "tool", name: "extract_schwab_trade" }` para forzar JSON estructurado (nunca respuesta conversacional)
  - CORS restringido: permite `Origin: null` (file://), `localhost`, `127.0.0.1`. Rechaza orígenes externos con 403.
  - `npm run schwab` para iniciar; requiere `ANTHROPIC_API_KEY` en `.env`

- **`src/core/morning.js`** — `generateHtml()` extendido con 3 nuevas zonas en el dashboard:
  - **Drop zone Schwab** — arrastra screenshot de historial → Claude Haiku extrae BOT/SOLD → pre-llena formulario
  - **Signal picker** — muestra señales del día, selecciona para pre-llenar formulario
  - **Open positions panel** — lista posiciones abiertas desde Supabase; botón "Cerrar" pre-llena el formulario de cierre
  - Fix `setSelect(id, val, addIfMissing=true)` — si el ticker del screenshot no está en el dropdown, lo crea dinámicamente

### Flujo completo LOG TRADE en el dashboard
```
1. Drop screenshot BOT (entrada) → Haiku extrae ticker/side/strike/expiry/premium_entry/status
2. Si status="closed" → extrae también premium_exit y result_pct
3. "Rellenar formulario" → pre-llena todos los campos
4. "Guardar" → llama Supabase (saveTrade o closeTrade según status)
```

### Fix técnico: template literal escaping
`'\''` dentro de un template literal JS → `\'` se consume → `''` en el output → SyntaxError en el browser.  
Solución: usar `data-*` HTML attributes + función `handleCloseBtn(btn)` que lee `btn.dataset.*` — sin necesidad de escapar comillas.

### Archivos que NO cambia upstream
`src/core/schwab-analyzer.js` es exclusivo de este fork. `generateHtml` en `morning.js` es exclusivo de este fork.

---

## Pendiente — Fase 7: Pinecone RAG
Ver `docs/pinecone-rag-integration/PLAN.md` para el plan detallado.

Resumen: integrar RAG de Pinecone al flujo premarket como PASO 5.5 — consulta
contextual al índice de estrategias antes del Bid/Ask. Requiere confirmar 4
preguntas sobre el índice (tipo, contenido, estructura de embeddings, modelo).

---

## Guía de merge con upstream

Cuando LewisWJackson publique mejoras que quieras incorporar:

```bash
git fetch upstream
git log upstream/main --oneline -10   # ver qué hay nuevo
git merge upstream/main --no-ff
```

**Archivos con posibles conflictos:**
| Archivo | Tipo de conflicto | Resolución |
|---------|------------------|-----------|
| `CLAUDE.md` | Sistema de trading vs contenido genérico | Mantener versión Digisenda completa |
| `src/core/morning.js` | `runBrief`, helpers, `savePremarketReport` | Mantener lógica Digisenda; incorporar nuevos helpers de upstream si no colisionan |
| `rules.json` | Watchlist y estrategias personales | Siempre mantener versión Digisenda |
| `src/core/fundamental.js` | No existe en upstream | Sin conflicto |

**Archivos seguros de aceptar de upstream (sin revisar):**
`src/core/chart.js`, `src/core/data.js`, `src/core/drawing.js`, `src/core/pine.js`,
`src/core/replay.js`, `src/core/health.js`, `src/core/ui.js`, `package.json`
