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

// Título legible: "dental global" / "DENTAL GLOBAL" → "Dental Global".
// Respeta los que ya están bien escritos ("OdontoLeon", "GO Dental") y las
// siglas cortas ("UPA", "EEUU", "GO"): solo se reescribe si TODO va en mayúsculas.
export function formatTitle(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const letters = text.replace(/[^\p{L}]/gu, "");
  const source = letters.length >= 5 && letters === letters.toUpperCase() ? text.toLowerCase() : text;
  return source.replace(/\S+/g, (word) => {
    const m = word.match(/^([^\p{L}\p{N}]*)(\p{L}[\p{L}\p{N}’'-]*)(.*)$/u);
    if (!m) return word;
    return m[1] + m[2].charAt(0).toLocaleUpperCase() + m[2].slice(1) + m[3];
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
  if (cid) {
    rest.cid = cid;
    rest.map_url = `https://www.google.com/maps?cid=${cid}&hl=${hl}&gl=${gl.toUpperCase()}`;
  } else if (rest.place_id) {
    rest.map_url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rest.title || "")}&query_place_id=${rest.place_id}`;
  }

  if (rest.place_id) {
    rest.review_url = `https://search.google.com/local/writereview?placeid=${rest.place_id}`;
  }

  if (photos && Array.isArray(photos) && photos.length > 0) {
    rest.photos = photos.map((p: any) => p.photo_url_large || p.photo_url || p.url);
    rest.thumbnail = photos[0].photo_url_large || photos[0].photo_url || photos[0].url || serpapi_thumbnail;
  } else if (serpapi_thumbnail) {
    rest.thumbnail = serpapi_thumbnail;
  }

  rest.scrapedAt = rest.scrapedAt || new Date().toISOString();
  return rest as Business;
}
