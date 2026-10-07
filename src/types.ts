export interface Business {
  title: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  photos?: string[] | number;
  images?: string[];
  data_id: string;
  data_cid?: string;
  place_id?: string;
  thumbnail?: string;
  map_url?: string;
  review_url?: string;
  gps_coordinates?: { latitude: number; longitude: number };
  types?: string[];
  type?: string | string[];
  opening_hours?: Record<string, string | { open: string; close: string }>;
  extensions?: any[];
  description?: string;
  street?: string;
  postal_code?: string;
  locality?: string;
  province?: string;
  country?: string;
  price?: string;
  extracted_price?: number;
  open_state?: string;
  check_in_time?: string;
  check_out_time?: string;
  pricing?: string;
  scrapedAt?: string;
  [key: string]: any;
}

export interface Filters {
  sinWeb: boolean;
  sinTelefono: boolean;
  ratingBajo: boolean;
  pocasReviews: boolean;
  sinFotos: boolean;
}

export const EMPTY_FILTERS: Filters = {
  sinWeb: false,
  sinTelefono: false,
  ratingBajo: false,
  pocasReviews: false,
  sinFotos: false,
};

export interface SearchParams {
  query: string;
  gl: string;
  hl: string;
  ll?: string;
  max: number;
}

export interface SearchPage {
  results: Business[];
  hasMore: boolean;
  // Offset real para pedir la siguiente página (evita repetir por desfases de dedupe)
  nextStart?: number;
}

export interface ChatPrefs {
  gl: string;
  hl: string;
  max: number;
}

export interface SearchSession {
  params: SearchParams;
  results: Business[];
  start: number;
  hasMore: boolean;
  pages: number;
  filters: Filters;
  busy: boolean;
}
