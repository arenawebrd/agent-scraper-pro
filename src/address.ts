import type { Business } from "./types";

// Normalización de direcciones: en países como República Dominicana el texto que
// devuelve Google viene en mayúsculas y abreviado, y no sigue un formato único.
// Aquí se recomponen las direcciones desde los componentes que ya extraemos
// (calle, sector, localidad, provincia, CP, país) y se limpian/capitalizan.

// Preposiciones y conjunciones que van en minúscula dentro de una dirección
// (salvo al inicio). Los artículos (El, La, Los, Las) se dejan en mayúscula
// porque suelen formar parte del nombre propio ("Residencial Los Pinos").
const CONNECTORS = new Set([
  "de", "del", "y", "e", "o", "u", "a", "al", "en", "con", "sin", "por", "para",
]);

// Abreviaturas frecuentes (español/RD) → forma normalizada.
const ABBREVIATIONS: Record<string, string> = {
  c: "Calle", cl: "Calle",
  av: "Avenida", avda: "Avenida",
  res: "Residencial", resid: "Residencial",
  urb: "Urbanización",
  bo: "Barrio", bar: "Barrio",
  sect: "Sector", sec: "Sector",
  num: "No.", nro: "No.", no: "No.",
  apdo: "Apartado",
};

function cleanSpaces(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// Normaliza UNA palabra: expande abreviaturas, baja los conectores y aplica
// "Inicial + minúsculas" a lo que venga todo en mayúsculas o todo en minúsculas.
function normalizeToken(token: string, isFirst: boolean): string {
  const m = token.match(/^([^\p{L}\p{N}]*)(\p{L}[\p{L}\p{N}’'-]*)(.*)$/u);
  if (!m) return token;
  const [, prefix, core, suffix] = m;
  const bare = core.toLocaleLowerCase();
  if (ABBREVIATIONS[bare]) return prefix + ABBREVIATIONS[bare] + suffix.replace(/^[./]+/, "");
  if (!isFirst && CONNECTORS.has(bare)) return prefix + bare + suffix;
  const isAllCaps = core === core.toLocaleUpperCase();
  const isAllLower = core === bare;
  if (isAllCaps || isAllLower) return prefix + bare.charAt(0).toLocaleUpperCase() + bare.slice(1) + suffix;
  return token; // mayúsculas/minúsculas mezcladas ("McDonald's"): se respeta
}

function formatSegment(segment: string): string {
  return segment
    .replace(/#/g, " No. ")
    .split(" ")
    .filter(Boolean)
    .map((token, i) => normalizeToken(token, i === 0))
    .join(" ")
    .replace(/\s+([.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Formatea un componente aislado (calle, sector, localidad, provincia…).
// Cada coma se trata como un componente nuevo (así "LAS TERRENAS" tras una
// coma vuelve a empezar en mayúscula aunque sea un conector).
// "AV. 27 DE FEBRERO" → "Avenida 27 de Febrero" · "c/ Duarte #12" → "Calle Duarte No. 12"
export function formatAddressComponent(value: unknown): string {
  const text = cleanSpaces(value);
  if (!text) return "";
  return text
    .split(",")
    .map((segment) => formatSegment(segment.trim()))
    .filter(Boolean)
    .join(", ");
}

// País legible: lo que traiga el negocio → el `gl` de la búsqueda → vacío.
function countryName(raw: unknown, gl: string): string {
  const text = cleanSpaces(raw) || cleanSpaces(gl);
  if (!text) return "";
  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = text.toUpperCase() === "UK" ? "GB" : text.toUpperCase();
    try {
      return new Intl.DisplayNames(["es"], { type: "region" }).of(code) || text;
    } catch {
      return text;
    }
  }
  return formatAddressComponent(text);
}

// Une los componentes evitando vacíos y repetidos (p. ej. la localidad ya
// incluida dentro de la calle, o la provincia igual a la localidad).
function joinParts(parts: unknown[]): string {
  const out: string[] = [];
  for (const raw of parts) {
    const part = cleanSpaces(raw);
    if (!part) continue;
    const low = part.toLocaleLowerCase();
    if (out.some((o) => o.toLocaleLowerCase() === low)) continue;
    if (out.some((o) => o.toLocaleLowerCase().includes(low))) continue;
    out.push(part);
  }
  return out.join(", ");
}

// Dirección canónica: calle, sector, localidad, provincia, CP, país.
// Si no hay calle estructurada se limpia/capitaliza el texto crudo del proveedor.
export function formatAddress(b: Business, gl = ""): string {
  const street = formatAddressComponent(b.street);
  const sector = formatAddressComponent(b.neighborhood);
  const locality = formatAddressComponent(b.locality);
  const province = formatAddressComponent(b.province);
  const postal = cleanSpaces(b.postal_code);
  const country = countryName(b.country, gl);

  if (!street) return formatAddressComponent(b.address);
  return joinParts([street, sector, locality, province, postal, country]);
}
