import { test } from "node:test";
import assert from "node:assert/strict";
import { countryLabel, gridCells } from "../src/geo";

test("gridCells cubre el bbox con celdas dentro de sus límites", () => {
  const bbox: [number, number, number, number] = [18.9, 19.0, -69.5, -69.4];
  const { cells, total } = gridCells(bbox, 6, 100);
  assert.equal(total, 4);
  assert.equal(cells.length, 4);
  for (const c of cells) {
    assert.ok(c.lat > bbox[0] && c.lat < bbox[1], "lat dentro del bbox");
    assert.ok(c.lng > bbox[2] && c.lng < bbox[3], "lng dentro del bbox");
  }
});

test("gridCells respeta el tope de celdas", () => {
  const { cells, total } = gridCells([18.9, 19.0, -69.5, -69.4], 6, 2);
  assert.equal(cells.length, 2);
  assert.equal(total, 4);
});

test("gridCells de un bbox diminuto devuelve 1 celda", () => {
  const { cells, total } = gridCells([19.0, 19.0001, -69.4, -69.3999], 6, 100);
  assert.equal(total, 1);
  assert.equal(cells.length, 1);
});

test("countryLabel traduce el ISO-2 a nombre", () => {
  assert.ok(countryLabel("do").length > 0);
  assert.equal(countryLabel("xx1"), "");
  assert.equal(countryLabel(""), "");
});
