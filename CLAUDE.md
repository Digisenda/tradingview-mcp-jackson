# TradingView MCP — Claude Instructions

68 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Flujo Premarket Unificado

### Regla crítica — BB es el indicador primario

> **Sin volatilidad no hay operaciones.** Si `bb.width` es muy estrecho en D1, H1 y M15 simultáneamente → NO operar ese día. Las MAs son contexto, no disparadores. BB manda sobre MAs.

Pesos del análisis: **BB 50% | MAs 30% | Fundamental 20%** (este último es manual — verificar FED ±2 días y Earnings ±7 días antes de ejecutar cualquier operación).

### Modos de operación

| Trigger | Modo | Qué hace |
|---------|------|----------|
| "morning brief" | **Rápido** | `morning_brief` → bias D1/H1/M15 por ticker + estrategias candidatas. ~2 minutos. |
| "checklist" / "ejecuta checklist premarket" / "analiza apertura" / "análisis premarket" / "prepara el análisis" | **Completo** | `morning_brief` → análisis 7 pasos → dibujar líneas → screenshots → estrategias → guardar reporte. ~15-20 minutos. |

### Flujo completo (modo Checklist)

```
0. drawn_lines_clear          → elimina SOLO las líneas de Claude del día anterior (no toca líneas manuales)
R. trades_get(10)             → retroalimentación: leer últimos trades antes de analizar (ver sección Retroalimentación)
1. morning_brief              → recolecta datos D1/H1/M15 de todo el watchlist
2. Análisis 7 pasos           → aplicar checklist por ticker usando los datos del paso 1
3. Dibujar niveles            → draw_shape para BB Middle D1, BB Middle H1, Máx/Mín H1
4. Captura                    → capture_screenshot por ticker
5. Estrategias                → evaluar strategy_candidates del morning_brief
6. Guardar reporte            → premarket_save con el análisis completo
7. drawn_lines_save([...ids]) → guarda todos los entity IDs creados en el paso 3
8. Cierre de sesión           → preguntar al usuario si ejecutó operaciones (ver sección Cierre)
```

**IMPORTANTE:** El paso 1 (`morning_brief`) recolecta todos los datos necesarios para los 7 pasos. No hacer llamadas adicionales a `data_get_study_values` por ticker — usar los datos del morning_brief.

**IMPORTANTE drawn_lines:** Nunca usar `draw_clear` en el checklist. Solo `drawn_lines_clear` al inicio y `drawn_lines_save` al final. Recopilar TODOS los entity_ids retornados por `draw_shape` durante el paso 3 para pasarlos a `drawn_lines_save`.

### Checklist Premarket — Flujo Automático

**Trigger:** cuando el usuario escriba cualquiera de estas frases:
- "ejecuta checklist premarket"
- "analiza apertura"
- "checklist"
- "análisis premarket"
- "prepara el análisis"

**Watchlist:** AAPL, NVDA, SPY, QQQ, IWM, DIA

### Indicadores del sistema (los únicos que se usan)
- **Bollinger Bands 20-2-0** → peso 50% del análisis. Indicador primario.
- **SMAs 20 / 40 / 100 / 200** → peso 30% del análisis. Indicador secundario.
- Ambos deben estar visibles en el chart. Si `data_get_study_values` no retorna BB o alguna SMA,
  agregar con `chart_manage_indicator(action:"add", name:"Bollinger Bands")` o
  `chart_manage_indicator(action:"add", name:"Simple Moving Average")` antes de continuar.
- Los valores que retorna `data_get_study_values` para las 4 SMAs se asumen en orden MA20, MA40, MA100, MA200
  (de período más corto a más largo, de mayor a menor valor en tendencia alcista).

### Secuencia por ticker

