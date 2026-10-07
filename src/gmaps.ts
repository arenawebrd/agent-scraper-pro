// Interpretación de enlaces de Google Maps → parámetros de búsqueda
// Soporta: /maps/search/<query>/@lat,lng,zoom  ·  /maps/place/<nombre>/@lat,lng  ·
//          /maps?api=1&query=…  ·  links cortos (maps.app.goo.gl, goo.gl/maps)

export interface ParsedMapsUrl {
  query?: string;
  ll?: string; // formato "@lat,lng,zoom" listo para SerpAPI
}

const SHORT_HOSTS = ["maps.app.goo.gl", "goo.gl"];

export function extractMapsUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"]+/);
  if (!match) return null;
  let url = match[0];
  // corta paréntesis de cierre que suelen pegarse al final
  url = url.replace(/[)\],.]+$/, "");
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const isGoogleMaps =
      (host === "google.com" || host.endsWith(".google.com") || /^maps\./.test(host) || host === "g.co") &&
      /\/maps\//.test(url);
    const isShort = SHORT_HOSTS.some((h) => host === h);
    if (isGoogleMaps || isShort) return url;
  } catch {
    return null;
  }
  return null;
}

async function resolveShortUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    return res.url || url;
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
    const u = new URL(url);
    const q = u.searchParams.get("query") || u.searchParams.get("q") || u.searchParams.get("query_place_id");
    if (q) out.query = decodePath(q);
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

  const url = SHORT_HOSTS.some((h) => raw.includes(h)) ? await resolveShortUrl(raw) : raw;
  const parsed = parseMapsUrl(url);
  if (!parsed.query) return null;

  const params: { query: string; ll?: string; gl?: string } = { query: parsed.query };
  if (parsed.ll) {
    params.ll = parsed.ll;
    params.gl = (await reverseCountry(parsed.ll)) || undefined;
  }
  return { params, source: url };
}
