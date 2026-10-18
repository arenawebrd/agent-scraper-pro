import { Bot, InputFile, type Context } from "grammy";
import { aiAvailable, classifyMessage } from "./agent";
import { config, isChatAllowed, PROVIDER_IDS } from "./config";
import { activeFilterLabels, applyFilters } from "./filters";
import { buildCSV, buildJSON, exportFilename } from "./export";
import { buildDirectoryCSV } from "./directory";
import { interpretMapsLink } from "./gmaps";
import { esc, FILTER_KEYS, filtersKeyboard, mainKeyboard, renderPreview } from "./render";
import { autoOrder, providerStatus, resultKey, searchAll, searchPage, type ResolvedPage } from "./scraper";
import { clearSession, createSession, getHistory, getPrefs, getSession, pushHistory, updatePrefs } from "./session";
import { searchArea, type SweepResult } from "./sweep";
import { HELP_TEXT } from "./texts";
import type { Filters, ProviderId, SearchParams } from "./types";

const HTML = { parse_mode: "HTML" as const } as const;

// ── Búsqueda ────────────────────────────────────────────────
async function runSearch(
  ctx: Context,
  params: SearchParams,
  filters: Partial<Filters> = {},
  statusId?: number,
  directory = false,
  sweep = false
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Una búsqueda a la vez por chat: evita pagar dos veces y sesiones pisadas
  if (getSession(chatId)?.busy) {
    await ctx.reply("⏳ Ya hay una búsqueda en curso en este chat. Espera a que termine.");
    return;
  }

  const session = createSession(chatId, params, filters);
  session.exportFormat = directory ? "directory" : "leads";
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
  const progress = async (text: string) => {
    await ctx.api
      .editMessageText(chatId, statusId2!, text, HTML)
      .catch((e: any) => console.warn(`[bot] edit de progreso falló: ${e?.description || e?.message}`));
  };

  try {
    let pages = 0;
    let cells = 1;
    let page: ResolvedPage;
    if (sweep) {
      page = await searchArea(params, prefs.provider, {
        onCell: (done, total, found) =>
          progress(`⏳ Barriendo <b>${esc(params.query)}</b>…\n🗺 celda ${done}/${total} · ${found} resultados`),
      });
      cells = (page as SweepResult).cells;
    } else {
      page = await searchAll(
        params,
        async (collected) => {
          pages++;
          await progress(`⏳ Buscando <b>${esc(params.query)}</b>…\n📄 página ${pages} · ${collected} resultados`);
        },
        prefs.provider
      );
    }

    session.results = page.results;
    session.hasMore = page.hasMore;
    session.token = page.nextToken ?? 0;
    session.provider = page.provider;
    session.costUsd = page.costUsd ?? 0;
    session.pages = sweep ? cells : Math.max(pages, 1);
    session.busy = false;
    console.log(
      `[bot] → ${session.results.length} resultados en ${sweep ? `${cells} celdas` : `${session.pages} página(s)`}, hasMore=${page.hasMore}, proveedor=${page.provider}, coste=$${session.costUsd.toFixed(4)}`
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

async function sendExport(ctx: Context, ext: "csv" | "json" | "directory"): Promise<void> {
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

  const label = ext === "directory" ? "DIRECTORIO" : ext.toUpperCase();
  await ctx.answerCallbackQuery({ text: `Generando ${label}…` });
  const buffer = ext === "directory" ? buildDirectoryCSV(data, session.params.gl) : ext === "csv" ? buildCSV(data) : buildJSON(data);
  const filename = ext === "directory" ? "listings-data.csv" : exportFilename(ext === "json" ? "json" : "csv");
  const active = activeFilterLabels(session.filters);
  const caption =
    `📊 <b>${data.length}</b> leads · ${esc(session.params.query)} · ${session.params.gl.toUpperCase()}` +
    (active.length ? ` · 🎯 ${esc(active.join(", "))}` : "") +
    (ext === "directory"
      ? "\n📁 Formato directorio (listings-data.csv). Para procesarlo: <code>npm run process-listings listings-data.csv</code>"
      : "");

  await ctx.replyWithDocument(new InputFile(buffer, filename), { ...HTML, caption });
}

// ── Bot ─────────────────────────────────────────────────────
export function createBot(): Bot {
  const bot = new Bot(config.telegramToken);

  // Whitelist de chats
  bot.use(async (ctx, next) => {
    const id = ctx.chat?.id ?? ctx.from?.id;
    if (id && !isChatAllowed(id)) {
      console.warn(`[bot] chat no autorizado: ${id}`);
      if (ctx.message) {
        await ctx.reply(
          `🔒 No estás autorizado para usar este bot.\nTu chat id es <code>${id}</code> — si eres el dueño, añádelo a <code>ALLOWED_CHAT_IDS</code> en .env y reinicia.`,
          HTML
        );
      } else {
        await ctx.answerCallbackQuery({ text: "No autorizado" }).catch(() => {});
      }
      return;
    }
    await next();
  });

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

  bot.command("directorio", async (ctx) => {
    const query = String(ctx.match || "").trim();
    if (!query) {
      await ctx.reply("Usa: <code>/directorio restaurantes en Las Terrenas</code>", HTML);
      return;
    }
    const prefs = getPrefs(ctx.chat!.id);
    await runSearch(ctx, { query, gl: prefs.gl, hl: prefs.hl, max: prefs.max }, {}, undefined, true);
  });

  bot.command("provincia", async (ctx) => {
    const query = String(ctx.match || "").trim();
    if (!query) {
      await ctx.reply("Usa: <code>/provincia farmacias en Samaná</code>", HTML);
      return;
    }
    const prefs = getPrefs(ctx.chat!.id);
    await runSearch(ctx, { query, gl: prefs.gl, hl: prefs.hl, max: prefs.max }, {}, undefined, false, true);
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

    if (!PROVIDER_IDS.includes(raw as ProviderId)) {
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
        : config.allowOpenBot
          ? "⚠️ abierto a cualquier chat (ALLOW_OPEN_BOT=true)"
          : "🔒 cerrado: define ALLOWED_CHAT_IDS";
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

    // Sin IA no se adivina la intención: un "hola" no debe costar créditos
    if (!aiAvailable()) {
      await ctx.reply(
        "La IA está desactivada, así que no interpreto texto libre. Usa <code>/buscar dentistas en Santo Domingo</code> o <code>/ayuda</code>.",
        HTML
      );
      return;
    }

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
        const dir = result.directory ? " · 📁 directorio" : "";
        const sweep = result.scope === "province";
        const zone = sweep ? " · 🗺 provincia" : "";
        await ctx.api.editMessageText(
          ctx.chat.id,
          status.message_id,
          `🧠 <b>${esc(result.params.query)}</b> · ${result.params.gl.toUpperCase()}${active}${dir}${zone}`,
          HTML
        );
        pushHistory(
          ctx.chat.id,
          text,
          `Búsqueda ejecutada: "${result.params.query}" (${result.params.gl.toUpperCase()})${result.directory ? " · formato directorio" : ""}${sweep ? " · barrido de provincia" : ""}`
        );
        await runSearch(ctx, result.params, result.filters, status.message_id, result.directory === true, sweep);
        return;
      }

      // La IA no pudo interpretarlo: se pide un comando explícito en vez de gastar una búsqueda
      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        "No pude interpretar eso como una búsqueda. Prueba con <code>/buscar &lt;negocio&gt; en &lt;ciudad&gt;</code>.",
        HTML
      );
    } catch (error: any) {
      await ctx.api
        .editMessageText(
          ctx.chat.id,
          status.message_id,
          `⚠️ IA: ${esc(error?.message || error)}.\nUsa <code>/buscar &lt;negocio&gt; en &lt;ciudad&gt;</code> para buscar sin IA.`,
          HTML
        )
        .catch(() => {});
    }
  });

  // Botones
  bot.callbackQuery("csv", (ctx) => sendExport(ctx, "csv"));
  bot.callbackQuery("json", (ctx) => sendExport(ctx, "json"));
  bot.callbackQuery("dir", (ctx) => sendExport(ctx, "directory"));
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
    if (ctx.chat && getSession(ctx.chat.id)?.busy) {
      await ctx.answerCallbackQuery({ text: "Espera a que termine la búsqueda actual…" });
      return;
    }
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
