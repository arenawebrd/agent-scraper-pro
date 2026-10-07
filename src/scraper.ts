import { config } from "./config";
import { ALL, resolveCandidates } from "./providers";
import type { Business, PageToken, ProviderId, SearchParams, SearchPage } from "./types";

// Fachada: elige proveedor, hace fallback en la primera página y deduplica.
// El detalle de cada fuente vive en src/providers/*.

// Página ya resuelta: además del contenido lleva qué proveedor la sirvió y cuánto costó
export interface ResolvedPage extends SearchPage {
  provider: Exclude<ProviderId, "auto">;
  costUsd?: number;
}

// Identidad de un resultado para no repetir negocios entre páginas
export function resultKey(b: Business): string {
  if (b.place_id) return `p:${b.place_id}`;
  const cid = b.cid || b.data_cid;
  if (cid) return `c:${cid}`;
  if (b.data_id) return `d:${b.data_id}`;
  return `t:${String(b.title || "").toLowerCase().trim()}|${String(b.address || "").toLowerCase().trim()}`;
}

// Estado de cada fuente (para /proveedor y /ajustes)
export function providerStatus(): { id: Exclude<ProviderId, "auto">; label: string; available: boolean }[] {
  return ALL.map((p) => ({ id: p.id, label: p.label, available: p.available() }));
}

// Orden que seguiría el modo "auto" ahora mismo
export function autoOrder(): Exclude<ProviderId, "auto">[] {
  const real = providerStatus().filter((s) => s.id !== "mock" && s.available).map((s) => s.id);
  return real.length ? real : ["mock"];
}

function isFirstToken(token: PageToken | undefined): boolean {
  return token === undefined || token === 0 || token === "0";
}

export interface SearchPageOptions {
  // Preferencia del chat/.env ("auto" deja elegir al bot). En páginas >1 debe ser el proveedor ya fijado.
  provider?: ProviderId;
  // Primera página → se permite fallback entre proveedores (un cursor no vale en otro)
  first?: boolean;
}

// Búsqueda de una página. En modo "auto" prueba AnyAPI y, si falla o no da nada, SerpAPI.
export async function searchPage(
  params: SearchParams,
  token: PageToken = 0,
  opts: SearchPageOptions = {}
): Promise<ResolvedPage> {
  const first = opts.first ?? isFirstToken(token);
  const preferred = opts.provider ?? config.provider;
  const candidates = resolveCandidates(preferred, first, token);
  if (candidates.length === 0) {
    throw new Error("No hay ningún proveedor de mapas disponible (revisa SERPAPI_KEY, ANYAPI_KEY y MAPS_PROVIDER)");
  }

  const failures: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    const isLast = i === candidates.length - 1;
    try {
      const page = await provider.search(params, token);
      // Primera página sin nada → el siguiente candidato puede sí buscarlo
      if (first && page.results.length === 0 && !isLast) {
        failures.push(`${provider.label}: 0 resultados`);
        console.warn(`[scraper] ${provider.label} no encontró nada → pruebo con ${candidates[i + 1].label}`);
        continue;
      }
      return { ...page, provider: provider.id };
    } catch (error: any) {
      const raw = error?.message || String(error);
      // El proveedor ya suele firmar su mensaje ("SerpAPI: …") → evitamos duplicarlo
      const msg =
        raw.startsWith(`${provider.label}:`) || raw.startsWith(`${provider.label} `)
          ? raw.slice(provider.label.length).replace(/^[: ]+/, "")
          : raw;
      failures.push(`${provider.label}: ${msg}`);
      console.warn(`[scraper] ${provider.label} falló (${first ? "fallback posible" : "sin fallback"}): ${msg}`);
      if (!first || isLast) break;
    }
  }
  throw new Error(failures.join(" · ") || "Ningún proveedor devolvió resultados");
}

// Seguridad: nunca más de 30 páginas (600 resultados) seguidas
const MAX_PAGES = 30;

function advanceToken(token: PageToken, count: number): PageToken {
  if (typeof token === "number") return token + count;
  return token;
}

// Búsqueda con varias páginas: params.max = 0 → todas las disponibles
// Fija el proveedor en la primera página y acumula su coste.
export async function searchAll(
  params: SearchParams,
  onPage?: (collected: number) => void,
  preferred?: ProviderId
): Promise<ResolvedPage> {
  const collected: Business[] = [];
  const seen = new Set<string>();
  let token: PageToken = 0;
  let provider: ProviderId | undefined;
  let costUsd = 0;
  let hasMore = true;
  let pages = 0;

  while (hasMore && (params.max <= 0 || collected.length < params.max)) {
    if (++pages > MAX_PAGES) {
      hasMore = false;
      break;
    }
    const page = await searchPage(params, token, { provider: provider ?? preferred, first: !provider });
    provider = page.provider;
    costUsd += page.costUsd ?? 0;

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
    token = page.nextToken ?? advanceToken(token, page.results.length);
    hasMore = page.hasMore;
    // Await: serializa los avisos de progreso con la edición final (evita pisarse)
    await Promise.resolve(onPage?.(collected.length));
    // Página entera de repetidos → el proveedor ya no tiene más de esta zona
    if (added === 0) {
      hasMore = false;
      break;
    }
  }

  const results = params.max > 0 ? collected.slice(0, params.max) : collected;
  const fixed: Exclude<ProviderId, "auto"> = provider && provider !== "auto" ? provider : "mock";
  return {
    results,
    hasMore: hasMore && (params.max <= 0 || collected.length < params.max),
    nextToken: token,
    provider: fixed,
    costUsd,
  };
}
