import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { aiAvailable, classifyMessage } from "./agent";
import { config, isChatAllowed } from "./config";
import { activeFilterLabels, applyFilters } from "./filters";
import { buildCSV, buildJSON, exportFilename } from "./export";
import { interpretMapsLink } from "./gmaps";
import { autoOrder, providerStatus, resultKey, searchAll, searchPage } from "./scraper";
import { clearSession, createSession, getHistory, getPrefs, getSession, pushHistory, updatePrefs } from "./session";
import { EMPTY_FILTERS, type Business, type Filters, type ProviderId, type SearchParams, type SearchSession } from "./types";

const HTML = { parse_mode: "HTML" as const } as const;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

const HELP_TEXT = `🤖 <b>Agent Scraper Pro</b> — busca prospectos en Google Maps y exporta CSV/JSON

<b>Modo rápido</b>
<code>/buscar dentistas en Santo Domingo</code>

<b>Modo agente (IA)</b> — escribe como si hablaras:
<code>busca cafeterías sin web en Madrid con menos de 20 reseñas</code>
también conversa: «¿qué puedes hacer?», «hola», «¿cómo exporto?»

<b>Enlace de Google Maps</b> — pega cualquier link y lo interpreto:
<code>google.com/maps/search/restaurantes+en+barcelona/@41.38,2.16,16z</code>

<b>Ajustes</b>
<code>/pais do</code> — país de búsqueda (código ISO)
<code>/idioma es</code> — idioma de resultados
<code>/max 40</code> — máximo de resultados por búsqueda
<code>/max todo</code> — sin límite, trae todos los disponibles
<code>/proveedor anyapi</code> — fuente de datos (auto / anyapi / serpapi / mock)
<code>/ajustes</code> — ver configuración

<b>Después de cada búsqueda</b>
📄 CSV / 🧾 JSON — exportar archivo
➕ Cargar más — siguiente página de resultados
🔍 Filtros — sin web, sin teléfono, rating bajo, pocas reseñas, sin fotos`;

// ── Render ──────────────────────────────────────────────────
export function renderPreview(session: SearchSession): string {
  const { params, results, filters, hasMore, pages, provider, costUsd } = session;
  const filtered = applyFilters(results, filters);
  const active = activeFilterLabels(filters);

  const head: string[] = [];
  head.push(`🔍 <b>${esc(params.query)}</b>`);

  let meta = `📊 <b>${filtered.length}</b> resultados`;
  if (filtered.length !== results.length) meta += ` de ${results.length} extraídos`;
  meta += ` · ${params.gl.toUpperCase()} · ${params.hl}`;
  if (provider) meta += ` · 🛰 ${provider}`;
  if (costUsd > 0) meta += ` · 💲$${costUsd.toFixed(4)}`;
  if (active.length) meta += `\n🎯 Filtros: <b>${esc(active.join(", "))}</b>`;
  head.push(meta);

  let paging = `📄 ${pages} página${pages === 1 ? "" : "s"} cargada${pages === 1 ? "" : "s"}`;
  const unlimited = params.max <= 0;
  if (!unlimited && hasMore) paging += ` · límite ${params.max} (sube con <code>/max 100</code>)`;
  else if (!unlimited && results.length >= params.max) paging += ` · ⚠️ límite de ${params.max} alcanzado`;
  else if (unlimited && hasMore) paging += ` · quedan páginas (➕ Cargar más)`;
  head.push(paging);

  if (results.length === 0) {
    return `${head.join("\n")}\n\nSin resultados. Prueba con otra ubicación o cambia el país con <code>/pais xx</code>.`;
  }
  if (filtered.length === 0) {
    return `${head.join("\n")}\n\nNingún resultado cumple los filtros. Desactíalos en 🔍 Filtros.`;
  }

  const blocks: string[] = [];
  const shown = filtered.slice(0, config.previewCount);
  for (let i = 0; i < shown.length; i++) {
    const b = shown[i];
    const rating = b.rating ? `⭐ ${b.rating}` : "⭐ sin rating";
    const reviews = b.reviews ? ` · ${b.reviews} reseñas` : "";
    const contact: string[] = [];
    if (b.phone) contact.push(`📞 <code>${esc(b.phone)}</code>`);
    contact.push(b.website ? `🌐 <code>${esc(shortUrl(String(b.website)))}</code>` : "🌐 <i>sin web</i>");

    let block = `<b>${i + 1}. ${esc(b.title)}</b>\n${rating}${reviews}\n${contact.join("  ·  ")}`;
    if (b.address) block += `\n📍 ${esc(b.address)}`;

    const current = blocks.join("\n\n");
    if (current.length + block.length > 3300) break;
    blocks.push(block);
  }

  const remaining = filtered.length - shown.length;
  const footer =
    remaining > 0
      ? `\n\n<i>… y ${remaining} más. Usa ➕ Cargar más o exporta 📄 CSV / 🧾 JSON (incluye todos).</i>`
      : "";
  return `${head.join("\n")}\n\n${blocks.join("\n\n")}${footer}`;
}

