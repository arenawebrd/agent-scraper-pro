import { test } from "node:test";
import assert from "node:assert/strict";
import { activeFilterLabels, applyFilters, matchesFilters } from "../src/filters";
import { EMPTY_FILTERS, type Business, type Filters } from "../src/types";

const f = (over: Partial<Filters> = {}): Filters => ({ ...EMPTY_FILTERS, ...over });

test("sinWeb: descarta los que tienen web", () => {
  assert.equal(matchesFilters({ title: "a", website: "https://x" } as Business, f({ sinWeb: true })), false);
  assert.equal(matchesFilters({ title: "b" } as Business, f({ sinWeb: true })), true);
});

test("sinTelefono: descarta los que tienen teléfono", () => {
  assert.equal(matchesFilters({ title: "a", phone: "809" } as Business, f({ sinTelefono: true })), false);
  assert.equal(matchesFilters({ title: "b" } as Business, f({ sinTelefono: true })), true);
});

test("ratingBajo: descarta rating >= 3.5", () => {
  assert.equal(matchesFilters({ title: "a", rating: 3.5 } as Business, f({ ratingBajo: true })), false);
  assert.equal(matchesFilters({ title: "b", rating: 3 } as Business, f({ ratingBajo: true })), true);
});

test("pocasReviews: descarta 10+ reseñas", () => {
  assert.equal(matchesFilters({ title: "a", reviews: 10 } as Business, f({ pocasReviews: true })), false);
  assert.equal(matchesFilters({ title: "b", reviews: 9 } as Business, f({ pocasReviews: true })), true);
});

test("sinFotos: cuenta arrays, números y thumbnail", () => {
  assert.equal(matchesFilters({ title: "a", photos: ["x"] } as Business, f({ sinFotos: true })), false);
  assert.equal(matchesFilters({ title: "b", photos: 2 } as Business, f({ sinFotos: true })), false);
  assert.equal(matchesFilters({ title: "c", thumbnail: "x" } as Business, f({ sinFotos: true })), false);
  assert.equal(matchesFilters({ title: "d" } as Business, f({ sinFotos: true })), true);
});

test("applyFilters sin filtros devuelve el mismo array", () => {
  const data = [{ title: "a" }] as Business[];
  assert.equal(applyFilters(data, EMPTY_FILTERS), data);
});

test("activeFilterLabels lista solo los activos", () => {
  assert.deepEqual(activeFilterLabels(f({ sinWeb: true, sinFotos: true })), ["sin web", "sin fotos"]);
});
