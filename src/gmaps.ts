// Interpretación de enlaces de Google Maps → parámetros de búsqueda
// Soporta: /maps/search/<query>/@lat,lng,zoom  ·  /maps/place/<nombre>/@lat,lng  ·
//          /maps?api=1&query=…  ·  links cortos (maps.app.goo.gl, goo.gl/maps)

export interface ParsedMapsUrl {
  query?: string;
  ll?: string; // formato "@lat,lng,zoom" listo para SerpAPI
}

const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl"];

// google.com, www.google.com, maps.google.com, google.es, google.com.do…
// Comparación EXACTA del hostname: nada de "contiene", para que un dominio ajeno
// (maps.atacante.com, google.com.evil.io) no pase por Google.
const GOOGLE_HOST_RE = /^(?:[a-z0-9-]+\.)*google\.(?:com|[a-z]{2}|com?\.[a-z]{2})$/;

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isShortUrl(url: string): boolean {
  const host = hostnameOf(url);
  return !!host && SHORT_HOSTS.includes(host);
}

function isGoogleMapsUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!host || !GOOGLE_HOST_RE.test(host)) return false;
  return /^\/maps(?:\/|$)/.test(new URL(url).pathname);
}

export function extractMapsUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"]+/);
  if (!match) return null;
  // corta paréntesis de cierre que suelen pegarse al final
  const url = match[0].replace(/[)\],.]+$/, "");
  return isGoogleMapsUrl(url) || isShortUrl(url) ? url : null;
}

async function resolveShortUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    // Solo aceptamos el destino si sigue siendo Google Maps (nunca un host arbitrario)
    return res.url && isGoogleMapsUrl(res.url) ? res.url : url;
  } catch {
    return url;
  }
}

function decodePath(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, " "))
    .replace(/\/+$/, "")
    .trim();
}

export function parseMapsUrl(url: string): ParsedMapsUrl {
  const out: ParsedMapsUrl = {};

  // Coordenadas del centro del mapa: /@lat,lng,zoomz
  const atMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([\d.]+z?)/);
  if (atMatch) {
    out.ll = `@${atMatch[1]},${atMatch[2]},${atMatch[3].endsWith("z") ? atMatch[3] : atMatch[3] + "z"}`;
  }

  // /maps/search/<query>/@... o /maps/place/<nombre>/@...
  const pathMatch = url.match(/\/maps\/(search|place)\/([^@?]+)/);
  if (pathMatch) {
    const q = decodePath(pathMatch[2]);
    if (q) out.query = q;
  }

  // /maps?api=1&query=…  ·  /maps?…&q=…
  if (!out.query) {
    try {
      const u = new URL(url);
      const q = u.searchParams.get("query") || u.searchParams.get("q") || u.searchParams.get("query_place_id");
      if (q) out.query = decodePath(q);
    } catch {
      // URL malformada: sin query
    }
  }

  return out;
}

// País del centro del mapa vía Nominatim (gratis) → código ISO para `gl`
export async function reverseCountry(ll: string): Promise<string | null> {
  const m = ll.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${m[1]}&lon=${m[2]}&format=json&zoom=0&addressdetails=1`,
      {
        headers: { "User-Agent": "agent-scraper-pro/1.0" },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const code = data?.address?.country_code;
    return typeof code === "string" && /^[a-z]{2}$/i.test(code) ? code.toLowerCase() : null;
  } catch {
    return null;
  }
}

// Convierte un enlace pegado por el usuario en parámetros de búsqueda
export async function interpretMapsLink(text: string): Promise<{
  params: { query: string; ll?: string; gl?: string };
  source: string;
} | null> {
  const raw = extractMapsUrl(text);
  if (!raw) return null;

  const url = isShortUrl(raw) ? await resolveShortUrl(raw) : raw;
  const parsed = parseMapsUrl(url);
  if (!parsed.query) return null;

  const params: { query: string; ll?: string; gl?: string } = { query: parsed.query };
  if (parsed.ll) {
    params.ll = parsed.ll;
    params.gl = (await reverseCountry(parsed.ll)) || undefined;
  }
  return { params, source: url };
}
