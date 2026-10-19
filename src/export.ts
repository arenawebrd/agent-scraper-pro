import { formatAddress } from "./address";
import { nativeUrls } from "./providers/shared";
import type { Business } from "./types";

// ── CSV propio (sin dependencias) ───────────────────────────
// Antes usábamos la librería `xlsx` solo para volcar objetos a CSV;
// arrastraba 2 CVE sin fix y no se usaba para leer nada.
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  // Comillas solo cuando hacen falta (coma, comilla o salto de línea)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Cabecera: las columnas del `header` si se da; si no, la unión de claves
// de todas las filas en orden de aparición (como hacía json_to_sheet).
function collectColumns(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}

export function toCSV(rows: Record<string, unknown>[], header?: string[]): string {
  const cols = header ?? collectColumns(rows);
  const lines = [cols.map(csvCell).join(",")];
  for (const row of rows) lines.push(cols.map((col) => csvCell(row[col])).join(","));
  return lines.join("\n");
}

// `extensions` viene como [{service_options:[...]}, {highlights:[...]}, ...]
// y varía según el tipo de negocio → generamos una columna por cada grupo.
function collectExtensionKeys(data: any[]): string[] {
  const keys = new Set<string>();
  for (const item of data) {
    if (Array.isArray(item.extensions)) {
      for (const e of item.extensions) {
        if (e && typeof e === "object") Object.keys(e).forEach((k) => keys.add(k));
      }
    }
  }
  return [...keys].sort();
}

function extensionValue(item: any, key: string): string {
  if (!Array.isArray(item.extensions)) return "";
  const values: string[] = [];
  for (const e of item.extensions) {
    if (e && typeof e === "object" && Array.isArray(e[key])) {
      values.push(...e[key].map((v: any) => String(v)));
    } else if (e && typeof e === "object" && typeof e[key] === "string") {
      values.push(e[key]);
    }
  }
  return values.join(", ");
}

// Port exacto de Prospect Hub src/utils/export.ts:5-32 (mismas columnas)
// + extensiones/amenities/service_options del negocio (típico por rubro)
export function prepareDataForExport(data: any[], gl?: string, hl?: string): any[] {
  const extKeys = collectExtensionKeys(data);
  return data.map((item, index) => {
    const processed: any = {};
    processed.position = item.position || index + 1;
    processed.title = typeof item.title === "object" ? JSON.stringify(item.title) : item.title || "";
    processed.description = typeof item.description === "object" ? JSON.stringify(item.description) : item.description || "";
    processed.types = Array.isArray(item.types)
      ? item.types.map((t: any) => (typeof t === "object" ? JSON.stringify(t) : String(t))).join(", ")
      : item.types || item.type || "";
    processed.address = formatAddress(item, gl);
    // Se conserva el texto original del proveedor por si hace falta depurar
    processed.address_raw = typeof item.address === "object" ? JSON.stringify(item.address) : item.address || "";
    processed.street = typeof item.street === "object" ? JSON.stringify(item.street) : item.street || "";
    processed.postal_code = typeof item.postal_code === "object" ? JSON.stringify(item.postal_code) : item.postal_code || "";
    processed.locality = typeof item.locality === "object" ? JSON.stringify(item.locality) : item.locality || "";
    processed.province = typeof item.province === "object" ? JSON.stringify(item.province) : item.province || "";
    processed.country = typeof item.country === "object" ? JSON.stringify(item.country) : item.country || "";
    processed.latitude = item.gps_coordinates?.latitude || "";
    processed.longitude = item.gps_coordinates?.longitude || "";
    processed.phone = typeof item.phone === "object" ? JSON.stringify(item.phone) : item.phone || "";
    processed.website = typeof item.website === "object"
      ? item.website?.url || JSON.stringify(item.website)
      : item.website || "";
    processed.rating = typeof item.rating === "object" ? JSON.stringify(item.rating) : item.rating ?? "";
    processed.reviews = typeof item.reviews === "object" ? JSON.stringify(item.reviews) : item.reviews ?? "";
    processed.price = typeof item.price === "object" ? JSON.stringify(item.price) : item.price || "";
    processed.extracted_price = item.extracted_price ?? "";
    processed.data_id = typeof item.data_id === "object" ? JSON.stringify(item.data_id) : item.data_id || "";
    processed.place_id = typeof item.place_id === "object" ? JSON.stringify(item.place_id) : item.place_id || "";
    const urls = nativeUrls(item, gl, hl);
    processed.map_url = typeof urls.map_url === "object" ? JSON.stringify(urls.map_url) : urls.map_url || "";
    processed.review_url = typeof urls.review_url === "object" ? JSON.stringify(urls.review_url) : urls.review_url || "";
    processed.thumbnail = typeof item.thumbnail === "object" ? JSON.stringify(item.thumbnail) : item.thumbnail || "";
    processed.opening_hours = item.opening_hours ? JSON.stringify(item.opening_hours) : "";
    processed.open_state = item.open_state || "";
    processed.check_in_time = item.check_in_time || "";
    processed.check_out_time = item.check_out_time || "";

    // Columnas dinámicas por rubro: ext_service_options, ext_highlights, ext_offerings…
    for (const key of extKeys) {
      processed[`ext_${key}`] = extensionValue(item, key);
    }
    processed.amenities = Array.isArray(item.amenities)
      ? item.amenities.join(", ")
      : typeof item.amenities === "object" && item.amenities
        ? JSON.stringify(item.amenities)
        : item.amenities || "";
    processed.service_options = item.service_options ? JSON.stringify(item.service_options) : "";

    processed.scrapedAt = item.scrapedAt ? new Date(item.scrapedAt).toISOString() : "";
    return processed;
  });
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function exportFilename(ext: "csv" | "json"): string {
  return `leads_${timestamp()}.${ext}`;
}

export function buildCSV(data: Business[], gl?: string, hl?: string): Buffer {
  const prepared = prepareDataForExport(data, gl, hl);
  // BOM UTF-8 para que Excel abra acentos correctamente
  return Buffer.from("\uFEFF" + toCSV(prepared), "utf-8");
}

export function buildJSON(data: Business[], gl?: string, hl?: string): Buffer {
  const prepared = prepareDataForExport(data, gl, hl);
  return Buffer.from(JSON.stringify(prepared, null, 2), "utf-8");
}
