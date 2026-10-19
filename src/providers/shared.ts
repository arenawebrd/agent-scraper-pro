import { config } from "../config";
import type { Business } from "../types";

// Nunca dejar colgada una llamada de red
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: sin respuesta en ${ms / 1000}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// src/services/api.ts:3-14 (extractCidFromDataId)
export function extractCidFromDataId(dataId: string): string | null {
  if (!dataId || typeof dataId !== "string") return null;
  const parts = dataId.split(":");
  if (parts.length < 2) return null;
  const hexCid = parts[1];
  if (!hexCid.startsWith("0x")) return null;
  try {
    return BigInt(hexCid).toString();
  } catch {
    return null;
  }
}

// server.ts:326-384 (transformHours)
export function transformHours(serpHours: any): Record<string, any> | undefined {
  if (!serpHours || typeof serpHours !== "object") return undefined;

  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const result: Record<string, any> = {};

  const parseTime = (timeStr: string) => {
    if (!timeStr) return null;
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) {
      const simpleMatch = timeStr.match(/(\d+)\s*(AM|PM)/i);
      if (simpleMatch) {
        let hours = parseInt(simpleMatch[1]);
        const ampm = simpleMatch[2].toUpperCase();
        if (ampm === "PM" && hours < 12) hours += 12;
        if (ampm === "AM" && hours === 12) hours = 0;
        return `${hours.toString().padStart(2, "0")}:00`;
      }
      return null;
    }
    let hours = parseInt(match[1]);
    const minutes = match[2];
    const ampm = match[3].toUpperCase();

    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;

    return `${hours.toString().padStart(2, "0")}:${minutes}`;
  };

  days.forEach((day) => {
    const value = serpHours[day] || serpHours[day.charAt(0).toUpperCase() + day.slice(1)];
    if (!value) {
      result[day] = "cerrado";
      return;
    }

    const text = String(value);
    if (text.toLowerCase().includes("closed") || text.toLowerCase().includes("cerrado")) {
      result[day] = "cerrado";
    } else if (text.toLowerCase().includes("24 hours") || text.toLowerCase().includes("24 horas")) {
      result[day] = { open: "00:00", close: "24:00" };
    } else {
      const parts = text.split(/[–-]/);
      if (parts.length === 2) {
        const open = parseTime(parts[0].trim());
        const close = parseTime(parts[1].trim());
        if (open && close) {
          result[day] = { open, close };
        } else {
          result[day] = text;
        }
      } else {
        result[day] = text;
      }
    }
  });

  return result;
}

// Normaliza horarios e identificadores del negocio SIN red (los proveedores
// traen los horarios como `hours`/`operating_hours` y el cid aparte).
// La localización la resuelve enrichLocality() una sola vez por negocio.
export function normalizeDetails(business: any): any {
  const { open_state, hours, operating_hours, cid, data_cid, ...rest } = business;

  const enriched: any = { ...rest };
  enriched.data_cid = data_cid || cid || "";
  enriched.open_state = open_state || "";

  if (operating_hours) {
    enriched.opening_hours = transformHours(operating_hours);
  } else if (hours) {
    const hoursObj: any = {};
    if (Array.isArray(hours)) {
      hours.forEach((h: any) => {
        const day = Object.keys(h)[0];
        if (day) hoursObj[day] = h[day];
      });
    }
    enriched.opening_hours = hoursObj;
  }

  return enriched;
}

// Artículos, preposiciones y abreviaturas que NO son siglas aunque vengan cortas
// y en mayúsculas: se normalizan a "Inicial + minúsculas" (EL → El, DR → Dr).
const NORMALIZE_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas",
  "de", "del", "al", "y", "e", "o", "u", "a", "en", "con", "sin", "por", "para",
  "dr", "dra", "sr", "sra", "av", "avda", "san", "santa", "santo", "don", "doña",
]);

