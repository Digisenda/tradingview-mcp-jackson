# Roadmap de Desarrollo — TradingView MCP
**Reconstruido:** 2026-05-20  
**Fuentes:** `docs/DEPURACION MORNING_BRIEF.md`, `docs/pinecone-rag-integration/PLAN.md`, git log

---

## FASE 1 — Unificación morning_brief + checklist ✅ COMPLETADA

> Commit: `12fc071` — 2026-05-20 09:13 AM

### Etapa 1 — morning_brief multi-timeframe
- `src/core/morning.js`: scan D1, H1, M15 por ticker
- Helpers: `extractBB()`, `extractSMAs()`, `bbPosition()`, `maOrder()`
- `screenStrategies()` — screening STRAT-01 a 11
- Output: `bb.width`, `bb_position`, `ma_order`, `strategy_candidates`
- `savePremarketReport()` — guarda en `docs/sessions/`

### Etapa 2 — Triggers unificados en CLAUDE.md
- Tabla de modos: Rápido ("morning brief") / Completo ("checklist")
- Regla crítica: BB es indicador primario, sin volatilidad no hay operaciones
- Flujo completo 7 pasos documentado con output esperado por ticker

### Etapa 3 — Persistencia
- `docs/sessions/` agregado a `.gitignore`
- Tool `premarket_save` operativo

---

## FASE 2 — Verificación end-to-end ✅ COMPLETADA

> Sesión: 2026-05-20 (hoy)

- BB 20-2-0 confirmado visible en chart para todos los tickers
- SMAs 20/40/100/200 confirmados y verificados (MA20 = BB basis en todos los tickers)
- Checklist premarket completo ejecutado: AAPL / NVDA / SPY / QQQ / IWM / DIA
- Draw de niveles (BB D1, BB H1, H1 Máx/Mín) operativo en los 6 tickers
- Screenshots guardados en `screenshots/`
- Reporte guardado en `docs/sessions/premarket-2026-05-20.md`

---

## FASE 3 — Análisis Fundamental Automatizado ✅ COMPLETADA

> Fuente: `docs/DEPURACION MORNING_BRIEF.md` — ítem 4

### Objetivo
Conectar con una fuente de datos externa para eliminar la verificación manual de filtros globales (FED y Earnings) que hoy se hace "verificar manualmente".

### Alcance
- **FED calendar:** detectar automáticamente si hay evento Fed ±2 días hábiles
- **Earnings calendar:** detectar si algún ticker del watchlist tiene earnings ±7 días
- Integrar este check en `morning_brief` como campo `fundamental_filters`
- Si hay filtro activo → reportar en el output con advertencia visible

### Opciones de implementación (a decidir)
| Opción | Fuente | Esfuerzo |
|--------|--------|---------|
| A | Finviz web scraping (mencionado en DEPURACION doc) | Medio |
| B | API pública de earnings (Alphavantage, Polygon.io) | Bajo-Medio |
| C | ICS calendar feed (FED publica calendarios) | Bajo |

### Output esperado en morning_brief
```json
"fundamental_filters": {
  "fed_event": { "active": false, "next": "2026-06-11", "days_away": 22 },
  "earnings": {
    "AAPL": { "active": false, "next": "2026-07-28", "days_away": 69 },
    "NVDA": { "active": false, "next": "2026-05-28", "days_away": 8 }
  }
}
```

### Checklist de implementación
- [ ] Decidir fuente de datos (Finviz / API / ICS)
- [ ] Implementar `src/core/fundamental.js` con `checkFedCalendar()` y `checkEarnings()`
- [ ] Integrar en `morning_brief` como preflight check
- [ ] Agregar bloque `## Filtros Globales` al reporte `premarket_save`
- [ ] Probar con ticker que tenga earnings próximos

---

## FASE 4 — Dashboard HTML Estático ✅ COMPLETADA

> Fuente: `docs/DEPURACION MORNING_BRIEF.md` — ítem 5  
> Diseño aprobado: 2026-05-20. Referencia revisada: `github.com/Digisenda/dashboard-trading` (descartado por complejidad excesiva).

### Decisión de diseño

**Archivo HTML estático** generado automáticamente por `morning_brief` junto al `.md`.  
Sin backend, sin Docker, sin auth. Se abre directo en el browser con un clic.