```
Para cada ticker en [AAPL, NVDA, SPY, QQQ, IWM, DIA]:

  PASO 0 — Setup
    chart_set_symbol(ticker)
    chart_set_timeframe("D")
    data_get_study_values() → verificar que BB y las 4 SMAs están presentes.
    Si falta alguno → chart_manage_indicator para agregarlo.
    ⚠️ NO llamar draw_clear aquí — las líneas anteriores ya fueron eliminadas por drawn_lines_clear al inicio del checklist.

  PASO 1 — Bollinger Bands D1  [peso 50%]
    (ya en D1 desde PASO 0)
    Leer: BB upper, BB middle, BB lower del data_get_study_values
    Evaluar tendencia D1 con BB:
      - Precio cerca de banda superior y alejándose del middle → tendencia alcista → BB middle = PISO
      - Precio cerca de banda inferior y alejándose del middle → tendencia bajista → BB middle = TECHO
      - Precio oscilando entre bandas sin dirección clara → LATERAL
    ⚠️ SOLO dibujar BB middle D1 si tiene tendencia (alcista o bajista).
       Si está LATERAL → NO dibujar. El precio fluctúa entre bandas sin rebote definido.
    draw_shape(horizontal_line, precio=BB_middle_D1) → "BB D1 [TECHO/PISO]"

  PASO 2 — Bollinger Bands H1  [peso 50%]
    chart_set_timeframe("60")
    data_get_study_values() → leer BB H1 (upper, middle, lower)
    Evaluar:
      1. ¿Está el precio dentro de las bandas? → [dentro / fuera superior / fuera inferior]
      2. ¿El BB middle H1 constituye techo o piso? (misma lógica que D1 pero en H1)
    ⚠️ SOLO dibujar BB middle H1 si tiene tendencia. Si está LATERAL → NO dibujar.
    draw_shape(horizontal_line, precio=BB_middle_H1) → "BB H1 [TECHO/PISO]"

  PASO 3 — Medias Móviles D1  [peso 30%]
    chart_set_timeframe("D")
    data_get_study_values() → leer MA20, MA40, MA100, MA200 y precio actual

    ── Regla de clasificación por MA (basada en diagrama Investep) ───────────
    La DIRECCIÓN individual de cada MA determina si es TECHO o PISO.
    Determinar dirección de cada MA comparando su valor vs la MA del período siguiente:
      MA20 > MA40   → MA20 va alcista  |  MA20 < MA40   → MA20 va bajista
      MA40 > MA100  → MA40 va alcista  |  MA40 < MA100  → MA40 va bajista
      MA100 > MA200 → MA100 va alcista |  MA100 < MA200 → MA100 va bajista
      MA200: determinar por pendiente propia (comparar con su valor de sesiones anteriores)

    Para cada MA aplicar:
      ✅ MA alcista (subiendo) + precio encima de ella → PISO  → draw_shape
      ✅ MA bajista (bajando) + precio debajo de ella → TECHO → draw_shape
      ❌ MA alcista (subiendo) + precio debajo de ella → Continuación → NO dibujar
      ❌ MA bajista (bajando) + precio encima de ella → Continuación → NO dibujar

    Escenarios típicos (del diagrama):
      Alcista puro (precio > MA20 > MA40 > MA100 > MA200):
        → Todas las MAs son PISOS → dibujar las 2 más cercanas al precio
      Bajista puro (MA200 > MA100 > MA40 > MA20 > precio):
        → Todas las MAs son TECHOS → dibujar las 2 más cercanas al precio
      Mixto (ej. MA40/MA20 bajistas arriba, MA100/MA200 alcistas abajo):
        → MA40/MA20 = TECHOS | MA100/MA200 = PISOS → dibujar ambos grupos

    ⚠️ Separación entre MAs: si las MAs que marcan tendencia se SEPARAN más
       → tendencia fortaleciéndose (ej. bajista: precio rompe MA20 y llega a MA40
         = intento de subida para seguir bajando, NO es rebote real).
    ⚠️ Dibujar máximo las 2 MAs de rebote más cercanas al precio actual.
    ──────────────────────────────────────────────────────────────────────────

  PASO 4 — Medias Móviles H1 + H-Lines Máx/Mín  [peso 30%]
    chart_set_timeframe("60")
    data_get_study_values() → leer MA20, MA40, MA100, MA200 en H1
    data_get_ohlcv(count: 100) → leer barras individuales para identificar H-Lines

    Aplicar la misma regla de clasificación de PASO 3 para las MAs en H1.
    Evaluar tendencia H1:
      - Si MA20/MA40 van en sentido contrario a MA100/MA200 → clasificar cada grupo por separado
      - IMPORTANTE: mientras más separadas las MAs de rebote entre sí, más probable el rebote

    ── H-Lines: regla de identificación ──────────────────────────────────────
    Precio actual = quote_get(ticker).last

    HIGH-LINES (techo — encima del precio actual):
      Buscar en las 100 barras H1 los HIGHs que superen el precio actual.
      → Marcar el más RECIENTE (H-Max 1) y el SIGUIENTE más antiguo (H-Max 2).
      Máximo 2 líneas arriba.

    LOW-LINES (piso — debajo del precio actual):
      Buscar en las 100 barras H1 los LOWs que estén por debajo del precio actual.
      → Marcar el más RECIENTE (H-Min 1) y el SIGUIENTE más antiguo (H-Min 2).
      Máximo 2 líneas abajo.

    draw_shape(horizontal_line, precio=H_Max1) → "TICKER H1 Máx 1" (verde)
    draw_shape(horizontal_line, precio=H_Max2) → "TICKER H1 Máx 2" (verde claro)
    draw_shape(horizontal_line, precio=H_Min1) → "TICKER H1 Mín 1" (rojo)
    draw_shape(horizontal_line, precio=H_Min2) → "TICKER H1 Mín 2" (rojo claro)

    ⚠️ REGLA DE ORO: mientras más barras hayan pasado desde que se formó el nivel
       sin que el precio lo haya tocado → MAYOR probabilidad de rebote al llegar ahí.
    ⚠️ NO exceder 4 H-Lines por ticker (2 arriba + 2 abajo).
    ──────────────────────────────────────────────────────────────────────────

  PASO 5 — Líneas de tendencia
    (mantener el chart en H1 con BB visible)
    capture_screenshot(region: "chart") → visual para marcar trendlines manualmente
    Reportar: en el gráfico BB H1, marcar línea de tendencia conectando la mayor
    cantidad de máximos (bajista) o mínimos (alcista) posibles.
    Si se busca cambio de tendencia en H1 → la ruptura de esa trendline es el trigger.

  PASO 6 — Bid/Ask
    Reportar: "Verificar spread Bid/Ask y calcular spot/strike manualmente antes
    de entrar. El spread debe estar dentro del rango habitual para este activo."

  PASO 7 — Apertura / Premarket
    quote_get(symbol=ticker) → precio actual
    Reportar: precio actual, dirección estimada de apertura (gap up / gap down / flat)
    Identificar hacia dónde apunta el mercado al abrir.
```

