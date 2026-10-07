import { config } from "../config";
import type { Business, PageToken, SearchParams } from "../types";
import type { MapsProvider, ProviderPage } from "./types";
import { enrichLocality, formatTitle } from "./shared";

// ── AnyAPI (getanyapi.com) ──────────────────────────────────
// POST https://api.getanyapi.com/v1/run/<sku>  ·  Authorization: Bearer <key>
//   maps.search_nearby → $0.0013/llamada · máx 20 items · SÍ pagina (nextCursor)
//   maps.search        → $0.00175/llamada · máx 20 items · NO pagina (require location)
// Geocodificación: Nominatim (gratis, 1 req/s).
// El token lleva dentro las coordenadas para no tener que geocodificar otra vez.

const API_BASE = "https://api.getanyapi.com/v1/run";
const PAGE_SIZE = 20;
const DEFAULT_ZOOM = 13; // radio de ciudad. También es el máx.: por encima (links pegados muy cercanos) solo caben unas manzanas
const TOKEN_PREFIX = "a1:";

interface AnyState {
  lat: number;
  lng: number;
  z: number;
  c?: string;
}

function encodeToken(state: AnyState): string {
  return TOKEN_PREFIX + Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeToken(token: PageToken): AnyState | null {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const state = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8"));
    if (typeof state?.lat === "number" && typeof state?.lng === "number") return state as AnyState;
  } catch {
    return null;
  }
  return null;
}

function parseLl(ll?: string): AnyState | null {
  if (!ll) return null;
  const parts = ll.replace(/^@/, "").split(",");
  const lat = parseFloat(parts[0] || "");
  const lng = parseFloat(parts[1] || "");
  if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  let z = DEFAULT_ZOOM;
  if (parts[2]) {
    const zoom = parseFloat(parts[2].replace(/z$/i, ""));
    // Un link pegado con zoom de calle (17z) recortaría el radio a unas manzanas
    // → lo limitamos a nivel de ciudad para no perder resultados
    if (!isNaN(zoom) && zoom > 0) z = Math.min(zoom, DEFAULT_ZOOM);
  }
  return { lat, lng, z };
}

// Nominatim pide máximo 1 petición por segundo
let lastGeo = 0;
async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const gap = 1100 - (Date.now() - lastGeo);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastGeo = Date.now();
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": "agent-scraper-pro/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

// "cafeterías sin web en Madrid" → "Madrid" (solo si falla la query completa)
function locationTail(query: string): string | null {
  const m = query.trim().match(/\s+(?:en|in|near)\s+(.+)$/i);
  const tail = m?.[1]?.trim() || "";
  return tail.length >= 3 ? tail : null;
}

// Solo geocodificamos texto que de verdad nombra un sitio: `location`, una query
// con estructura "X en Y" o la cola "Y". Una query desnuda ("dentistas") no se
// geocodifica para no acabar buscando en un país aleatorio → en ese caso SerpAPI.
function geocodeCandidates(params: SearchParams): string[] {
  const out: string[] = [];
  const push = (v?: string) => {
    const s = (v || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  const query = (params.query || "").trim();
  push(params.location);
  if (/\s+(?:en|in|near)\s+/i.test(query)) push(query);
  push(locationTail(query) || undefined);
  return out;
}

async function run(sku: string, body: Record<string, unknown>): Promise<any> {
  const key = config.anyapiKey;
  if (!key) throw new Error("AnyAPI: falta ANYAPI_KEY en .env");

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${sku}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40000),
    });
  } catch (err: any) {
    throw new Error(`AnyAPI: ${err?.message || err}`);
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    // La entrada inválida no se cobra (costUsd ausente)
    const msg = json?.error || json?.message || text.slice(0, 180) || `HTTP ${res.status}`;
    throw new Error(`AnyAPI ${res.status}: ${String(msg).slice(0, 220)}`);
  }
  if (!json) throw new Error("AnyAPI: respuesta no válida");
  return json;
}

