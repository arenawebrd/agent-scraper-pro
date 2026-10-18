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

export interface GeoArea {
  lat: number;
  lng: number;
  label: string;
  // [sur, norte, oeste, este] — de Nominatim
  bbox?: [number, number, number, number];
}

// Busca un lugar por nombre y devuelve su centro y su caja envolvente.
// Sirve igual para una provincia ("Samaná"), una región ("Pichincha") o un estado.
export async function geocodeArea(query: string): Promise<GeoArea | null> {
  const q = query.trim();
  if (!q) return null;

  await throttle();
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
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
    return { lat, lng, label: String(hit.display_name || q), bbox };
  } catch {
    return null;
  }
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