### Reglas de análisis — lógica de rebotes (CRÍTICO)

**Bollinger Bands:**
- BB middle D1/H1 = soporte/resistencia dinámica de mayor peso
- ⚠️ BB middle se marca SOLO si tiene tendencia (alcista o bajista). Si está LATERAL → no se marca.
- Precio dentro de bandas H1 = movimiento normal; fuera de banda = sobreextensión → rebote probable
- BB middle H1 actúa como imán intraday → si precio lo supera con fuerza, confirma dirección

**Medias Móviles — regla por dirección individual (diagrama Investep):**

| Dirección MA | Posición vs precio | Clasificación | Dibujar |
|---|---|---|---|
| Alcista (subiendo) | Debajo del precio | PISO ✅ | Sí |
| Bajista (bajando) | Encima del precio | TECHO ✅ | Sí |
| Alcista (subiendo) | Encima del precio | Continuación ❌ | No |
| Bajista (bajando) | Debajo del precio | Continuación ❌ | No |

- Dirección de cada MA = su valor vs el período siguiente (MA20>MA40 → MA20 alcista, etc.)
- MAs separándose entre sí → tendencia fortaleciéndose → rebote más débil o inexistente
- Dibujar máx. 2 MAs por grupo (las más cercanas al precio actual)

**H-Lines (Máx/Mín en H1):**
- Identificar el HIGH más reciente POR ENCIMA del precio actual → H-Max 1
- Identificar el siguiente HIGH más antiguo por encima → H-Max 2
- Identificar el LOW más reciente POR DEBAJO del precio actual → H-Min 1
- Identificar el siguiente LOW más antiguo por debajo → H-Min 2
- Máximo 4 líneas por ticker (2 arriba + 2 abajo) — no exceder
- ⚠️ Mientras más barras hayan pasado sin que el precio toque ese nivel → MAYOR fuerza de rebote

