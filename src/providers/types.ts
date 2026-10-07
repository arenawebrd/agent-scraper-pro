import type { Business, PageToken, ProviderId, SearchParams } from "../types";

// Resultado de una página de un proveedor concreto
export interface ProviderPage {
  results: Business[];
  hasMore: boolean;
  // Token que hay que devolver en la siguiente llamada (undefined = no hay más)
  nextToken?: PageToken;
  // Coste de ESTA llamada en USD (undefined/SerpAPI = usan créditos, no dólares)
  costUsd?: number;
}

// Interfaz única: cualquier proveedor de mapas debe poder hacer esto.
// token es number para offsets (SerpAPI) y string para cursors (AnyAPI).
export interface MapsProvider {
  id: Exclude<ProviderId, "auto">;
  label: string;
  available(): boolean;
  search(params: SearchParams, token: PageToken): Promise<ProviderPage>;
}
