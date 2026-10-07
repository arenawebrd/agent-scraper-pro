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
| `MAPBOX_TOKEN` | opcional | Rellena **localidad, provincia y código postal** cuando el proveedor no los trae (reverse geocoding, 1 req/negocio, gratis hasta 100k/mes) |
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
npm run smoke    # prueba del motor sin Telegram (gratis, ver nota)
npm run lint     # typecheck
```

- **Smoke sin gastar nada** (fuerza mock y apaga la IA):
  `AI_PROVIDER=none MAPS_PROVIDER=mock ANYAPI_KEY= SERPAPI_KEY= npm run smoke`
  ⚠️ Si tu `.env` tiene `MAPS_PROVIDER=serpapi` (o cualquier otro forzado) hace **falta** `MAPS_PROVIDER=mock`, porque el proveedor elegido no se cambia solo.
- **Smoke con claves reales**: cuesta ≈ **$0,0013** (AnyAPI trae 5 resultados en una sola página) o **1 crédito** si `MAPS_PROVIDER=serpapi`. Si la IA no tiene cuota libre, añade `AI_PROVIDER=none` o el smoke falla en la última sección.

> ⚠️ **Solo una instancia a la vez.** Telegram solo admite un `getUpdates` por bot: si levantas otra mientras una corre, **la que estaba corriendo antes es la que muere** con `409 Conflict` (la petición nueva corta a la antigua; solo sobrevive la última). Antes de relanzar, mata la anterior con `pkill -f "tsx src/index.ts"`.

### Comandos

| Comando | Qué hace |
|---|---|
| `/buscar dentistas en Santo Domingo` | Búsqueda directa sin IA |
| *(texto libre)* | El agente IA interpreta: *"cafeterías sin web en Madrid con menos de 20 reseñas"* |
| `/pais do` · `/idioma es` · `/max 40` · `/max todo` | Ajustes por defecto (`/max todo` = sin límite) |
| `/proveedor anyapi` | Fuente de datos: `auto` · `anyapi` · `serpapi` · `mock` (`/proveedor` sin argumentos la muestra) |
| `/ajustes` | Ver configuración actual |
| `/ayuda` | Instrucciones |

### Después de cada búsqueda

- **📄 CSV / 🧾 JSON** → envía el archivo al chat (mismas columnas que Prospect Hub + `thumbnail`, **`opening_hours` justo detrás**, `price`/`extracted_price`, `open_state`, `amenities`, `service_options`, `check_in_time`/`check_out_time` — estos dos se rellenan para hoteles y alojamientos, Google no siempre los publica, y hace falta `ENRICH_DETAILS=true` — y columnas dinámicas `ext_*` por rubro: `ext_highlights`, `ext_payments`, `ext_offerings`…, el contenido de `extensions` varía según el tipo de negocio)
- **➕ Cargar más** → siguiente página del mismo proveedor (el token de AnyAPI lleva las coordenadas, no se repite geocodificación)
- **🔍 Filtros** → sin web · sin teléfono · rating bajo · pocas reseñas · sin fotos (mismos umbrales que los chips de la app)
- **🔄 Nueva búsqueda** → limpia la sesión
- **Sin duplicados** → un negocio repetido entre páginas se descarta, y si el proveedor devuelve una página entera ya vista la paginación se detiene sola (no paginas de más)
- El preview muestra el proveedor usado y el coste acumulado en USD (`🛰 anyapi · 💲$0.0026`)

## Docker

```bash
cp .env.example .env             # si aún no tienes .env (Telegram + AnyAPI/SerpAPI)
sudo docker compose up -d --build
sudo docker compose logs -f      # actividad del bot (Ctrl+C no lo para, es -d)
sudo docker compose down         # parar
```

- La imagen compila TypeScript (`npm run build`) y arranca con `node dist/index.js`: dentro del contenedor **no hay `tsx` ni `typescript`**, corre como el usuario `node` (no root) y no escribe nada en disco → **no necesita volúmenes**.
- Tus claves **no entran en la imagen**: `.env` está en `.dockerignore` y el contenedor las recibe al arranque con `env_file: .env`.
- `restart: unless-stopped` lo vuelve a levantar si se cae o si reinicias la máquina; los logs se rotan (10 MB × 3) para no llenar el disco. Sin puertos que exponer: solo hace *long-polling* saliente a Telegram.
- ⚠️ **Una sola instancia**: si el bot de `npm start` sigue corriendo, páralo antes (`pkill -f "tsx src/index.ts"`) o uno de los dos muere con `409 Conflict`.
- Útiles: `sudo docker compose ps` (estado) · `sudo docker compose logs --tail 50 bot` · `sudo docker compose up -d --build` (reconstruir tras tocar código).

## Proveedores de datos

| | AnyAPI | SerpAPI | MOCK |
|---|---|---|---|
| Coste | **$0.0013 / página (20 res.)** ≈ $0,065 por 1000 resultados | 1 crédito / página ≈ $0,75 por 1000 (plan Developer: $75 por 5.000 búsquedas) | gratis |
| Paginación | cursor (`nextCursor`) | offset numérico | offset |
| Geocodificación | Nominatim (gratis) con `location` o la query | `ll` opcional de Google | — |
| `opening_hours` | ❌ (no los publica) | ✅ | ✅ |
| `extensions` (`ext_*`) | ❌ | ✅ | ❌ (los datos de prueba no los traen) |
| Detalle extra (`ENRICH_DETAILS`) | ❌ (`maps.place` existe a $0,00175/negocio, sin conectar) | ✅ | — |

- **`MAPS_PROVIDER=auto`** (default) → prueba AnyAPI; si falla o devuelve 0 resultados en la primera página, usa SerpAPI. Con dos keys, el orden es `anyapi → serpapi`.
- El proveedor se **fija en la primera página**: las páginas siguientes no pueden cambiar de fuente (un cursor no vale en otra API).
- Cambia de fuente en caliente con `/proveedor anyapi` (por chat, no hace falta tocar `.env`).
- **Si necesitas horarios, cambia a `/proveedor serpapi`** antes de buscar: AnyAPI no los da y enriquezarlos uno a uno con `maps.place` ($0,00175/local) sale más caro que SerpAPI entero.
- Solo las búsquedas exitosas se cobran: una entrada inválida de AnyAPI devuelve `400` **sin coste**.
- AnyAPI busca **por radio**: geocodifica `location` (o la cola de la query, "… en Madrid") y pagina con `zoom` 13 de serie; si pegas un enlace de Google Maps con `@lat,lng,zoom` usa esas coordenadas (el zoom se limita a `13z`, así un link muy pegado al suelo no recorta el radio). Una query sin ubicación ("`/buscar dentistas`") no la puede geocodificar → cae a SerpAPI.
- **Títulos formateados**: si el proveedor devuelve todo en mayúsculas o todo en minúsculas, cada palabra se escribe con inicial mayúscula (`"RESTAURANT EL PINO"` → `"Restaurant El Pino"`). Los que ya están bien escritos no se tocan (`OdontoLeon`, `GO Dental`) ni las siglas (`UPA`, `EEUU`).
- **Localidad / código postal**: con `MAPBOX_TOKEN` se hace un reverse geocoding por cada negocio al que le falte la provincia, la localidad o el CP (o que la tenga igual que la provincia). Rellena lo que el proveedor no trae y nunca pisa lo que ya está bien. Mapbox **no tiene CP de República Dominicana**, esos siguen vacíos si el proveedor no lo dio.

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
| Fuente de datos de mapas | `.env` → `MAPS_PROVIDER` o `/proveedor` | Ver sección *Proveedores de datos*; añadir otra = nuevo archivo en `src/providers/` |
| Modelo / proveedor de IA | `.env` → `AI_PROVIDER`, `AI_MODEL` | Ver tabla de variables |
| Nombre visible del bot | [@BotFather](https://t.me/BotFather) | No está en el código |

Los textos de `HELP_TEXT` y `SYSTEM_PROMPT` usan HTML de Telegram (`<b>`, `<code>`); el prompt de IA solo debe describir funciones que existan realmente en el código.

## Seguridad / costes

**AnyAPI cobra por llamada en USD** (nunca una entrada inválida, eso devuelve `400` sin coste):

| Concepto | Coste | Control |
|---|---|---|
| Página `maps.search_nearby` (20 resultados) | **$0.0013** | `MAX_RESULTS` + tope de 30 páginas |
| Búsqueda de texto `maps.search` (sin paginar) | **$0.00175** | solo cuando no hay coordenadas (fallback) |
| Detalle de un negocio (`maps.place`) | **$0.00175** | sin conectar: `ENRICH_DETAILS` solo habla con SerpAPI |
| Geocodificación (Nominatim) | gratis | 1 req/s, solo en la primera página |
| Reverse geocoding (Mapbox: localidad/provincia/CP) | gratis (hasta 100k req/mes) | solo a los negocios con campos vacíos |

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
