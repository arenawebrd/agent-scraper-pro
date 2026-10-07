import { getJson } from "serpapi";
import { config } from "../config";
import type { PageToken, SearchParams } from "../types";
import type { MapsProvider, ProviderPage } from "./types";
import { enrichWithMapbox, extractCidFromDataId, normalizeBusiness, withTimeout } from "./shared";

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

function validateLl(ll?: string): string | undefined {
  if (!ll) return undefined;
  const parts = ll.replace(/^@/, "").split(",");
  const lat = parseFloat(parts[0] || "");
  const lng = parseFloat(parts[1] || "");
  if (isNaN(lat) || Math.abs(lat) > 90 || Math.abs(lng || 0) > 180) return undefined;
  const zoom = parts[2] ? (parts[2].endsWith("z") ? parts[2] : `${parts[2]}z`) : "16z";
  return `@${lat},${lng},${zoom}`;
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

// Coste por negocio = 1 crédito extra → lo dejamos apagado con ENRICH_DETAILS=false
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

// server.ts:795-919 (GET /api/search) — búsqueda de una página
async function search(params: SearchParams, token: PageToken): Promise<ProviderPage> {
  const { query, gl, hl, max } = params;
  const start = typeof token === "number" ? token : parseInt(String(token), 10) || 0;
  const ll = validateLl(params.ll);
  const apiKey = config.serpapiKey;
  if (!apiKey) throw new Error("SerpAPI: falta SERPAPI_KEY en .env");

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

  let responseData: any;
  try {
    responseData = await withTimeout(getJson(searchParams), 45000, "SerpAPI search");
  } catch (error: any) {
    throw new Error(`SerpAPI: ${error?.message || error}`);
  }

  const localResults: any[] = responseData.local_results || [];
  // Recortamos ANTES de enriquecer: solo se paga SerpAPI por lo que se usa
  // max = 0 → sin límite, se queda la página entera
  const limit = max > 0 ? Math.max(0, max - start) : Number.POSITIVE_INFINITY;
  const kept = localResults.slice(0, limit);

  if (kept.length > 0) {
    await enrichMissingDetails(kept, gl, hl);
  }

  const enriched = await Promise.all(kept.map((b) => enrichWithMapbox(b)));
  const results = enriched.map((b) => normalizeBusiness(b, gl, hl));

  return {
    results,
    hasMore: !!responseData.serpapi_pagination?.next && (max <= 0 || start + results.length < max),
    nextToken: start + localResults.length,
    // SerpAPI no expone coste en USD: 1 crédito por página (los fallidos no se cobran)
  };
}

export const serpapiProvider: MapsProvider = {
  id: "serpapi",
  label: "SerpAPI",
  available: () => !!config.serpapiKey,
  search,
};
