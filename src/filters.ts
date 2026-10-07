import type { Business, Filters } from "./types";

// Umbrales alineados con los chips de Prospect Hub (SearchView + scoring.ts)
function photoCount(b: Business): number {
  const photos = b.photos;
  if (Array.isArray(photos)) return photos.length;
  if (typeof photos === "number") return photos;
  return b.thumbnail ? 1 : 0;
}

export function matchesFilters(b: Business, f: Filters): boolean {
  if (f.sinWeb && !!b.website) return false;
  if (f.sinTelefono && !!b.phone) return false;
  if (f.ratingBajo && b.rating && b.rating >= 3.5) return false;
  if (f.pocasReviews && (b.reviews || 0) >= 10) return false;
  if (f.sinFotos && photoCount(b) > 0) return false;
  return true;
}

export function applyFilters(results: Business[], f: Filters): Business[] {
  const anyActive = Object.values(f).some(Boolean);
  if (!anyActive) return results;
  return results.filter((b) => matchesFilters(b, f));
}

export function activeFilterLabels(f: Filters): string[] {
  const labels: string[] = [];
  if (f.sinWeb) labels.push("sin web");
  if (f.sinTelefono) labels.push("sin teléfono");
  if (f.ratingBajo) labels.push("rating bajo");
  if (f.pocasReviews) labels.push("pocas reseñas");
  if (f.sinFotos) labels.push("sin fotos");
  return labels;
}
