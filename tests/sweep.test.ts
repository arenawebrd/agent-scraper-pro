import { test } from "node:test";
import assert from "node:assert/strict";
import { areaName } from "../src/sweep";
import type { SearchParams } from "../src/types";

const p = (over: Partial<SearchParams>): SearchParams => ({ query: "", gl: "do", hl: "es", max: 0, ...over });

test("areaName prioriza location explícita", () => {
  assert.equal(areaName(p({ query: "farmacias en Samaná", location: "Samaná" })), "Samaná");
});

test("areaName cae a la cola '… en <área>'", () => {
  assert.equal(areaName(p({ query: "farmacias en Samaná" })), "Samaná");
  assert.equal(areaName(p({ query: "dentistas near Madrid" })), "Madrid");
});

test("areaName devuelve null sin área reconocible", () => {
  assert.equal(areaName(p({ query: "dentistas" })), null);
  assert.equal(areaName(p({ query: "panadería en Al" })), null);
});