function mainKeyboard(session: SearchSession): InlineKeyboard {
  return new InlineKeyboard()
    .text("📄 CSV", "csv")
    .text("🧾 JSON", "json")
    .row()
    .text("➕ Cargar más", "more")
    .text("🔍 Filtros", "filters")
    .row()
    .text("🔄 Nueva búsqueda", "reset");
}

function filtersKeyboard(f: Filters): InlineKeyboard {
  const mark = (on: boolean) => (on ? "✅ " : "⬜ ");
  return new InlineKeyboard()
    .text(`${mark(f.sinWeb)}Sin web`, "f:sinWeb")
    .text(`${mark(f.sinTelefono)}Sin teléfono`, "f:sinTelefono")
    .row()
    .text(`${mark(f.ratingBajo)}Rating bajo`, "f:ratingBajo")
    .text(`${mark(f.pocasReviews)}Pocas reseñas`, "f:pocasReviews")
    .row()
    .text(`${mark(f.sinFotos)}Sin fotos`, "f:sinFotos")
    .text("⬅️ Volver", "back")
    .row();
}

const FILTER_KEYS: (keyof Filters)[] = ["sinWeb", "sinTelefono", "ratingBajo", "pocasReviews", "sinFotos"];

// ── Búsqueda ────────────────────────────────────────────────
async function runSearch(
  ctx: Context,
  params: SearchParams,
  filters: Partial<Filters> = {},
  statusId?: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = createSession(chatId, params, filters);
  session.busy = true;
  const prefs = getPrefs(chatId);
  console.log(
    `[bot] búsqueda "${params.query}" gl=${params.gl} hl=${params.hl} ll=${params.ll || "-"} max=${params.max} proveedor=${prefs.provider} filtros=${JSON.stringify(filters)}`
  );

  const statusText = `⏳ Buscando <b>${esc(params.query)}</b>…`;
  let statusId2 = statusId;
  if (statusId2) {
    await ctx.api.editMessageText(chatId, statusId2, statusText, HTML).catch(() => {});
  } else {
    statusId2 = (await ctx.reply(statusText, HTML)).message_id;
  }
  try {
    let pages = 0;
    const page = await searchAll(
      params,
      async (collected) => {
        pages++;
        await ctx.api
          .editMessageText(
            chatId,
            statusId2!,
            `⏳ Buscando <b>${esc(params.query)}</b>…\n📄 página ${pages} · ${collected} resultados`,
            HTML
          )
          .catch((e: any) => console.warn(`[bot] edit de progreso falló: ${e?.description || e?.message}`));
      },
      prefs.provider
    );

    session.results = page.results;
    session.hasMore = page.hasMore;
    session.token = page.nextToken ?? 0;
    session.provider = page.provider;
    session.costUsd = page.costUsd ?? 0;
    session.pages = Math.max(pages, 1);
    session.busy = false;
    console.log(
      `[bot] → ${session.results.length} resultados en ${session.pages} página(s), hasMore=${page.hasMore}, proveedor=${page.provider}, coste=$${session.costUsd.toFixed(4)}`
    );

    if (session.results.length === 0) {
      await ctx.api.editMessageText(
        chatId,
        statusId2!,
        `No encontré resultados para <b>${esc(params.query)}</b> (${params.gl.toUpperCase()}).\nPrueba con otra redacción o cambia de país con <code>/pais xx</code>.`,
        HTML
      );
      clearSession(chatId);
      return;
    }

    // Preview con logging: si Telegram rechaza el HTML, caemos a texto simple
    try {
      const preview = renderPreview(session);
      await ctx.api.editMessageText(chatId, statusId2!, preview, {
        ...HTML,
        reply_markup: mainKeyboard(session),
      });
      console.log(`[bot] preview enviado OK (${preview.length} chars)`);
    } catch (previewError: any) {
      const detail = previewError?.description || previewError?.message || String(previewError);
      console.warn(`[bot] FALLÓ el edit del preview: ${detail}`);
      await ctx.api
        .editMessageText(
          chatId,
          statusId2!,
          `✅ ${session.results.length} resultados listos de "${params.query}".`,
          { reply_markup: mainKeyboard(session) }
        )
        .then(
          () => console.log("[bot] preview de respaldo enviado"),
          (e2: any) => console.warn(`[bot] respaldo también falló: ${e2?.description || e2?.message}`)
        );
    }
  } catch (error: any) {
    session.busy = false;
    clearSession(chatId);
    const detail = error?.description || error?.message || String(error);
    console.warn(`[bot] error en runSearch: ${detail}`);
    await ctx.api
      .editMessageText(chatId, statusId2!, `⚠️ Error: ${esc(detail)}`, HTML)
      .catch((e2: any) => console.warn(`[bot] edit de error falló: ${e2?.description || e2?.message}`));
  }
}

