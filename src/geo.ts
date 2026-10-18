// Geocodificación (Nominatim) y rejilla geográfica para el barrido por
// provincia/región. Agnóstico del país: no depende de listas de localidades.

const USER_AGENT = "agent-scraper-pro/1.0";
const METERS_PER_DEG_LAT = 111_320;

// Nominatim pide máximo 1 petición por segundo
let lastGeo = 0;
async function throttle(): Promise<void> {
  const gap = 1100 - (Date.now() - lastGeo);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastGeo = Date.now();
}

// Geometría GeoJSON de un área (Polygon/MultiPolygon; coordenadas [lng, lat])
export type AreaGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface GeoArea {
  lat: number;
  lng: number;
  label: string;
  // [sur, norte, oeste, este] — de Nominatim
  bbox?: [number, number, number, number];
  // Polígono real del área, para filtrar los resultados que caen fuera
  geometry?: AreaGeometry;
}

// Busca un lugar por nombre y devuelve su centro, su caja envolvente y su polígono.
// Sirve igual para una provincia ("Samaná"), una región ("Pichincha") o un estado.
export async function geocodeArea(query: string): Promise<GeoArea | null> {
  const q = query.trim();
  if (!q) return null;

  await throttle();
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&polygon_geojson=1&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;

    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    let bbox: GeoArea["bbox"];
    if (Array.isArray(hit.boundingbox) && hit.boundingbox.length === 4) {
      const [south, north, west, east] = hit.boundingbox.map((v: string) => parseFloat(v));
      if ([south, north, west, east].every((v) => Number.isFinite(v))) {
        bbox = [south, north, west, east];
      }
    }

    let geometry: AreaGeometry | undefined;
    if (hit.geojson?.type === "Polygon" || hit.geojson?.type === "MultiPolygon") {
      geometry = hit.geojson as AreaGeometry;
    }

    return { lat, lng, label: String(hit.display_name || q), bbox, geometry };
  } catch {
    return null;
  }
}

export interface PointHit {
  lat: number;
  lng: number;
}

// Forward geocoding de una dirección (calle/localidad/CP/provincia), opcionalmente
// acotado a la caja del área para no resolver a una dirección de otra provincia.
export async function geocodePoint(
  query: string,
  opts: { bbox?: [number, number, number, number] } = {}
): Promise<PointHit | null> {
  const q = query.trim();
  if (!q) return null;

  await throttle();
  try {
    const params = new URLSearchParams({ format: "json", limit: "1", q });
    if (opts.bbox) {
      const [south, north, west, east] = opts.bbox;
      // Nominatim: viewbox = left,top,right,bottom
      params.set("viewbox", `${west},${north},${east},${south}`);
      params.set("bounded", "1");
    }
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

// Normaliza un nombre de área para comparar ("Provincia de Samaná" ≈ "Samaná").
export function normalizeAreaName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(provincia|province|region|región|estado|state|departamento|department|distrito|municipio|de|del|of)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Punto-en-polígono (ray casting). `ring` usa coordenadas [lng, lat].
function inRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Un polígono puede tener huecos (anillos 1..n): dentro del exterior y fuera de los huecos.
function inPolygon(lng: number, lat: number, rings: number[][][]): boolean {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) {
    if (inRing(lng, lat, rings[k])) return false;
  }
  return true;
}

// ¿El punto (lat, lng) cae dentro del área? Sin geometría no se puede comprobar → true.
export function pointInArea(lat: number, lng: number, geometry?: AreaGeometry): boolean {
  if (!geometry) return true;
  if (geometry.type === "Polygon") return inPolygon(lng, lat, geometry.coordinates);
  return geometry.coordinates.some((poly) => inPolygon(lng, lat, poly));
}

export interface Grid {
  cells: { lat: number; lng: number }[];
  // Total de celdas que cubrirían el área sin tope (para avisar si se recorta)
  total: number;
}

// Rejilla de centros que cubre un bbox con círculos de radio `radiusKm`.
// La separación es radio × 1.3 (≈ radio·√2) para que los círculos cubran
// también las esquinas de cada celda (sin huecos).
export function gridCells(
  bbox: [number, number, number, number],
  radiusKm: number,
  maxCells: number
): Grid {
  const [south, north, west, east] = bbox;
  const stepMeters = Math.max(radiusKm, 0.5) * 1.3 * 1000;
  const midLat = (south + north) / 2;
  const stepLat = stepMeters / METERS_PER_DEG_LAT;
  const cos = Math.max(0.01, Math.cos((midLat * Math.PI) / 180));
  const stepLng = stepMeters / (METERS_PER_DEG_LAT * cos);

  const latCount = Math.max(1, Math.ceil((north - south) / stepLat));
  const lngCount = Math.max(1, Math.ceil((east - west) / stepLng));
  const total = latCount * lngCount;

  const cells: { lat: number; lng: number }[] = [];
  for (let i = 0; i < latCount && cells.length < maxCells; i++) {
    for (let j = 0; j < lngCount && cells.length < maxCells; j++) {
      cells.push({
        lat: south + (i + 0.5) * ((north - south) / latCount),
        lng: west + (j + 0.5) * ((east - west) / lngCount),
      });
    }
  }
  return { cells, total };
}

// Código ISO de país (gl) → nombre legible, para desambiguar en Nominatim.
export function countryLabel(gl?: string): string {
  const code = (gl || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(code === "UK" ? "GB" : code) || "";
  } catch {
    return "";
  }
}
