import { config } from "./config";
import type { Filters, SearchParams } from "./types";

export interface AgentSearch {
  kind: "search";
  params: SearchParams;
  filters: Partial<Filters>;
}
export interface AgentChat {
  kind: "chat";
  reply: string;
}
export type AgentResult = AgentSearch | AgentChat | null;

export function aiAvailable(): boolean {
  return config.ai.enabled && !!config.ai.apiKey;
}

async function chat(system: string, user: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    if (config.ai.style === "anthropic") {
      const res = await fetch(`${config.ai.baseUrl}/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": config.ai.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.ai.model,
          max_tokens: 600,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`LLM ${res.status}: ${body.slice(0, 200)}`);
      }
      const data: any = await res.json();
      return data?.content?.[0]?.text ?? "";
    }

    // openai-compatible (openai, gemini, groq, openrouter, opencode)
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0,
        max_tokens: 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LLM ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = (defaults: { gl: string; hl: string; max: number }) => `Eres el asistente de "Agent Scraper Pro", un bot de Telegram que busca negocios en Google Maps y exporta prospectos (leads) en CSV/JSON.

CAPACIDADES DEL BOT:
- Búsqueda de negocios por tipo + ubicación: "dentistas sin web en Santo Domingo"
- Filtros: sin web, sin teléfono, rating bajo, pocas reseñas (<10), sin fotos
- Exportación a CSV y JSON (nombre, dirección, teléfono, web, rating, reseñas, coordenadas, imagen, horarios)
- Paginación de 20 en 20; trae todos los resultados disponibles salvo límite explícito (default: sin límite)
- Comandos: /buscar <texto>, /pais xx, /idioma xx, /max n, /proveedor auto|anyapi|serpapi, /ajustes, /ayuda
- Interpreta enlaces de Google Maps que le peguen

DECIDE EL TIPO DE MENSAJE:
1. type="search" cuando el usuario quiere buscar o extraer prospectos/negocios, aunque sea implícito:
   - "busca X en Y", "dame leads de X", "quiero fotógrafos en Madrid", "necesito clínicas sin web en Santo Domingo"
   - query = tipo de negocio + ubicación (en el idioma del usuario); gl = país ISO-2 (dedúcelo del mensaje, si no usa el default); hl = idioma
   - location = SOLO la ciudad/zona ("Santo Domingo", "Madrid", "Barcelona"), sin el tipo de negocio. Ponla siempre que la ubiques
   - ll solo si da coordenadas; max solo si pide cantidad; filters solo si los pide explícitamente
   - Si pide buscar pero NO se puede deducir la ubicación → type="chat" con reply preguntándola (ej: "¿En qué ciudad o país los buscas?")
2. type="chat" para todo lo demás: saludos, preguntas sobre qué puede hacer o cómo usarlo, dudas, agradecimientos, mensajes vagos o ambiguos.
   - Responde en 1-3 frases, cercano y útil, en el idioma del usuario
   - Si pregunta qué hace: resume capacidades con un ejemplo corto y menciona /ayuda
   - Si es un saludo: saluda brevemente y ofrece un ejemplo de búsqueda
   - No inventes funciones que no están listadas

DEVUELVE SOLO JSON válido, sin markdown ni explicaciones:
{"type":"search","query":string,"location":string|null,"gl":string,"hl":string,"ll":string|null,"max":number|null,"filters":{"sinWeb":boolean,"sinTelefono":boolean,"ratingBajo":boolean,"pocasReviews":boolean,"sinFotos":boolean}}
o
{"type":"chat","reply":string}

Defaults: gl="${defaults.gl}", hl="${defaults.hl}", max=${defaults.max}.`;

function extractJson(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function clampMax(n: unknown): number | undefined {
  const num = typeof n === "string" ? parseInt(n, 10) : typeof n === "number" ? n : NaN;
  if (!Number.isFinite(num) || num <= 0) return undefined;
  const cap = config.maxResults > 0 ? config.maxResults : config.maxResultsCap;
  return Math.min(Math.max(Math.round(num), 5), cap);
}

function parseLl(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const parts = v.replace(/^@/, "").split(",");
  const lat = parseFloat(parts[0] || "");
  const lng = parseFloat(parts[1] || "");
  if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return `${lat},${lng}`;
}

// Clasifica el mensaje: ¿es una búsqueda o una conversación?
// Devuelve null si la IA no está disponible o no se pudo interpretar.
export async function classifyMessage(
  text: string,
  defaults: { gl: string; hl: string; max: number },
  history: string[] = []
): Promise<AgentResult> {
  if (!aiAvailable()) return null;

  const context = history.length
    ? `CONVERSACIÓN PREVIA (últimos intercambios):\n${history.join("\n")}\n\n`
    : "";
  const raw = await chat(
    SYSTEM_PROMPT(defaults),
    `${context}MENSAJE DEL USUARIO:\n"""\n${text}\n"""\n\nJSON:`
  );
  const json = extractJson(raw);
  if (!json || typeof json !== "object") return null;

  // ── Conversación ──
  if (json.type === "chat") {
    const reply = typeof json.reply === "string" ? json.reply.trim() : "";
    if (!reply) return null;
    return { kind: "chat", reply };
  }

  // ── Búsqueda ──
  if (typeof json.query !== "string" || !json.query.trim()) return null;

  const filters: Partial<Filters> = {};
  const f = json.filters || {};
  if (f.sinWeb === true) filters.sinWeb = true;
  if (f.sinTelefono === true) filters.sinTelefono = true;
  if (f.ratingBajo === true) filters.ratingBajo = true;
  if (f.pocasReviews === true) filters.pocasReviews = true;
  if (f.sinFotos === true) filters.sinFotos = true;

  const gl = typeof json.gl === "string" && /^[a-z]{2}$/i.test(json.gl.trim())
    ? json.gl.trim().toLowerCase()
    : defaults.gl;
  const hl = typeof json.hl === "string" && /^[a-z]{2,3}$/i.test(json.hl.trim())
    ? json.hl.trim().toLowerCase()
    : defaults.hl;

  const params: SearchParams = {
    query: json.query.trim(),
    gl,
    hl,
    max: clampMax(json.max) ?? defaults.max,
  };
  const ll = parseLl(json.ll);
  if (ll) params.ll = ll;
  if (typeof json.location === "string" && json.location.trim()) {
    params.location = json.location.trim();
  }

  return { kind: "search", params, filters };
}