async function loadMore(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  const session = chatId ? getSession(chatId) : undefined;
  if (!session) {
    await ctx.answerCallbackQuery({ text: "No hay búsqueda activa. Usa /buscar" });
    return;
  }
  if (session.busy) {
    await ctx.answerCallbackQuery({ text: "Espera a que termine la búsqueda actual…" });
    return;
  }
  if (session.params.max > 0 && session.results.length >= session.params.max) {
    await ctx.answerCallbackQuery({
      text: `Límite de ${session.params.max} alcanzado — usa /max 100 para subirlo`,
      show_alert: true,
    });
    return;
  }
  if (!session.hasMore) {
    await ctx.answerCallbackQuery({ text: "Google Maps no devuelve más páginas para esta búsqueda" });
    return;
  }

  session.busy = true;
  try {
    const page = await searchPage(session.params, session.token, {
      provider: session.provider ?? config.provider,
      first: !session.provider,
    });
    const seen = new Set(session.results.map(resultKey));
    let added = 0;
    for (const r of page.results) {
      // Respeta /max aunque el proveedor traiga una página entera de 20
      if (session.params.max > 0 && session.results.length >= session.params.max) break;
      const key = resultKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      session.results.push(r);
      added++;
    }
    session.token = page.nextToken ?? session.token;
    session.provider = page.provider;
    session.costUsd = (session.costUsd || 0) + (page.costUsd ?? 0);
    const withinLimit = session.params.max <= 0 || session.results.length < session.params.max;
    // Página sin nada nuevo → ya no hay más negocios, no sigas paginando
    session.hasMore = page.hasMore && withinLimit && added > 0;
    session.pages += 1;
    session.busy = false;
    console.log(
      `[bot] cargar más → +${added} (total ${session.results.length}, página ${session.pages}, hasMore=${session.hasMore}, proveedor=${page.provider}, coste=$${session.costUsd.toFixed(4)})`
    );

    await ctx.editMessageText(renderPreview(session), {
      ...HTML,
      reply_markup: mainKeyboard(session),
    });
    await ctx.answerCallbackQuery({ text: added ? `+${added} resultados` : "Sin resultados nuevos" });
  } catch (error: any) {
    session.busy = false;
    await ctx.answerCallbackQuery({ text: `Error: ${String(error?.message || error).slice(0, 100)}` });
  }
}