// Siglas cortas (UPA, BBQ, GO) que se conservan tal cual en mayúsculas.
const ACRONYM_MAX = 3;
// Siglas conocidas de 4 letras que también se conservan (el resto de palabras
// de 4 letras en mayúsculas, como PINO o CASA, sí se normalizan).
const KNOWN_ACRONYMS = new Set(["eeuu", "uefa", "nasa", "fifa", "unesco"]);

function capitalize(lower: string): string {
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
}

// Título legible (Title Case): "dental global" / "DENTAL GLOBAL" → "Dental Global".
// - Cada palabra en "Inicial + minúsculas" (incluida la mezcla de mayúsculas:
//   "Supermercado LA SIRENA" → "Supermercado La Sirena").
// - Conserva las siglas cortas todo-mayúsculas ("UPA", "BBQ", "GO", "EEUU").
// - Respeta los nombres ya bien escritos ("OdontoLeon", "McDonald's", "eBay").
export function formatTitle(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/\S+/g, (word) => {
    const m = word.match(/^([^\p{L}\p{N}]*)(\p{L}[\p{L}\p{N}’'-]*)(.*)$/u);
    if (!m) return word; // sin letras (números, símbolos): sin cambios
    const [, prefix, core, suffix] = m;
    const lower = core.toLocaleLowerCase();
    const isAllCaps = core === core.toLocaleUpperCase();
    const isAllLower = core === lower;
    // 1) palabras comunes: siempre "Inicial + minúsculas"
    if (NORMALIZE_WORDS.has(lower)) return prefix + capitalize(lower) + suffix;
    // 2) siglas en mayúsculas: cortas (UPA, BBQ, GO) o conocidas (EEUU, NASA)
    if (isAllCaps && (core.length <= ACRONYM_MAX || KNOWN_ACRONYMS.has(lower))) return prefix + core + suffix;
    // 3) todo mayúsculas o todo minúsculas: se normaliza
    if (isAllCaps || isAllLower) return prefix + capitalize(lower) + suffix;
    // 4) mayúsculas/minúsculas mezcladas (OdontoLeon, McDonald's): se respeta
    return word;
  });
}

// ── Mapbox: localidad y código postal cuando el proveedor no los trae ──
// Reverse geocoding: 1 petición por negocio (gratis hasta 100k/mes).
function samePlace(a?: string, b?: string): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function needsLocality(b: any): boolean {
  return (
    !b.street ||
    !b.locality ||
    !b.province ||
    !b.country ||
    samePlace(b.locality, b.province) ||
    !b.postal_code
  );
}

// UNA sola llamada a Mapbox por negocio: reverse geocoding por coordenadas.
// Rellena calle, localidad, provincia, cód. postal y país, solo lo que falte.
async function reverseLocality(b: any, token: string, language?: string): Promise<void> {
  const gps = b.gps_coordinates || b.coordinates || b.latLng;
  const lat = gps?.latitude ?? gps?.lat;
  const lng = gps?.longitude ?? gps?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return;

  try {
    const qs = new URLSearchParams({ access_token: token });
    if (language) qs.set("language", language);
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${qs.toString()}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return;
    const data: any = await res.json();
    const features: any[] = Array.isArray(data.features) ? data.features : [];
    const find = (prefix: string) =>
      features.find((f: any) => typeof f.id === "string" && f.id.startsWith(prefix));

    const address = find("address.");
    const region = find("region.");
    const place = find("place.") || find("locality.") || find("neighborhood.");
    const postcode = find("postcode.");
    const country = find("country.");

    if (!b.street && address) {
      const street = address.text || "";
      const number = address.address || "";
      b.street = number ? `${street} ${number}`.trim() : street;
    }
    if (!b.province && region) b.province = region.text;
    if ((!b.locality || samePlace(b.locality, b.province)) && place && !samePlace(place.text, b.province)) {
      b.locality = place.text;
    }
    // Mapbox no tiene código postal en todos los países (RD no) → solo se rellena si aparece
    if (!b.postal_code && postcode) b.postal_code = postcode.text;
    if (!b.country && country) b.country = country.text;
    // Último recurso: el barrio que ya trae AnyAPI
    if (
      (!b.locality || samePlace(b.locality, b.province)) &&
      b.neighborhood &&
      !samePlace(b.neighborhood, b.province)
    ) {
      b.locality = b.neighborhood;
    }
  } catch {
    // Sin conexión o timeout: la búsqueda sigue igual
  }
}

// Completa calle/localidad/provincia/código postal/país de la página con UNA
// llamada a Mapbox por negocio. Devuelve cuántos toques hizo.
// Corre en todos los proveedores (AnyAPI, SerpAPI y MOCK): lo que la fuente no trae, Mapbox lo completa.
export async function enrichLocality(results: Business[], language?: string): Promise<number> {
  if (results.length === 0) return 0;

  // CP escondido en la propia dirección ("residencial X, Las Terrenas 32000" → "32000")
  let filled = 0;
  for (const b of results) {
    if (b.postal_code) continue;
    const m = String(b.address || "").match(/(\d{4,6})\s*$/);
    if (m) {
      b.postal_code = m[1];
      filled++;
    }
  }

  const token = config.mapboxToken;
  if (!token) return filled;
  const targets = results.filter((b) => needsLocality(b));
  if (targets.length === 0) return filled;

  const CONCURRENCY = 6;
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const b = targets[next++];
      await reverseLocality(b, token, language);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));
  console.log(`[mapbox] dirección/localidad/código postal consultados para ${targets.length}/${results.length} negocios`);
  return filled + targets.length;
}

