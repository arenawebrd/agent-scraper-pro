import type { PageToken, SearchParams } from "../types";
import type { MapsProvider, ProviderPage } from "./types";
import { enrichWithMapbox, normalizeBusiness } from "./shared";

// server.ts:1432-1541 (getMockData) — para probar sin gastar cuota
const ALL_MOCKS = [
  { title: "Elite Roofing Solutions", address: "123 Main St, Austin, TX 78701", phone: "(512) 555-0123", website: "https://eliteroofing.com", rating: 4.2, reviews: 45, data_id: "mock_1", gps_coordinates: { latitude: 30.2672, longitude: -97.7431 }, operating_hours: { monday: "Open 24 hours", tuesday: "Open 24 hours", wednesday: "Open 24 hours", thursday: "Open 24 hours", friday: "Open 24 hours", saturday: "Open 24 hours", sunday: "Open 24 hours" } },
  { title: "Joe's Plumbing & Drain", address: "456 Oak Ave, Austin, TX 78704", phone: "(512) 555-4567", rating: 3.8, reviews: 12, data_id: "mock_2", gps_coordinates: { latitude: 30.2472, longitude: -97.7531 }, operating_hours: { monday: "8:00 AM – 6:00 PM", tuesday: "8:00 AM – 6:00 PM", wednesday: "8:00 AM – 6:00 PM", thursday: "8:00 AM – 6:00 PM", friday: "8:00 AM – 6:00 PM", saturday: "Closed", sunday: "Closed" } },
  { title: "Sunshine Dental Care", address: "789 Pine Rd, Austin, TX 78745", phone: "(512) 555-7890", website: "https://facebook.com/sunshinedental", rating: 4.9, reviews: 210, data_id: "mock_3", gps_coordinates: { latitude: 30.2172, longitude: -97.7731 }, operating_hours: { monday: "9:00 AM – 5:00 PM", tuesday: "9:00 AM – 5:00 PM", wednesday: "9:00 AM – 5:00 PM", thursday: "9:00 AM – 5:00 PM", friday: "9:00 AM – 5:00 PM", saturday: "10:00 AM – 2:00 PM", sunday: "Closed" } },
  { title: "Austin Auto Repair", address: "101 Speed Way, Austin, TX 78751", phone: "(512) 555-1010", rating: 2.5, reviews: 8, data_id: "mock_4", gps_coordinates: { latitude: 30.3072, longitude: -97.7131 } },
  { title: "Green Leaf Landscaping", address: "202 Garden Ln, Austin, TX 78702", website: "https://greenleaf.com", rating: 4.5, reviews: 88, data_id: "mock_5", gps_coordinates: { latitude: 30.2572, longitude: -97.7231 } },
  { title: "Austin Tech Support", address: "505 Innovation Blvd, Austin, TX 78701", phone: "(512) 555-9999", rating: 4.7, reviews: 34, data_id: "mock_6", gps_coordinates: { latitude: 30.2772, longitude: -97.7331 } },
  { title: "Lone Star Cafe", address: "303 Congress Ave, Austin, TX 78701", phone: "(512) 555-3333", rating: 4.1, reviews: 120, data_id: "mock_7", gps_coordinates: { latitude: 30.2632, longitude: -97.7441 } },
];

const PAGE_SIZE = 5;

async function search(params: SearchParams, token: PageToken): Promise<ProviderPage> {
  const start = typeof token === "number" ? token : parseInt(String(token), 10) || 0;
  const { query, gl, hl, max } = params;
  console.log(`[mock] q="${query}" start=${start}`);

  const raw = ALL_MOCKS.slice(start, start + PAGE_SIZE);
  const limit = max > 0 ? Math.max(0, max - start) : Number.POSITIVE_INFINITY;
  const kept = raw.slice(0, limit);

  const enriched = await Promise.all(kept.map((b) => enrichWithMapbox(b)));
  const results = enriched.map((b) => normalizeBusiness(b, gl, hl));
  const next = start + PAGE_SIZE < ALL_MOCKS.length;

  return {
    results,
    hasMore: next && (max <= 0 || start + raw.length < max),
    nextToken: next ? start + PAGE_SIZE : undefined,
    costUsd: 0,
  };
}

// Solo se usa cuando no hay ninguna key real (o si se pide a mano con /proveedor mock)
export const mockProvider: MapsProvider = {
  id: "mock",
  label: "MOCK (datos de prueba)",
  available: () => true,
  search,
};
