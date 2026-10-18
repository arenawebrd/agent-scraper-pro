import { config } from "./config";
import { countryLabel, geocodeArea, gridCells } from "./geo";
import { resultKey, searchAll, type ResolvedPage } from "./scraper";
import type { Business, ProviderId, SearchParams } from "./types";

// Barrido por provincia/región: geocodifica el área, la trocea en una rejilla de
// celdas y busca en cada una (una búsqueda por celda), uniendo y deduplicando.
// Es agnóstico del país y del proveedor (mismo `ll` para AnyAPI y SerpAPI).

const DEFAULT_RADIUS_KM = 6; // ≈ lo que cubre una búsqueda con zoom 13
const SWEEP_ZOOM = 13;

export interface SweepOptions {
  maxCells?: number;
  maxPerCell?: number;
  radiusKm?: number;
  // Progreso: celdas hechas, total y resultados acumulados
  onCell?: (done: number, total: number, found: number) => void;
}

export interface SweepResult extends ResolvedPage {
  cells: number;
  totalCells: number;
  capped: boolean;
  area?: string;
}

// Provincia/zona: `location` explícita o la cola "… en <área>" de la query
export function areaName(params: SearchParams): string | null {
  const loc = (params.location || "").trim();
  if (loc) return loc;
  const m = (params.query || "").match(/\s+(?:en|in|near)\s+(.+)$/i);
  const tail = m?.[1]?.trim() || "";
  return tail.length >= 3 ? tail : null;
}

// Geocodifica el área; primero con el país (para desambiguar) y si falla, sin él.
async function locateArea(name: string, gl?: string): Promise<ReturnType<typeof geocodeArea>> {
  const country = countryLabel(gl);
  if (country) {
    const hit = await geocodeArea(`${name}, ${country}`);
    if (hit?.bbox) return hit;
  }
  return geocodeArea(name);
}

export async function searchArea(
  params: SearchParams,
  preferred?: ProviderId,
  opts: SweepOptions = {}
): Promise<SweepResult> {
  const maxCells = opts.maxCells ?? config.sweepMaxCells;
  const maxPerCell = opts.maxPerCell ?? config.sweepMaxPerCell;
  const radiusKm = opts.radiusKm ?? DEFAULT_RADIUS_KM;

  const area = areaName(params);
  const geo = area ? await locateArea(area, params.gl) : null;

  // Sin caja envolvente no se puede barrer: búsqueda normal (una sola área)
  if (!geo?.bbox) {
    console.warn(`[sweep] no pude delimitar "${area ?? params.query}" → búsqueda normal`);
    const page = await searchAll(params, undefined, preferred);
    return { ...page, cells: 1, totalCells: 1, capped: false, area: geo?.label };
  }

  const { cells, total } = gridCells(geo.bbox, radiusKm, maxCells);
  const capped = total > cells.length;
  console.log(
    `[sweep] "${params.query}" en ${geo.label} → ${cells.length}/${total} celdas (~${radiusKm} km)` +
      `${capped ? " ⚠️ tope alcanzado (sube MAPS_MAX_CELLS)" : ""}`
  );

  const collected: Business[] = [];
  const seen = new Set<string>();
  let provider: ProviderId | undefined = preferred;
  let costUsd = 0;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const cellParams: SearchParams = {
      ...params,
      location: undefined,
      ll: `@${cell.lat.toFixed(5)},${cell.lng.toFixed(5)},${SWEEP_ZOOM}z`,
      max: maxPerCell,
    };
    try {
      const page = await searchAll(cellParams, undefined, provider);
      provider = page.provider;
      costUsd += page.costUsd ?? 0;
      for (const r of page.results) {
        const key = resultKey(r);
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(r);
      }
    } catch (error: any) {
      console.warn(`[sweep] celda ${i + 1}/${cells.length} falló: ${error?.message || error}`);
    }
    // Await: serializa los avisos de progreso (evita edits pisándose)
    await opts.onCell?.(i + 1, cells.length, collected.length);
  }

  const fixed: Exclude<ProviderId, "auto"> = provider && provider !== "auto" ? provider : "mock";
  return {
    results: collected,
    hasMore: false,
    nextToken: undefined,
    provider: fixed,
    costUsd,
    cells: cells.length,
    totalCells: total,
    capped,
    area: geo.label,
  };
}