**Descartado:** El proyecto `dashboard-trading` (React + FastAPI + PostgreSQL + Docker) es demasiado complejo para el objetivo — pantalla de operación de un vistazo.  
**Rescatado de ese proyecto:** estilo dark + Tailwind CDN, calculadora BID/ASK del `Checklist.jsx`.

### Layout aprobado — una sola pantalla, 3 zonas

```
┌─────────────────────────────────────────────────────────┐
│  SESIÓN: 09:31 ET  ●  ABIERTA  │  FED: OK  │ EARN: OK  │
│  ⭐ SETUP ACTIVO: IWM STRAT-03 PUT — techo $279.28      │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│  AAPL    │  NVDA    │   SPY    │   QQQ    │   IWM  ★    │
│  $299.82 │  $224.68 │  $738.05 │  $708.56 │  $277.85    │
│  ALCISTA │  ALCISTA │  ALCISTA │  ALCISTA │  BAJISTA    │
│  BB D1 ↑ │  BB D1 ↑ │  BB D1 ↑ │  BB D1 ↑ │  BB D1 ↓   │
│  $285.61 │  $213.46 │  $728.13 │  $688.84 │  $279.28    │
│  STRAT02 │  STRAT02 │  STRAT02 │  STRAT02 │  STRAT03 ★  │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│  DIA — ⚠️ NO OPERAR (BB width demasiado estrecho)        │
├─────────────────────────────────────────────────────────┤
│  [ Calculadora BID/ASK — MID / Stop / Target ]          │
└─────────────────────────────────────────────────────────┘
```

### Especificaciones técnicas

| Aspecto | Decisión |
|---------|---------|
| Tecnología | HTML + CSS inline (Tailwind CDN) — sin build step |
| Generación | `savePremarketReport()` genera `.md` + `.html` en `docs/sessions/` |
| Apertura | Link en el reporte `.md` o tool `premarket_open` (por definir) |
| Datos | Lee del output de `morning_brief` — reutiliza `fundamental_filters` |
| Calculadora | BID/ASK pura JS (sin API) — rescatada de `dashboard-trading/Checklist.jsx` |
| Prioridad visual | `conditions_met` siempre al tope en banner destacado |
| Regla sin vol. | DIA o ticker con BB estrecho → banner "NO OPERAR" antes del grid |

### Implementación — 2026-05-21

- [x] `generateHtml(briefData, date)` en `src/core/morning.js`
- [x] HTML template con Tailwind CDN, dark theme, layout de 3 zonas
- [x] Banner superior: hora ET + estado sesión + filtros FED/Earnings (JS reloj en vivo)
- [x] Banner naranja si hay `conditions_met` activo
- [x] Grid de 6 cards (una por ticker) con bias, BB levels D1/H1, M15 width, setup candidates
- [x] Card con borde naranja para tickers con setup activo
- [x] Calculadora BID/ASK (MID, STOP -25%, TARGET +12%, inversión total)
- [x] `savePremarketReport()` acepta `brief_data` (JSON string) y genera `.html` junto al `.md`
- [x] `premarket_save` tool expone parámetro `brief_data`
- [x] Dashboard generado y verificado: `docs/sessions/premarket-2026-05-21.html` (15 KB)

---

## FASE 5 — Supabase Persistence + Signal Architecture ✅ COMPLETADA

> Commits: `1c8eaec`, `f1e222a` — 2026-05-24 / 2026-05-25

### Objetivo
Cerrar el loop análisis → ejecución: guardar trades en la nube, referenciarlos con las señales del premarket, y alimentar retroalimentación automática en la siguiente sesión.

### Implementación
- [x] `src/core/supabase.js` — cliente Supabase con helpers para sesiones, trades, señales y screenshots
- [x] Tablas: `premarket_sessions`, `trades`, `signals`, `screenshots` (bucket Storage)
- [x] `signal_code` como PK de señales: `YYYYMMDD-TICKER-SIDE-STRATXX`
- [x] `savePremarketReport()` genera señales en Supabase al guardar el reporte
- [x] `getRecentTrades()` retro-alimenta el análisis del día siguiente (win rate por strat/ticker)
- [x] `.env.example` actualizado con `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`

---

## FASE 6 — Schwab Screenshot Analyzer + Dashboard LOG TRADE ✅ COMPLETADA

