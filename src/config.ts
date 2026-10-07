import dotenv from "dotenv";

dotenv.config();

export type ApiStyle = "openai" | "anthropic";

export interface ProviderConfig {
  style: ApiStyle;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  gemini: {
    style: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKeyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.5-flash",
  },
  openai: {
    style: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
  },
  claude: {
    style: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-haiku-4-5",
  },
  openrouter: {
    style: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "openai/gpt-4o-mini",
  },
  groq: {
    style: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
  },
  opencode: {
    style: "openai",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKeyEnv: "OPENCODE_API_KEY",
    defaultModel: "mimo-v2.6-flash-free",
  },
};

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || !raw.trim()) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

// Tope duro de resultados por búsqueda (SerpAPI recomienda no pasar de start=100)
export const MAX_RESULTS_CAP = 200;

// MAX_RESULTS: 0 / "todo" / "todos" / "all" → sin límite (todos los que devuelva Google)
function maxResultsEnv(): number {
  const raw = (process.env.MAX_RESULTS || "").trim().toLowerCase();
  if (!raw) return 0;
  if (["0", "todo", "todos", "all", "infinito"].includes(raw)) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_RESULTS_CAP) : 0;
}

const allowedChatIds = (process.env.ALLOWED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const aiProviderRaw = strEnv("AI_PROVIDER", "opencode").toLowerCase();
const aiProvider = aiProviderRaw === "none" ? "none" : aiProviderRaw;
const aiMeta = PROVIDERS[aiProvider];

export const config = {
  telegramToken: strEnv("TELEGRAM_BOT_TOKEN", ""),
  serpapiKey: strEnv("SERPAPI_KEY", ""),
  mapboxToken: strEnv("MAPBOX_TOKEN", ""),
  allowedChatIds,
  // 0 = sin límite (trae todas las páginas disponibles)
  maxResults: maxResultsEnv(),
  maxResultsCap: MAX_RESULTS_CAP,
  // Detalle de cada negocio vía SerpAPI (type=place): 1 crédito POR negocio.
  // Por defecto apagado para no quemar la cuota.
  enrichDetails: boolEnv("ENRICH_DETAILS", false),
  defaultGl: strEnv("DEFAULT_GL", "do"),
  defaultHl: strEnv("DEFAULT_HL", "es"),
  previewCount: 10,
  ai: {
    provider: aiProvider,
    enabled: aiProvider !== "none" && !!aiMeta,
    style: aiMeta?.style || ("openai" as const),
    baseUrl: aiMeta?.baseUrl.replace(/\/+$/, "") || "",
    apiKey: aiMeta ? process.env[aiMeta.apiKeyEnv]?.trim() || "" : "",
    model: strEnv("AI_MODEL", aiMeta?.defaultModel || ""),
  },
};

if (!config.ai.enabled && aiProvider !== "none") {
  console.warn(`[config] AI_PROVIDER="${aiProvider}" no está en la lista. Disponibles: ${Object.keys(PROVIDERS).join(", ")}, none`);
} else if (config.ai.enabled && !config.ai.apiKey) {
  console.warn(`[config] AI_PROVIDER=${config.ai.provider} pero falta la env ${aiMeta?.apiKeyEnv}. El modo agente quedará desactivado (los comandos /buscar funcionan igual).`);
}

if (config.serpapiKey) {
  console.log("[config] SerpAPI: modo REAL");
  console.log(
    config.enrichDetails
      ? "[config] Detalle por negocio (type=place): ACTIVADO — 1 crédito extra por cada negocio sin web/teléfono"
      : "[config] Detalle por negocio (type=place): desactivado — solo se paga la búsqueda (1 crédito por página)"
  );
} else {
  console.log("[config] SerpAPI: sin key → modo MOCK (datos de prueba)");
}

if (config.allowedChatIds.length === 0) {
  console.warn("[config] ALLOWED_CHAT_IDS vacío → el bot está ABIERTO a cualquier chat. Rellena esa env para restringirlo.");
}

export function isChatAllowed(chatId: number): boolean {
  if (config.allowedChatIds.length === 0) return true;
  return config.allowedChatIds.includes(String(chatId));
}
