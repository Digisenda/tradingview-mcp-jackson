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
   (9:30–11:30), estado FED y Earnings
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

## Pendiente — Fase 5: Pinecone RAG
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