> Commits: `9c50c83`, `0d132eb`, `a8cc06f` — 2026-05-25

### Objetivo
Eliminar el ingreso manual de datos en el LOG TRADE: arrastrar una captura del historial de Charles Schwab al dashboard → Claude Haiku extrae los campos automáticamente → pre-llena el formulario.

### Implementación
- [x] `src/core/schwab-analyzer.js` — servidor local en puerto 9224
  - `POST /analyze` — recibe imagen base64 → Claude Haiku via `tool_use` forzado → campos JSON
  - CORS restringido a `file://` + localhost (seguridad contra fuga de API key)
  - `npm run schwab` para iniciar
- [x] `generateHtml()` extendido con drop zone Schwab + signal picker + open positions panel
- [x] `setSelect(id, val, addIfMissing=true)` — tickers desconocidos se agregan al dropdown
- [x] Fix template literal: `data-*` attributes en lugar de `onclick` con strings escapados

---

## PENDIENTES DE TRANSCRIPCIÓN ⏳ (depuración #18 y #21)

> **Bloqueados** hasta que Juan suba la transcripción del video.
> Una vez recibida, implementar en la misma sesión — son cambios acotados al checklist existente.

---

### #18 — Líneas exactas a dibujar por ticker 🔴 BLOQUEADO

**Contexto:** Hoy `draw_shape` dibuja BB Middle D1, BB Middle H1 y H1 Máx/Mín para todos los tickers
por igual. Juan quiere definir qué líneas específicas aplican a cada ticker según su comportamiento
real (ej. SPY puede necesitar un nivel adicional; DIA puede no necesitar H1 Middle).

**Qué falta:**
- Transcripción del video donde Juan explica las reglas por ticker
- Con esas reglas → actualizar la sección "PASO 3 — Medias Móviles D1" y "PASO 4 — MAs H1" en
  `CLAUDE.md` con condiciones específicas por ticker

**Checklist de implementación:**
- [ ] Juan sube transcripción
- [ ] Identificar reglas por ticker (qué líneas dibujar en qué condición)
- [ ] Actualizar `CLAUDE.md` — flujo completo, sección de draw por ticker
- [ ] Verificar con ejecución real del checklist

---

### #21 — Estrategia "BB con volatilidad": CALL en aperturas explosivas 🔴 BLOQUEADO

**Contexto:** Nuevo setup identificado por Juan: BB M15 estrecho (baja volatilidad) + gap up en
apertura = señal CALL de alta confianza. No está formalizado como STRAT en `rules.json` ni
en el checklist — solo existe como observación empírica.

**Qué falta:**
- Transcripción del video donde Juan describe la lógica exacta (umbrales de BB M15 width,
  qué constituye "gap up", condiciones adicionales de confirmaión)
- Con esa lógica → agregar como STRAT-12 (o número disponible) en `rules.json`
- Actualizar `screenStrategies()` en `src/core/morning.js` para detectarla
- Documentar en `CLAUDE.md` como strategy candidate nuevo

**Checklist de implementación:**
- [ ] Juan sube transcripción
- [ ] Definir: umbral BB M15 width "estrecho" (¿< 3? ¿< 2?), gap up mínimo (%)
- [ ] Agregar a `rules.json` como nueva estrategia (STRAT-12 CALL)
- [ ] Actualizar `screenStrategies()` en `src/core/morning.js`
- [ ] Actualizar sección "Estrategias" en `CLAUDE.md`
- [ ] Probar con checklist completo en la siguiente sesión de mercado

---

## FASE 7 — Pinecone RAG Integration ⏳ PENDIENTE

> Fuente: `docs/pinecone-rag-integration/PLAN.md` (plan completo aquí)

### Objetivo
Conectar el RAG de Pinecone (contexto cualitativo del sistema de opciones) con el flujo premarket para recuperar orientación situacional dinámica durante el análisis.

### Opción elegida
**Opción 1 — Pinecone MCP Server** (`@pinecone-database/mcp`)  
Agregar a `~/.claude/.mcp.json` junto al servidor TradingView.

### Inserción en el flujo
Nuevo **PASO 5.5** entre trendlines (PASO 5) y Bid/Ask (PASO 6):
```
query: "{ticker} | BB D1: {techo/piso} | H1: {alcista/bajista} | 
        Precio vs MA20: {sobre/bajo} | Candidatas: {STRAT-XX}"
pinecone.query(top_k=3) → contexto cualitativo al reporte
```

