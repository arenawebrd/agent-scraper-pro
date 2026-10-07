# Agent Scraper Pro 🤖

Bot de Telegram que busca prospectos en **Google Maps** usando el mismo motor que el módulo *Google Maps Scraper* de Prospect Hub (SerpAPI) o AnyAPI (~11× más barato), con agente de IA opcional para buscar en lenguaje natural y exportación a **CSV / JSON** con las mismas columnas que la app.

## Requisitos

- Node.js 20+
- Una API key de [AnyAPI](https://getanyapi.com) o de [SerpAPI](https://serpapi.com) (si no, el bot funciona en **modo MOCK** con datos de prueba)
- Un bot de Telegram creado con [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`

## Instalación

```bash
npm install
cp .env.example .env   # y rellena tus claves
```

### Variables `.env`

| Variable | Obligatoria | Descripción |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token de BotFather |
| `MAPS_PROVIDER` | opcional | `auto` (default) · `anyapi` · `serpapi` · `mock`. Fuente de datos de Google Maps |
| `ANYAPI_KEY` | recomendada | [getanyapi.com](https://getanyapi.com) → $0.0013 por página de 20 resultados |
| `SERPAPI_KEY` | recomendada | [serpapi.com](https://serpapi.com) → 1 crédito por página. Sin ninguna key → modo MOCK (gratis) |
| `MAPBOX_TOKEN` | opcional | Enriquece calle/ciudad/provincia de cada lead (solo SerpAPI) |
| `ENRICH_DETAILS` | opcional | `false` (default) · `true` → pide el detalle de cada negocio a SerpAPI: **1 crédito extra por negocio** que le falte web/teléfono (solo SerpAPI) |
| `ALLOWED_CHAT_IDS` | recomendada | IDs de Telegram autorizados, separados por coma. Vacío = bot abierto a cualquiera (⚠️ consume tu cuota) |
| `AI_PROVIDER` | opcional | `opencode` · `gemini` · `openai` · `claude` · `openrouter` · `groq` · `none` |
| `AI_MODEL` | opcional | Fuerza un modelo concreto (si no, usa el default del proveedor) |
| `*_API_KEY` | según proveedor | `OPENCODE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` |
| `MAX_RESULTS` | opcional | Resultados por búsqueda: `0` / `todo` (default) = **todos los disponibles** · número = tope (máx 200) |
| `DEFAULT_GL` / `DEFAULT_HL` | opcional | País e idioma por defecto (default `do` / `es`) |

## Uso

```bash
npm run dev      # desarrollo (reinicio automático)
npm start        # producción
npm run smoke    # prueba del motor sin Telegram (con keys gasta ~$0,004; gratis: ANYAPI_KEY= SERPAPI_KEY= npm run smoke)
npm run lint     # typecheck
```

### Comandos

| Comando | Qué hace |
|---|---|
| `/buscar dentistas en Santo Domingo` | Búsqueda directa sin IA |
| *(texto libre)* | El agente IA interpreta: *"cafeterías sin web en Madrid con menos de 20 reseñas"* |
| `/pais do` · `/idioma es` · `/max 40` · `/max todo` | Ajustes por defecto (`/max todo` = sin límite) |
| `/proveedor anyapi` | Fuente de datos: `auto` · `anyapi` · `serpapi` (`/proveedor` sin argumentos la muestra) |
| `/ajustes` | Ver configuración actual |
| `/ayuda` | Instrucciones |

### Después de cada búsqueda

- **📄 CSV / 🧾 JSON** → envía el archivo al chat (mismas columnas que Prospect Hub + `thumbnail`, `price`/`extracted_price`, `open_state`, `amenities`, `service_options`, `check_in_time`/`check_out_time` — estos dos se rellenan para hoteles y alojamientos, Google no siempre los publica, y hace falta `ENRICH_DETAILS=true` — y columnas dinámicas `ext_*` por rubro: `ext_highlights`, `ext_payments`, `ext_offerings`…, el contenido de `extensions` varía según el tipo de negocio)
- **➕ Cargar más** → siguiente página del mismo proveedor (el token de AnyAPI lleva las coordenadas, no se repite geocodificación)
- **🔍 Filtros** → sin web · sin teléfono · rating bajo · pocas reseñas · sin fotos (mismos umbrales que los chips de la app)
- **🔄 Nueva búsqueda** → limpia la sesión
- **Sin duplicados** → un negocio repetido entre páginas se descarta, y si el proveedor devuelve una página entera ya vista la paginación se detiene sola (no paginas de más)
- El preview muestra el proveedor usado y el coste acumulado en USD (`🛰 anyapi · 💲$0.0026`)

## Proveedores de datos

| | AnyAPI | SerpAPI | MOCK |
|---|---|---|---|
| Coste | **$0.0013 / página (20 res.)** ≈ $0,065 por 1000 resultados | 1 crédito / página ≈ $0,75 por 1000 | gratis |
| Paginación | cursor (`nextCursor`) | offset numérico | offset |
| Geocodificación | Nominatim (gratis) con `location` o la query | `ll` opcional de Google | — |
| `opening_hours` | ❌ (no los publica) | ✅ | ✅ |
| `extensions` (`ext_*`) | ❌ | ✅ | ✅ |
| Detalle extra (`ENRICH_DETAILS`) | ❌ (pendiente de `maps.place`) | ✅ | ✅ |

- **`MAPS_PROVIDER=auto`** (default) → prueba AnyAPI; si falla o devuelve 0 resultados en la primera página, usa SerpAPI. Con dos keys, el orden es `anyapi → serpapi`.
- El proveedor se **fija en la primera página**: las páginas siguientes no pueden cambiar de fuente (un cursor no vale en otra API).
- Cambia de fuente en caliente con `/proveedor anyapi` (por chat, no hace falta tocar `.env`).
- Solo las búsquedas exitosas se cobran: una entrada inválida de AnyAPI devuelve `400` **sin coste**.

## Cómo funciona

```
Telegram → bot.ts → agent.ts (IA: texto → parámetros)
                        ↓
                  scraper.ts (elige proveedor + fallback + dedupe)
                        ↓
                  providers/anyapi.ts · providers/serpapi.ts · providers/mock.ts
                        ↓
                  filters.ts → export.ts (CSV/JSON) → Telegram
```

`providers/serpapi.ts` es un port directo de `server.ts:795-919` de Prospect Hub: búsqueda paginada, enriquecimiento de teléfono/web en chunks de 5 con timeout de 15s, `getGoogleDomain()` por país, normalización de horarios y geocodificación inversa con Mapbox. Cualquier fuente nueva solo debe implementar la interfaz `MapsProvider` de `providers/types.ts` (`available()` + `search(params, token)`) y registrarse en `providers/index.ts`.

## Personalización (identidad y prompts)

| Qué cambiar | Dónde | Detalle |
|---|---|---|
| Prompt / personalidad de la IA | `src/agent.ts` → `SYSTEM_PROMPT` | Identidad ("Agent Scraper Pro"), capacidades, tono, idioma y el JSON que debe devolver (`type="search"` / `type="chat"`) |
| Texto de `/start` y `/ayuda` | `src/bot.ts` → `HELP_TEXT` | Mensaje de bienvenida e instrucciones (HTML de Telegram) |
| Descripciones de comandos (menú) | `src/index.ts` → `setMyCommands` | Nombre y descripción que muestra Telegram bajo el chat |
| Resto de mensajes del bot | `src/bot.ts` | Preview de resultados, errores, botones y textos de estado (literales en el código) |
| Modelo / proveedor de IA | `.env` → `AI_PROVIDER`, `AI_MODEL` | Ver tabla de variables |
| Nombre visible del bot | [@BotFather](https://t.me/BotFather) | No está en el código |

Los textos de `HELP_TEXT` y `SYSTEM_PROMPT` usan HTML de Telegram (`<b>`, `<code>`); el prompt de IA solo debe describir funciones que existan realmente en el código.

## Seguridad / costes

**AnyAPI cobra por llamada en USD** (nunca una entrada inválida, eso devuelve `400` sin coste):

| Concepto | Coste | Control |
|---|---|---|
| Página `maps.search_nearby` (20 resultados) | **$0.0013** | `MAX_RESULTS` + tope de 30 páginas |
| Geocodificación (Nominatim) | gratis | 1 req/s, solo en la primera página |
| Detalle de un negocio | no existe aún | — |

**SerpAPI cuenta 1 crédito por petición exitosa** (fallidas y caché ≤1h son gratis):

| Concepto | Créditos | Control |
|---|---|---|
| Página de búsqueda (`type=search`) | 1 por página (20 resultados) | `MAX_RESULTS` (default `0` = todas las disponibles, Google suele dar ~60-120) |
| Detalle de un negocio (`type=place`) | 1 **por negocio** | `ENRICH_DETAILS=false` (default) → 0 |
| IA (interpretar el texto) | no usa SerpAPI | `AI_PROVIDER=none` la desactiva |

- `ALLOWED_CHAT_IDS` + `MAX_RESULTS` protegen tu cuota de búsquedas.
- La IA solo se usa para interpretar el texto (respuesta corta y barata); si falla, el bot hace la búsqueda con el texto tal cual.
- Con `ENRICH_DETAILS=false` el coste por búsqueda es **1 crédito por página** (igual que Prospect Hub); los campos que solo da el detalle (`website` que falta, `check_in_time`…) quedan vacíos.
- El coste real de AnyAPI se acumula por sesión y aparece en el preview y en los logs (`[anyapi] nearby … $0.0013`).
