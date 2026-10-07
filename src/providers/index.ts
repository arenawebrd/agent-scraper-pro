import type { PageToken, ProviderId } from "../types";
import type { MapsProvider } from "./types";
import { anyapiProvider } from "./anyapi";
import { mockProvider } from "./mock";
import { serpapiProvider } from "./serpapi";

export type { MapsProvider, ProviderPage } from "./types";

// Orden = prioridad en modo "auto": primero el más barato
//   AnyAPI ≈ $0.0013/página (20 resultados)  ·  SerpAPI = 1 crédito/página  ·  MOCK = gratis
export const REAL_PROVIDERS: MapsProvider[] = [anyapiProvider, serpapiProvider];
export const MOCK: MapsProvider = mockProvider;
export const ALL: MapsProvider[] = [...REAL_PROVIDERS, MOCK];

export function byId(id: string): MapsProvider | undefined {
  return ALL.find((p) => p.id === id);
}

function realAvailable(): MapsProvider[] {
  return REAL_PROVIDERS.filter((p) => p.available());
}

// Proveedores que se pueden usar ahora mismo (el MOCK solo si no hay ninguno real)
export function availableProviders(): MapsProvider[] {
  const real = realAvailable();
  return real.length ? real : [MOCK];
}

// Páginas siguientes sin proveedor fijado: se deduce del tipo de token
export function inferProvider(token?: PageToken): MapsProvider {
  if (typeof token === "string" && token.startsWith("a1:")) return anyapiProvider;
  return realAvailable().find((p) => p.id === "serpapi") ?? MOCK;
}

// candidatas para ESTA página; solo la primera permite cambiar de proveedor
export function resolveCandidates(preferred: ProviderId, first: boolean, token?: PageToken): MapsProvider[] {
  if (preferred !== "auto") {
    const p = byId(preferred);
    if (p && p.available()) return [p];
    const hint =
      preferred === "serpapi" ? " (falta SERPAPI_KEY en .env)"
      : preferred === "anyapi" ? " (falta ANYAPI_KEY en .env)"
      : "";
    throw new Error(`El proveedor "${preferred}" no está disponible${hint}`);
  }
  if (first) return availableProviders();
  return [inferProvider(token)];
}