### Preguntas pendientes de confirmar con Juan ⚠️
1. ¿El índice Pinecone es **dedicado** a opciones o compartido con el bot?
2. ¿Qué **tipo de contenido** tiene el RAG? (reglas, casos históricos, anotaciones)
3. ¿Cuál es la **estructura de los embeddings**? (por frase, por estrategia, por sesión)
4. ¿Qué **modelo de embeddings** usa?

### Checklist de implementación
- [ ] Confirmar respuestas a las 4 preguntas
- [ ] Verificar disponibilidad: `npx @pinecone-database/mcp --help`
- [ ] Configurar credenciales en `.env`
- [ ] Agregar servidor a `~/.claude/.mcp.json`
- [ ] Probar query básico al índice
- [ ] Agregar PASO 5.5 en `CLAUDE.md`
- [ ] Ejecutar checklist completo con RAG activo
- [ ] Evaluar calidad del contexto y ajustar query

---

## FASE 8 — Optimización del Reporte Premarket ⏳ PENDIENTE

> Registrado: 2026-05-26 — feedback de sesión real

### Problema
El informe generado por el checklist premarket (7 pasos × 6 tickers) es **demasiado extenso y complejo** para su uso durante la ventana operativa (9:30–11:30 AM ET). El volumen de texto dificulta la toma rápida de decisiones.

### Objetivo
Rediseñar el output del checklist para que sea **escaneable en < 30 segundos por ticker** — sin perder la información crítica de BB, MAs y estrategias candidatas.

### Dirección esperada
- Eliminar texto redundante y pasos intermedios del output de Claude
- El reporte en Claude debe ser un **resumen ejecutivo** (5–8 líneas por ticker max)
- El detalle completo queda en el dashboard HTML — Claude solo muestra lo accionable
- Distinguir claramente: **"operar hoy"** vs **"vigilar"** vs **"no operar"**
- Posiblemente separar el flujo en dos fases: recolección silenciosa de datos → output final condensado

### Checklist de implementación
- [ ] Definir con Juan el formato ideal del output por ticker (qué sí, qué no)
- [ ] Revisar prompt / instrucciones en `CLAUDE.md` — reducir verbosidad del flujo completo
- [ ] Ajustar sección "Output esperado por ticker" en `CLAUDE.md`
- [ ] Posible: añadir modo `--brief` al checklist que suprime pasos intermedios
- [ ] Probar en sesión real y medir tiempo de lectura

---

## Resumen de Estado

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | Unificación morning_brief + checklist (Etapas 1-3) | ✅ Completada — 2026-05-19 |
| 2 | Verificación end-to-end (BB + SMAs + checklist completo) | ✅ Completada — 2026-05-20 |
| 3 | Análisis Fundamental Automatizado (Finviz / FED / Earnings) | ✅ Completada — 2026-05-20 |
| 4 | Dashboard HTML estático (generado por morning_brief) | ✅ Completada — 2026-05-21 |
| 5 | Supabase persistence + signal architecture | ✅ Completada — 2026-05-24 |
| 6 | Schwab screenshot analyzer + Dashboard LOG TRADE | ✅ Completada — 2026-05-25 |
| 7 | Pinecone RAG Integration | ⏳ Pendiente — 4 preguntas previas |
| **8** | **Optimización del reporte premarket (menos extenso)** | **⏳ Pendiente — 2026-05-26** |
| #18 | Líneas exactas por ticker (checklist draw) | 🔴 Bloqueado — pendiente transcripción |
| #21 | Estrategia "BB vol + gap up" CALL (STRAT-12) | 🔴 Bloqueado — pendiente transcripción |

**Próximas sesiones:**
- **Fase 8 (prioridad alta):** rediseñar output del checklist — más corto, más accionable
- **Cuando Juan suba transcripción:** implementar #18 (líneas por ticker en `CLAUDE.md`) y #21 (STRAT-12 en `rules.json` + `screenStrategies()`)
- **Pinecone RAG (Fase 7):** requiere confirmar 4 preguntas sobre el índice — ver `docs/pinecone-rag-integration/PLAN.md`
