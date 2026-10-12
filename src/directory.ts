import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import type { Business } from "./types";

// Mapeador Business → listings-data.csv de la plantilla business-directory-astro.
// Ojo: los nombres de columnas deben ser EXACTOS (process-listings las lee por nombre).

export const DIRECTORY_COLUMNS = [
  "id", "name", "slug", "legal_name", "place_id", "category", "categories", "tagline", "description",
  "is_verified", "is_sponsored", "rating_score", "rating_total_reviews", "phone", "phone_2", "whatsapp",
  "website", "email", "address", "street", "postal_code", "locality", "province", "country",
  "gps_coodenates", "latitude", "longitude", "data_id", "data_cid", "map_url", "review_url",
  "operating_hours", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "services", "payment_methods", "facebook", "instagram", "tiktok", "x_twitter", "linkedin", "youtube",
  "photo", "photo_gallery", "price_range", "faqs",
];

const DAY_COLUMNS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

// El proveedor puede devolver los días en inglés ("monday") o en español ("lunes")
const DAY_NAMES: Record<string, string[]> = {
  monday: ["monday", "lunes"],
  tuesday: ["tuesday", "martes"],
  wednesday: ["wednesday", "miercoles", "miércoles"],
  thursday: ["thursday", "jueves"],
  friday: ["friday", "viernes"],
  saturday: ["saturday", "sabado", "sábado"],
  sunday: ["sunday", "domingo"],
};

// Mismo criterio que SLUG_RE del directorio: ^[a-z0-9]+(?:-[a-z0-9]+)*$
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dayValue(hours: any, day: string): unknown {
  if (!hours || typeof hours !== "object") return undefined;
  const wanted = DAY_NAMES[day].map(normKey);
  for (const [k, v] of Object.entries(hours)) {
    if (wanted.includes(normKey(String(k)))) return v;
  }
  return undefined;
}

// "08:00–19:00" (objeto open/close), "Cerrado" o el texto tal cual:
// process-listings parsea el texto de cada día (24h con – o 12h con a. m./p. m.)
function dayText(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw === "string") {
    const t = raw.trim();
    return /cerrad|closed/i.test(t) ? "Cerrado" : t;
  }
  if (Array.isArray(raw)) {
    return raw.map(dayText).filter((s) => s && s !== "Cerrado").join(", ");
  }
  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.open && o.close) return `${o.open}–${o.close}`;
  }
  return String(raw);
}

// País legible. Orden: lo que traiga el proveedor → el `gl` de la búsqueda → vacío.
// (Antes caía siempre en "República Dominicana", aunque se buscara en otro país.)
function countryName(raw?: string, gl?: string): string {
  const t = (raw || "").trim() || (gl || "").trim();
  if (!t) return "";
  if (/^[A-Za-z]{2}$/.test(t)) {
    // En Google `gl=uk` es Reino Unido; el código ISO es GB
    const code = t.toUpperCase() === "UK" ? "GB" : t.toUpperCase();
    try {
      return new Intl.DisplayNames(["es"], { type: "region" }).of(code) || t;
    } catch {
      return t;
    }
  }
  return t;
}

function jsonIfArray(value: unknown): string {
  return Array.isArray(value) && value.length ? JSON.stringify(value) : "";
}

// Sufijo corto y determinista a partir del identificador estable del negocio
function idSuffix(b: Business, index: number): string {
  const key = b.place_id || b.data_cid || b.data_id || `${b.title}|${b.address}|${index}`;
  return createHash("sha1").update(String(key)).digest("hex").slice(0, 6);
}

// Slug estable entre refrescos:
//  - un título único → slug limpio ("farmacia-carol")
//  - un título repetido → TODOS los repetidos llevan sufijo derivado de su place_id/cid,
//    así no depende del orden en que lleguen los resultados
//  - un título sin letras latinas (slug vacío) → "negocio-<hash>"
export function toDirectoryRows(results: Business[], gl?: string): Record<string, string | number>[] {
  const bases = results.map((b, i) => slugify(b.title || ""));
  const counts = new Map<string, number>();
  for (const base of bases) if (base) counts.set(base, (counts.get(base) || 0) + 1);

  const usedSlugs = new Set<string>();
  const slugFor = (b: Business, i: number): string => {
    const base = bases[i];
    let candidate = !base ? `negocio-${idSuffix(b, i)}` : (counts.get(base) || 0) > 1 ? `${base}-${idSuffix(b, i)}` : base;
    // Colisión residual (mismo id repetido): contador, solo como último recurso
    const root = candidate;
    for (let n = 2; usedSlugs.has(candidate); n++) candidate = `${root}-${n}`;
    usedSlugs.add(candidate);
    return candidate;
  };

  return results.map((b, index) => {
    const lat = b.gps_coordinates?.latitude ?? "";
    const lng = b.gps_coordinates?.longitude ?? "";
    const types = Array.isArray(b.types) ? b.types.filter(Boolean).map(String) : [];
    const firstType = types[0] || (b.type ? String(b.type) : "");

    const row: Record<string, string | number> = {};
    // id estable entre refrescos: place_id > cid decimal > data_id (nunca el índice)
    row.id = b.place_id || b.data_cid || b.data_id || String(index + 1);
    row.name = b.title || "";
    row.slug = slugFor(b, index);
    row.legal_name = "";
    row.place_id = b.place_id || "";
    row.category = firstType;
    row.categories = types.length ? JSON.stringify(types) : "";
    row.tagline = "";
    row.description = b.description || "";
    row.is_verified = "";
    row.is_sponsored = "";
    row.rating_score = b.rating ?? "";
    row.rating_total_reviews = b.reviews ?? "";
    row.phone = b.phone || "";
    row.phone_2 = "";
    row.whatsapp = "";
    row.website = b.website || "";
    row.email = b.email || "";
    row.address = b.address || "";
    row.street = b.street || "";
    row.postal_code = b.postal_code || "";
    row.locality = b.locality || "";
    row.province = b.province || "";
    row.country = countryName(b.country, gl);
    row.gps_coodenates = lat !== "" && lng !== "" ? `${lat},${lng}` : "";
    row.latitude = lat;
    row.longitude = lng;
    row.data_id = b.data_id || "";
    row.data_cid = b.data_cid || "";
    row.map_url = b.map_url || "";
    row.review_url = b.review_url || "";
    row.operating_hours = b.opening_hours ? JSON.stringify(b.opening_hours) : "";
    for (const day of DAY_COLUMNS) {
      row[day] = dayText(dayValue(b.opening_hours, day));
    }
    row.services = "";
    row.payment_methods = "";
    row.facebook = "";
    row.instagram = "";
    row.tiktok = "";
    row.x_twitter = "";
    row.linkedin = "";
    row.youtube = "";
    row.photo = b.thumbnail || "";
    row.photo_gallery = jsonIfArray(b.photos);
    row.price_range = b.price || "";
    row.faqs = "";
    return row;
  });
}

// CSV con las columnas de la plantilla. SIN BOM: process-listings usa la
// primera columna ("id") como nombre y un BOM la rompería en silencio.
export function buildDirectoryCSV(results: Business[], gl?: string): Buffer {
  const rows = toDirectoryRows(results, gl);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: DIRECTORY_COLUMNS });
  return Buffer.from(XLSX.utils.sheet_to_csv(sheet), "utf-8");
}