function mapHours(hours: any): Record<string, any> | undefined {
  if (!hours) return undefined;
  if (Array.isArray(hours)) {
    const out: Record<string, any> = {};
    for (const h of hours) {
      if (!h || typeof h !== "object") continue;
      const keys = Object.keys(h);
      const day = (h.day ?? h.name ?? keys[0]) as string | undefined;
      const value = h.hours ?? h.value ?? (keys.length ? h[keys[0]] : undefined);
      if (day && value !== undefined) out[String(day)] = value;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return typeof hours === "object" ? hours : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = parseFloat(v);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

// item → Business (mismas columnas que el resto de proveedores)
function mapItem(raw: any, gl: string, hl: string): Business | null {
  if (!raw || raw.permanentlyClosed === true) return null;
  const title = String(raw.name || "").trim();
  if (!title) return null;

  const cid = raw.cid ? String(raw.cid) : undefined;
  const placeId = raw.placeId ? String(raw.placeId) : undefined;
  const lat = num(raw.latitude);
  const lng = num(raw.longitude);
  const photo = typeof raw.image === "string" && raw.image ? raw.image : undefined;

  const b: Business = {
    title: formatTitle(title),
    address: raw.address || undefined,
    phone: raw.phone || undefined,
    website: raw.website || undefined,
    rating: num(raw.rating),
    reviews: num(raw.reviewCount),
    place_id: placeId,
    cid,
    data_cid: cid,
    data_id: placeId ? `place:${placeId}` : cid ? `cid:${cid}` : "",
    gps_coordinates: lat !== undefined && lng !== undefined ? { latitude: lat, longitude: lng } : undefined,
    thumbnail: photo,
    photos: photo ? [photo] : undefined,
    type: raw.category || undefined,
    types: Array.isArray(raw.categories) && raw.categories.length
      ? raw.categories
      : raw.category
        ? [raw.category]
        : undefined,
    opening_hours: mapHours(raw.hours),
    description: raw.description || undefined,
    street: raw.street || undefined,
    postal_code: raw.postalCode || undefined,
    locality: raw.city || undefined,
    province: raw.state || undefined,
    country: raw.countryCode || undefined,
    open_state: "",
    scrapedAt: new Date().toISOString(),
  };

  if (cid) {
    b.map_url = `https://www.google.com/maps?cid=${cid}&hl=${hl}&gl=${gl.toUpperCase()}`;
  } else if (raw.url) {
    b.map_url = raw.url;
  }
  if (placeId) {
    b.review_url = `https://search.google.com/local/writereview?placeid=${placeId}`;
  }
  if (raw.domain && !b.website) b.website = `https://${raw.domain}`;
  if (raw.neighborhood) b.neighborhood = raw.neighborhood;
  return b;
}

async function pageFrom(items: any[], state: AnyState, nextCursor: string | undefined, costUsd: unknown, gl: string, hl: string): Promise<ProviderPage> {
  const results = items.map((i) => mapItem(i, gl, hl)).filter((b): b is Business => !!b && !!b.title);
  // AnyAPI no trae provincia ni a veces el código postal → Mapbox lo completa
  await enrichLocality(results, hl);
  return {
    results,
    hasMore: !!nextCursor,
    nextToken: nextCursor ? encodeToken({ ...state, c: nextCursor }) : undefined,
    costUsd: typeof costUsd === "number" ? costUsd : undefined,
  };
}

async function nearby(params: SearchParams, state: AnyState): Promise<ProviderPage> {
  const body: Record<string, unknown> = {
    query: params.query,
    coordinates: { latitude: state.lat, longitude: state.lng },
    language: params.hl,
    zoom: state.z,
    limit: PAGE_SIZE,
  };
  if (state.c) body.cursor = state.c;

  const json = await run("maps.search_nearby", body);
  const data = json.output?.data || {};
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  const page = await pageFrom(items, state, typeof data.nextCursor === "string" ? data.nextCursor : undefined, json.costUsd, params.gl, params.hl);
  console.log(
    `[anyapi] nearby "${params.query}" z=${state.z}${state.c ? " (pág. siguiente)" : ""} → ${page.results.length} resultados · $${(page.costUsd ?? 0).toFixed(4)}`
  );
  return page;
}

// Sin coordenadas: búsqueda de texto, pero AnyAPI exige `location` y no pagina
async function textSearch(params: SearchParams): Promise<ProviderPage> {
  const location = (params.location || "").trim();
  if (!location) throw new Error("AnyAPI: no pude ubicar la búsqueda (sin coordenadas ni localización)");

  // "dentistas en Santo Domingo" @ "Santo Domingo" → query "dentistas"
  let query = params.query.trim();
  const parts = query.match(/^(.*?)\s+(?:en|in|near)\s+(.+)$/i);
  if (parts && parts[2].trim().toLowerCase() === location.toLowerCase() && parts[1].trim()) {
    query = parts[1].trim();
  }
  if (!query) query = location;

  const json = await run("maps.search", { query, location, language: params.hl, limit: PAGE_SIZE });
  const data = json.output?.data || {};
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  const page = await pageFrom(items, { lat: 0, lng: 0, z: DEFAULT_ZOOM }, undefined, json.costUsd, params.gl, params.hl);
  console.log(`[anyapi] texto "${query}" @ ${location} → ${page.results.length} resultados · $${(page.costUsd ?? 0).toFixed(4)} (sin paginación)`);
  return page;
}

async function search(params: SearchParams, token: PageToken): Promise<ProviderPage> {
  // Página 2+: el token trae las coordenadas, no hace falta geocodificar otra vez
  const state = decodeToken(token);
  if (state) return nearby(params, state);

  const fromLl = parseLl(params.ll);
  if (fromLl) return nearby(params, fromLl);

  for (const candidate of geocodeCandidates(params)) {
    const coords = await geocode(candidate);
    if (coords) {
      console.log(`[anyapi] geocodifiqué "${candidate}" → ${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`);
      return nearby(params, { ...coords, z: DEFAULT_ZOOM });
    }
  }
  return textSearch(params);
}

export const anyapiProvider: MapsProvider = {
  id: "anyapi",
  label: "AnyAPI",
  available: () => !!config.anyapiKey,
  search,
};
