import { getJson } from "serpapi";
import { config } from "./config";
import type { Business, SearchPage, SearchParams } from "./types";

// ── Puerto fiel de Prospect Hub ─────────────────────────────
// server.ts:1420-1430 (getGoogleDomain)
export function getGoogleDomain(gl: string): string {
  const comTldCountries = ["do", "ar", "au", "br", "cl", "co", "cr", "gt", "hn",
    "jp", "mx", "ni", "pa", "pe", "pr", "py", "sv", "uy", "ve"];
  const singleTldCountries = ["es", "fr", "de", "it", "ru", "nl", "pl", "pt", "uk", "in", "ca"];

  if (comTldCountries.includes(gl)) return `google.com.${gl}`;
  if (singleTldCountries.includes(gl)) return `google.${gl}`;
  return "google.com";
}

// server.ts:326-384 (transformHours)
function transformHours(serpHours: any): Record<string, any> | undefined {
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

// server.ts:386-486 (enrichWithMapbox) — sin logs verbosos
async function enrichWithMapbox(business: any): Promise<any> {
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

  const token = config.mapboxToken;
  if (!token) return enriched;

  let query = "";
  const gps = business.gps_coordinates || business.coordinates || business.latLng;
  if (gps) {
    const lat = gps.latitude ?? gps.lat;
    const lng = gps.longitude ?? gps.lng;
    if (lat && lng) query = `${lng},${lat}`;
  }
  if (!query && business.address) query = encodeURIComponent(business.address);
  if (!query) return enriched;

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&limit=1&types=address`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return enriched;

    const data: any = await response.json();
    const feature = data.features?.[0];
    if (!feature) return enriched;

    const context = feature.context || [];
    const street = feature.text || "";
    const addressNumber = feature.address || "";
    const fullStreet = addressNumber ? `${street} ${addressNumber}`.trim() : street;

    const getContextText = (patterns: string[]) => {
      for (const pattern of patterns) {
        const found = context.find((c: any) => c.id.includes(pattern));
        if (found) return found.text;
      }
      return "";
    };

    return {
      ...enriched,
      street: fullStreet,
      postal_code: getContextText(["postcode", "zip"]),
      locality: getContextText(["place", "locality", "city"]),
      province: getContextText(["region", "province", "state"]),
      country: getContextText(["country"]),
    };
  } catch {
    return enriched;
  }
}

// src/services/api.ts:3-14 (extractCidFromDataId)
function extractCidFromDataId(dataId: string): string | null {
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

// src/services/api.ts:48-90 (normalización de cada resultado)
function normalizeBusiness(raw: any, gl: string, hl: string): Business {
  const {
    place_id_search,
    serpapi_thumbnail,
    reviews_link,
    photos_link,
    photos,
    ...rest
  } = raw;

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

// Nunca dejar colgada una llamada de red
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
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

// server.ts:853-906 — detalle de los que faltan web/teléfono, chunks de 5, timeout 15s
// Nota: SerpAPI ya no acepta `data_id` en type=place → usamos data_cid (o place_id)
// + alojamientos (hoteles): el detalle trae check_in_time / check_out_time
function isLodging(biz: any): boolean {
  const hay = [biz.title, biz.type, ...(Array.isArray(biz.types) ? biz.types : [])]
    .flat()
    .filter(Boolean)
    .join(" ");
  return /hotel|motel|hostal|hostel|resort|posada|aparthotel|lodge|parador|guest\s?house|pensión|\binn\b/i.test(hay);
}

async function enrichMissingDetails(results: any[], gl: string, hl: string): Promise<void> {
  if (!config.enrichDetails) return;
  const apiKey = config.serpapiKey;
  const needsEnrichment = results.filter(
    (b) => !b.website || !b.phone || b.website === "" || b.phone === "" || isLodging(b)
  );
  if (needsEnrichment.length === 0) return;
  console.log(`[scraper] detalle de ${needsEnrichment.length}/${results.length} negocios (faltan contacto o son alojamientos)`);

  const CHUNK_SIZE = 5;
  for (let i = 0; i < needsEnrichment.length; i += CHUNK_SIZE) {
    const chunk = needsEnrichment.slice(i, i + CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (biz: any) => {
        try {
          const cid = extractCidFromDataId(biz.data_id);
          const base: any = {
            engine: "google_maps",
            type: "place",
            api_key: apiKey,
            hl,
            gl,
          };
          if (cid) base.data_cid = cid;
          else if (biz.place_id) base.place_id = biz.place_id;
          else return; // sin identificador no se puede pedir el detalle

          const detail = await withTimeout(getJson(base), 15000, "SerpAPI place");
          const pr = (detail as any).place_results;
          if (pr) {
            if (!biz.website && pr.website) biz.website = pr.website;
            if (!biz.phone && pr.phone) biz.phone = pr.phone;
            if (!biz.map_url && pr.map_url) biz.map_url = pr.map_url;
            if (!biz.review_url && pr.reviews_link) biz.review_url = pr.reviews_link;
            if (!biz.thumbnail && pr.thumbnail) biz.thumbnail = pr.thumbnail;
            if (!biz.rating && pr.rating) biz.rating = pr.rating;
            if (!biz.reviews && pr.reviews) biz.reviews = pr.reviews;
            if (!biz.type && (pr.type || pr.category)) biz.type = pr.type || pr.category;
            if (!biz.hours && pr.hours) biz.hours = pr.hours;
            if (!biz.description && pr.description) biz.description = pr.description;
            // Alojamientos: horarios de check-in/out y precios del detalle
            if (pr.check_in_time) biz.check_in_time = pr.check_in_time;
            if (pr.check_out_time) biz.check_out_time = pr.check_out_time;
            if (!biz.pricing && pr.pricing) biz.pricing = pr.pricing;
            // Amenidades del detalle suelen ser más completas → unión
            if (Array.isArray(pr.amenities) && pr.amenities.length) {
              const merged = Array.isArray(biz.amenities) ? [...biz.amenities] : [];
              for (const a of pr.amenities) if (!merged.includes(a)) merged.push(a);
              biz.amenities = merged;
            }
          }
        } catch (err: any) {
          const msg = typeof err === "string" ? err.slice(0, 120) : err?.message || "error desconocido";
          console.warn(`[scraper] enrichment falló data_id=${biz.data_id}: ${msg}`);
        }
      })
    );
  }
}

// server.ts:1432-1541 (getMockData) — para probar sin gastar cuota
function getMockData(q: string, start: number) {
  const allMocks = [
    { title: "Elite Roofing Solutions", address: "123 Main St, Austin, TX 78701", phone: "(512) 555-0123", website: "https://eliteroofing.com", rating: 4.2, reviews: 45, data_id: "mock_1", gps_coordinates: { latitude: 30.2672, longitude: -97.7431 }, operating_hours: { monday: "Open 24 hours", tuesday: "Open 24 hours", wednesday: "Open 24 hours", thursday: "Open 24 hours", friday: "Open 24 hours", saturday: "Open 24 hours", sunday: "Open 24 hours" } },
    { title: "Joe's Plumbing & Drain", address: "456 Oak Ave, Austin, TX 78704", phone: "(512) 555-4567", rating: 3.8, reviews: 12, data_id: "mock_2", gps_coordinates: { latitude: 30.2472, longitude: -97.7531 }, operating_hours: { monday: "8:00 AM – 6:00 PM", tuesday: "8:00 AM – 6:00 PM", wednesday: "8:00 AM – 6:00 PM", thursday: "8:00 AM – 6:00 PM", friday: "8:00 AM – 6:00 PM", saturday: "Closed", sunday: "Closed" } },
    { title: "Sunshine Dental Care", address: "789 Pine Rd, Austin, TX 78745", phone: "(512) 555-7890", website: "https://facebook.com/sunshinedental", rating: 4.9, reviews: 210, data_id: "mock_3", gps_coordinates: { latitude: 30.2172, longitude: -97.7731 }, operating_hours: { monday: "9:00 AM – 5:00 PM", tuesday: "9:00 AM – 5:00 PM", wednesday: "9:00 AM – 5:00 PM", thursday: "9:00 AM – 5:00 PM", friday: "9:00 AM – 5:00 PM", saturday: "10:00 AM – 2:00 PM", sunday: "Closed" } },
    { title: "Austin Auto Repair", address: "101 Speed Way, Austin, TX 78751", phone: "(512) 555-1010", rating: 2.5, reviews: 8, data_id: "mock_4", gps_coordinates: { latitude: 30.3072, longitude: -97.7131 } },
    { title: "Green Leaf Landscaping", address: "202 Garden Ln, Austin, TX 78702", website: "https://greenleaf.com", rating: 4.5, reviews: 88, data_id: "mock_5", gps_coordinates: { latitude: 30.2572, longitude: -97.7231 } },
    { title: "Austin Tech Support", address: "505 Innovation Blvd, Austin, TX 78701", phone: "(512) 555-9999", rating: 4.7, reviews: 34, data_id: "mock_6", gps_coordinates: { latitude: 30.2772, longitude: -97.7331 } },
    { title: "Lone Star Cafe", address: "303 Congress Ave, Austin, TX 78701", phone: "(512) 555-3333", rating: 4.1, reviews: 120, data_id: "mock_7", gps_coordinates: { latitude: 30.2632, longitude: -97.7441 } },
  ];

  const pageSize = 5;
  const results = allMocks.slice(start, start + pageSize);

  return {
    local_results: results,
    serpapi_pagination:
      start + pageSize < allMocks.length ? { next: "next_url", next_page_token: "token" } : undefined,
    search_metadata: { status: "Success", id: "mock_search" },
    mock_query: q,
  };
}

function validateLl(ll?: string): string | undefined {
  if (!ll) return undefined;
  const parts = ll.replace(/^@/, "").split(",");
  const lat = parseFloat(parts[0] || "");
  const lng = parseFloat(parts[1] || "");
  if (isNaN(lat) || Math.abs(lat) > 90 || Math.abs(lng || 0) > 180) return undefined;
  const zoom = parts[2] ? (parts[2].endsWith("z") ? parts[2] : `${parts[2]}z`) : "16z";
  return `@${lat},${lng},${zoom}`;
}

// server.ts:795-919 (GET /api/search) — búsqueda de una página
export async function searchPage(params: SearchParams, start: number): Promise<SearchPage> {
  const { query, gl, hl, max } = params;
  const ll = validateLl(params.ll);
  const apiKey = config.serpapiKey;
  const useMock = !apiKey;

  let responseData: any;
  if (useMock) {
    console.log(`[scraper] MOCK q="${query}" start=${start}`);
    responseData = getMockData(query, start);
  } else {
    const searchParams: any = {
      engine: "google_maps",
      q: query,
      api_key: apiKey,
      type: "search",
      start,
      gl,
      hl,
      google_domain: getGoogleDomain(gl),
    };
    if (ll) searchParams.ll = ll;

    try {
      responseData = await withTimeout(getJson(searchParams), 45000, "SerpAPI search");
    } catch (error: any) {
      throw new Error(`SerpAPI: ${error?.message || error}`);
    }
  }

  const localResults: any[] = responseData.local_results || [];
  // Recortamos ANTES de enriquecer: solo se paga SerpAPI por lo que se usa
  // max = 0 → sin límite, se queda la página entera
  const limit = max > 0 ? Math.max(0, max - start) : Number.POSITIVE_INFINITY;
  const kept = localResults.slice(0, limit);

  if (kept.length > 0 && !useMock) {
    await enrichMissingDetails(kept, gl, hl);
  }

  const enriched = await Promise.all(kept.map((b) => enrichWithMapbox(b)));
  const results = enriched.map((b) => normalizeBusiness(b, gl, hl));

  return {
    results,
    hasMore: !!responseData.serpapi_pagination?.next && (max <= 0 || start + results.length < max),
    nextStart: start + localResults.length,
  };
}

// Identidad de un resultado para no repetir negocios entre páginas
export function resultKey(b: Business): string {
  if (b.place_id) return `p:${b.place_id}`;
  const cid = b.cid || b.data_cid;
  if (cid) return `c:${cid}`;
  if (b.data_id) return `d:${b.data_id}`;
  return `t:${String(b.title || "").toLowerCase().trim()}|${String(b.address || "").toLowerCase().trim()}`;
}

// Seguridad: nunca más de 30 páginas (600 resultados) seguidas
const MAX_PAGES = 30;

// Búsqueda con varias páginas: params.max = 0 → todas las disponibles
export async function searchAll(
  params: SearchParams,
  onPage?: (collected: number) => void
): Promise<SearchPage> {
  const collected: Business[] = [];
  let start = 0;
  let hasMore = true;
  let pages = 0;
  const seen = new Set<string>();

  while (hasMore && (params.max <= 0 || collected.length < params.max)) {
    if (++pages > MAX_PAGES) {
      hasMore = false;
      break;
    }
    const page = await searchPage(params, start);
    if (page.results.length === 0) {
      hasMore = false;
      break;
    }

    let added = 0;
    for (const r of page.results) {
      const key = resultKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(r);
      added++;
    }
    start += page.results.length;
    hasMore = page.hasMore;
    // Await: serializa los avisos de progreso con la edición final (evita pisarse)
    await Promise.resolve(onPage?.(collected.length));
    // Página entera de repetidos → Google ya no tiene más de esta zona
    if (added === 0) {
      hasMore = false;
      break;
    }
  }

  const results = params.max > 0 ? collected.slice(0, params.max) : collected;
  return {
    results,
    hasMore: hasMore && (params.max <= 0 || collected.length < params.max),
    nextStart: start,
  };
}