async function sendExport(ctx: Context, ext: "csv" | "json"): Promise<void> {
  const chatId = ctx.chat?.id;
  const session = chatId ? getSession(chatId) : undefined;
  if (!session) {
    await ctx.answerCallbackQuery({ text: "No hay búsqueda activa. Usa /buscar" });
    return;
  }
  const data = applyFilters(session.results, session.filters);
  if (data.length === 0) {
    await ctx.answerCallbackQuery({ text: "0 resultados con los filtros actuales" });
    return;
  }

  await ctx.answerCallbackQuery({ text: `Generando ${ext.toUpperCase()}…` });
  const buffer = ext === "csv" ? buildCSV(data) : buildJSON(data);
  const filename = exportFilename(ext);
  const active = activeFilterLabels(session.filters);
  const caption =
    `📊 <b>${data.length}</b> leads · ${esc(session.params.query)} · ${session.params.gl.toUpperCase()}` +
    (active.length ? ` · 🎯 ${esc(active.join(", "))}` : "");

  await ctx.replyWithDocument(new InputFile(buffer, filename), { ...HTML, caption });
}

// ── Bot ─────────────────────────────────────────────────────
export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  // Whitelist de chats
  bot.use(async (ctx, next) => {
    const id = ctx.chat?.id ?? ctx.from?.id;
    if (id && !isChatAllowed(id)) {
      if (ctx.message) await ctx.reply("🔒 No estás autorizado para usar este bot.");
      else await ctx.answerCallbackQuery({ text: "No autorizado" }).catch(() => {});
      return;
    }
    await next();
  });

  const startSearch = (params: SearchParams, filters: Partial<Filters> = {}) => (ctx: Context) =>
    runSearch(ctx, params, filters);

  bot.command("start", (ctx) => ctx.reply(HELP_TEXT, HTML));
  bot.command("ayuda", (ctx) => ctx.reply(HELP_TEXT, HTML));

  bot.command("buscar", async (ctx) => {
    const query = String(ctx.match || "").trim();
    if (!query) {
      await ctx.reply("Usa: <code>/buscar dentistas en Santo Domingo</code>", HTML);
      return;
    }
    const prefs = getPrefs(ctx.chat!.id);
    await runSearch(ctx, { query, gl: prefs.gl, hl: prefs.hl, max: prefs.max });
  });

  bot.command("pais", async (ctx) => {
    const code = String(ctx.match || "").trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) {
      await ctx.reply("Ejemplo: <code>/pais do</code> · <code>/pais es</code> · <code>/pais mx</code>", HTML);
      return;
    }
    updatePrefs(ctx.chat!.id, { gl: code });
    await ctx.reply(`✅ País de búsqueda: <b>${code.toUpperCase()}</b> (ahora por defecto)`, HTML);
  });

  bot.command("idioma", async (ctx) => {
    const code = String(ctx.match || "").trim().toLowerCase();
    if (!/^[a-z]{2,3}$/.test(code)) {
      await ctx.reply("Ejemplo: <code>/idioma es</code> · <code>/idioma en</code>", HTML);
      return;
    }
    updatePrefs(ctx.chat!.id, { hl: code });
    await ctx.reply(`✅ Idioma de resultados: <b>${code}</b>`, HTML);
  });

  bot.command("max", async (ctx) => {
    const raw = String(ctx.match || "").trim().toLowerCase();
    if (["0", "todo", "todos", "all"].includes(raw)) {
      updatePrefs(ctx.chat!.id, { max: 0 });
      await ctx.reply("✅ Sin límite: cada búsqueda trae <b>todos</b> los resultados disponibles", HTML);
      return;
    }
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 5) {
      await ctx.reply(
        `Ejemplos: <code>/max 40</code> · <code>/max todo</code> (tope máximo: ${config.maxResultsCap})`,
        HTML
      );
      return;
    }
    const value = Math.min(n, config.maxResultsCap);
    updatePrefs(ctx.chat!.id, { max: value });
    await ctx.reply(`✅ Máximo de resultados por búsqueda: <b>${value}</b>`, HTML);
  });

  bot.command("proveedor", async (ctx) => {
    const raw = String(ctx.match || "").trim().toLowerCase();
    const current = getPrefs(ctx.chat!.id).provider;

    if (!raw) {
      const status = providerStatus()
        .map((s) => `${s.available ? "✅" : "⚪️"} <code>${s.id}</code> — ${esc(s.label)}`)
        .join("\n");
      await ctx.reply(
        `<b>Proveedor de datos de mapas</b>\nActual: <b>${current}</b>${
          current === "auto" ? ` → ${autoOrder().join(" → ")}` : ""
        }\n\n${status}\n\nCambia con <code>/proveedor auto</code> · <code>/proveedor anyapi</code> · <code>/proveedor serpapi</code> · <code>/proveedor mock</code>`,
        HTML
      );
      return;
    }

    const options: ProviderId[] = ["auto", "anyapi", "serpapi", "mock"];
    if (!options.includes(raw as ProviderId)) {
      await ctx.reply(
        "Opción no válida. Usa <code>/proveedor auto</code> · <code>/proveedor anyapi</code> · <code>/proveedor serpapi</code> · <code>/proveedor mock</code>",
        HTML
      );
      return;
    }
    const id = raw as ProviderId;
    if (id !== "auto") {
      const status = providerStatus().find((s) => s.id === id);
      if (status && !status.available) {
        const envVar = id === "serpapi" ? "SERPAPI_KEY" : id === "anyapi" ? "ANYAPI_KEY" : "";
        await ctx.reply(
          `⚠️ El proveedor <b>${id}</b> no está configurado: falta <code>${envVar}</code> en .env.`,
          HTML
        );
        return;
      }
    }
    updatePrefs(ctx.chat!.id, { provider: id });
    await ctx.reply(
      id === "auto"
        ? `✅ Proveedor: <b>auto</b> → ${autoOrder().join(" → ")}`
        : `✅ Proveedor: <b>${id}</b> — las próximas búsquedas usarán esta fuente`,
      HTML
    );
  });

  bot.command("ajustes", async (ctx) => {
    const prefs = getPrefs(ctx.chat!.id);
    const ai = aiAvailable()
      ? `🧠 ${config.ai.provider} · <code>${config.ai.model}</code>`
      : "🧠 desactivado (solo comandos /buscar)";
    const scraper = `🛰 Fuente: <b>${prefs.provider}</b>${
      prefs.provider === "auto" ? ` → ${autoOrder().join(" → ")}` : ""
    }`;
    const access =
      config.allowedChatIds.length > 0
        ? `🔒 whitelist: ${config.allowedChatIds.length} chat(s)`
        : "⚠️ abierto a cualquier chat (define ALLOWED_CHAT_IDS)";
    await ctx.reply(
      `<b>Ajustes actuales</b>\n🌍 País: <b>${prefs.gl.toUpperCase()}</b>\n🗣 Idioma: <b>${prefs.hl}</b>\n📊 Máx. resultados: <b>${prefs.max || "todos"}</b>\n${scraper}\n${ai}\n${access}`,
      HTML
    );
  });

  // Texto libre → agente IA (fallback: usar el texto tal cual como query)
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await ctx.reply("Comando no reconocido. Usa /ayuda", HTML);
      return;
    }
    const prefs = getPrefs(ctx.chat.id);
    const defaults = { gl: prefs.gl, hl: prefs.hl, max: prefs.max };

    // Enlace de Google Maps → query + coordenadas + país
    if (/https?:\/\//.test(text)) {
      const status = await ctx.reply("🔗 Interpretando enlace de Google Maps…");
      try {
        const link = await interpretMapsLink(text);
        if (!link) {
          await ctx.api.editMessageText(
            ctx.chat.id,
            status.message_id,
            "No pude leer ese enlace. Pega uno de Google Maps, por ejemplo:\n<code>google.com/maps/search/dentistas+en+madrid/@40.4,-3.7,12z</code>",
            HTML
          );
          return;
        }
        const params: SearchParams = {
          query: link.params.query,
          gl: link.params.gl || prefs.gl,
          hl: prefs.hl,
          max: prefs.max,
        };
        if (link.params.ll) params.ll = link.params.ll;
        await runSearch(ctx, params, {}, status.message_id);
      } catch (error: any) {
        await ctx.api
          .editMessageText(ctx.chat.id, status.message_id, `⚠️ ${esc(error?.message || error)}`, HTML)
          .catch(() => {});
      }
      return;
    }

    if (aiAvailable()) {
      const status = await ctx.reply("🧠 Pensando…");
      try {
        const result = await classifyMessage(text, defaults, getHistory(ctx.chat.id));

        // Conversación: saludos, dudas, preguntas sobre el bot…
        if (result?.kind === "chat") {
          pushHistory(ctx.chat.id, text, result.reply);
          await ctx.api.editMessageText(ctx.chat.id, status.message_id, result.reply);
          return;
        }

        // Búsqueda en lenguaje natural
        if (result?.kind === "search") {
          const active = Object.keys(result.filters).length
            ? " · 🎯 " + esc(activeFilterLabels(result.filters as Filters).join(", "))
            : "";
          await ctx.api.editMessageText(
            ctx.chat.id,
            status.message_id,
            `🧠 <b>${esc(result.params.query)}</b> · ${result.params.gl.toUpperCase()}${active}`,
            HTML
          );
          pushHistory(ctx.chat.id, text, `Búsqueda ejecutada: "${result.params.query}" (${result.params.gl.toUpperCase()})`);
          await runSearch(ctx, result.params, result.filters, status.message_id);
          return;
        }

        await ctx.api.editMessageText(
          ctx.chat.id,
          status.message_id,
          "No pude interpretarlo con IA. Búsqueda directa:",
          HTML
        );
      } catch (error: any) {
        await ctx.api
          .editMessageText(ctx.chat.id, status.message_id, `⚠️ IA: ${esc(error?.message || error)}. Búsqueda directa:`, HTML)
          .catch(() => {});
      }
    }

    await runSearch(ctx, { query: text, gl: prefs.gl, hl: prefs.hl, max: prefs.max });
  });

  // Botones
  bot.callbackQuery("csv", (ctx) => sendExport(ctx, "csv"));
  bot.callbackQuery("json", (ctx) => sendExport(ctx, "json"));
  bot.callbackQuery("more", (ctx) => loadMore(ctx));

  bot.callbackQuery("filters", async (ctx) => {
    const session = ctx.chat ? getSession(ctx.chat.id) : undefined;
    if (!session) {
      await ctx.answerCallbackQuery({ text: "No hay búsqueda activa" });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`${renderPreview(session)}\n\n<b>🔍 Filtros (alternar):</b>`, {
      ...HTML,
      reply_markup: filtersKeyboard(session.filters),
    });
  });

  bot.callbackQuery("back", async (ctx) => {
    const session = ctx.chat ? getSession(ctx.chat.id) : undefined;
    if (!session) {
      await ctx.answerCallbackQuery({ text: "No hay búsqueda activa" });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(renderPreview(session), {
      ...HTML,
      reply_markup: mainKeyboard(session),
    });
  });

  bot.callbackQuery(/^f:(\w+)$/, async (ctx) => {
    const key = ctx.match[1] as keyof Filters;
    const session = ctx.chat ? getSession(ctx.chat.id) : undefined;
    if (!session || !FILTER_KEYS.includes(key)) {
      await ctx.answerCallbackQuery({ text: "No hay búsqueda activa" });
      return;
    }
    session.filters[key] = !session.filters[key];
    const filtered = applyFilters(session.results, session.filters);
    await ctx.answerCallbackQuery({
      text: `${session.filters[key] ? "✅" : "⬜"} ${key} · ${filtered.length} resultados`,
    });
    await ctx.editMessageText(`${renderPreview(session)}\n\n<b>🔍 Filtros (alternar):</b>`, {
      ...HTML,
      reply_markup: filtersKeyboard(session.filters),
    });
  });

  bot.callbackQuery("reset", async (ctx) => {
    if (ctx.chat) clearSession(ctx.chat.id);
    await ctx.answerCallbackQuery({ text: "Búsqueda borrada" });
    await ctx.editMessageText("🔄 Borrado. Escribe tu próxima búsqueda o usa <code>/buscar …</code>", {
      ...HTML,
      reply_markup: { inline_keyboard: [] },
    });
  });

  bot.catch((err) => {
    console.error("[bot] error:", (err as any)?.error?.message ?? err);
  });

  return bot;
}
