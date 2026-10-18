import { InlineKeyboard } from "grammy";
import { config } from "./config";
import { activeFilterLabels, applyFilters } from "./filters";
import type { Filters, SearchSession } from "./types";

// ── Utilidades de formato ───────────────────────────────────
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// ── Preview de resultados ───────────────────────────────────
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
    return `${head.join("\n")}\n\nNingún resultado cumple los filtros. Desactívalos en 🔍 Filtros.`;
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

// ── Teclados ────────────────────────────────────────────────
export function mainKeyboard(_session: SearchSession): InlineKeyboard {
  return new InlineKeyboard()
    .text("📄 CSV", "csv")
    .text("🧾 JSON", "json")
    .text("📁 Directorio", "dir")
    .row()
    .text("➕ Cargar más", "more")
    .text("🔍 Filtros", "filters")
    .row()
    .text("🔄 Nueva búsqueda", "reset");
}

export function filtersKeyboard(f: Filters): InlineKeyboard {
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

export const FILTER_KEYS: (keyof Filters)[] = ["sinWeb", "sinTelefono", "ratingBajo", "pocasReviews", "sinFotos"];