### Output esperado por ticker
```
TICKER: AAPL
  BB D1   — Middle: $XXX → [TECHO / PISO / Neutro] | Tendencia BB D1: [Alcista / Bajista / Lateral]
  BB H1   — Precio [dentro / fuera sup / fuera inf] de bandas. Middle H1: $XXX → [TECHO / PISO]
  MAs D1  — Tendencia: [Alcista / Bajista / Lateral]
            Rebotes próximos (a favor tendencia): MA20 @ $XXX | MA40 @ $XXX
            MAs en contra (continuación): MA100 @ $XXX | MA200 @ $XXX
  MAs H1  — Tendencia corto: [Alcista / Bajista / Mixta (MA20/40 vs MA100/200)]
            Rebote más cercano: MAXX @ $XXX (separación vs siguiente: $X.XX)
            Máx reciente: $XXX | Mín reciente: $XXX
  Trendlines — Marcar manualmente en gráfico BB H1 conectando [máximos / mínimos]
  Bid/Ask    — Verificar spread y calcular strike manualmente antes de entrar
  Premarket  — Precio: $XXX | Apertura estimada: [Gap Up / Gap Down / Flat]
  ESTRATEGIAS POSIBLES:
    conditions_met → [STRAT-XX CALL/PUT: descripción corta]
    setup_forming  → [STRAT-XX CALL/PUT: qué falta para activarse]
    watch          → [STRAT-XX CALL/PUT: condición a vigilar]
```

### Paso final — Guardar reporte y líneas

Al terminar el checklist completo de los 6 tickers, llamar en este orden:
```
1. premarket_save(
     content="[reporte completo en markdown]",
     date="YYYY-MM-DD",
     brief_data="[JSON.stringify del output completo de morning_brief]"
   )

2. drawn_lines_save(
     entity_ids=["id1", "id2", ...]  ← todos los IDs retornados por draw_shape durante el checklist
   )
```
```
El reporte se guarda en `docs/sessions/premarket-YYYY-MM-DD.md` y también genera
`docs/sessions/premarket-YYYY-MM-DD.html` — dashboard estático.

**IMPORTANTE:** Pasar `brief_data` siempre — es el JSON del `morning_brief` completo
(`symbols_scanned` + `fundamental_filters`). Esto genera el HTML automáticamente.

**DESPUÉS de premarket_save exitoso:** abrir el dashboard en el browser con:
```
start docs\sessions\premarket-YYYY-MM-DD.html
```
Usar la fecha del reporte. Esto abre el dashboard automáticamente sin que el usuario tenga que pedirlo.

### Retroalimentación — Paso R (antes del morning_brief)

Llamar `trades_get(10)` y analizar los resultados antes de iniciar el análisis del día.

**Qué evaluar:**
- Win rate últimos 7 días por estrategia → si una estrategia tiene ≤30% win rate en la semana, marcarla como `baja confianza` en el reporte del día
- Win rate por ticker → tickers con pérdidas consecutivas recientes = más cautela
- Patrón BB M15 width + gap direction → si hay datos suficientes, ajustar prioridad de estrategias

**Formato del bloque de retroalimentación** (mostrar antes del análisis):

```
## 🔄 Retroalimentación (últimos N trades)
Win rate general: X/N (XX%)
| Ticker | Strat | Lado | Resultado | Modo |
|--------|-------|------|-----------|------|
| AAPL   | S-02  | CALL | +12%      | real |
...
⚠️ Alertas: [ej. "STRAT-02 PUT: 0/3 esta semana → baja confianza hoy"]
✅ Patrones confirmados: [ej. "BB M15 estrecho + gap up → CALL efectivo (2/2)"]
```

Si `trades_get` retorna 0 trades → omitir el bloque y continuar sin retroalimentación.

---

### Cierre de Sesión — Paso 8 (después de drawn_lines_save)

Al terminar el checklist, preguntar siempre:

> "¿Ejecutaste alguna operación hoy o ayer? Si me das los datos la registro en Supabase para el historial.
> Necesito: **ticker · estrategia · CALL/PUT · prima entrada · prima salida · real o paper**
> (strike y notas son opcionales)"

Si el usuario da los datos → llamar `trade_save(...)` con ellos.
Si dice "no operé" o no responde → continuar sin registrar.

**No insistir más de una vez.** Si el usuario ya registró via el dashboard HTML → no duplicar.

---

### Reglas operativas
- Verificar filtros globales: FED ±2 días hábiles / Earnings ±7 días por ticker
- Ventana válida: 9:30–11:30 AM ET únicamente
- Strike: prima dentro del rango óptimo por ticker (ver rules.json → asset_config)
- Expiración: más cercana. Corte viernes 11:00 AM ET → siguiente semana si ya pasó
- Exit: +12% profit GTC / -25% stop loss GTC (bracket inmediato al entrar)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