// ── URLs nativas de Google Maps ──────────────────────────────
// Se construyen aquí a partir del cid/place_id, sin depender del proveedor,
// para que el CSV de exportación nunca salga sin map_url/review_url.
export function nativeMapUrl(
  b: { cid?: string; data_cid?: string; place_id?: string; title?: string },
  gl?: string,
  hl?: string
): string {
  const cid = b.cid || b.data_cid;
  const glc = (gl || config.defaultGl).toUpperCase();
  const hlc = hl || config.defaultHl;
  if (cid) return `https://www.google.com/maps?cid=${cid}&hl=${hlc}&gl=${glc}`;
  if (b.place_id) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.title || "")}&query_place_id=${b.place_id}`;
  }
  return "";
}

export function nativeReviewUrl(b: { place_id?: string }): string {
  return b.place_id ? `https://search.google.com/local/writereview?placeid=${b.place_id}` : "";
}

// Completa map_url/review_url solo si faltan (no pisa lo que ya traiga el proveedor).
export function nativeUrls(b: Business, gl?: string, hl?: string): { map_url: string; review_url: string } {
  return {
    map_url: b.map_url || nativeMapUrl(b, gl, hl),
    review_url: b.review_url || nativeReviewUrl(b),
  };
}

// src/services/api.ts:48-90 (normalización de cada resultado)
export function normalizeBusiness(raw: any, gl: string, hl: string): Business {
  const {
    place_id_search,
    serpapi_thumbnail,
    reviews_link,
    photos_link,
    photos,
    ...rest
  } = raw;

  if (rest.title) rest.title = formatTitle(rest.title);

  if (rest.type && !rest.types) {
    rest.types = [rest.type];
  }

  const cid = rest.cid || extractCidFromDataId(rest.data_id);
  if (cid) rest.cid = cid;

  const mapUrl = nativeMapUrl(rest, gl, hl);
  if (mapUrl) rest.map_url = mapUrl;
  const reviewUrl = nativeReviewUrl(rest);
  if (reviewUrl) rest.review_url = reviewUrl;

  if (photos && Array.isArray(photos) && photos.length > 0) {
    rest.photos = photos.map((p: any) => p.photo_url_large || p.photo_url || p.url);
    rest.thumbnail = photos[0].photo_url_large || photos[0].photo_url || photos[0].url || serpapi_thumbnail;
  } else if (serpapi_thumbnail) {
    rest.thumbnail = serpapi_thumbnail;
  }

  rest.scrapedAt = rest.scrapedAt || new Date().toISOString();
  return rest as Business;
}
