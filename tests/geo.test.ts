import { test } from "node:test";
import assert from "node:assert/strict";
import { countryLabel, gridCells, pointInArea, type AreaGeometry } from "../src/geo";

const square: AreaGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};

test("pointInArea: dentro y fuera de un polígono", () => {
  assert.equal(pointInArea(1, 1, square), true);
  assert.equal(pointInArea(3, 1, square), false);
});

test("pointInArea: respeta los huecos del polígono", () => {
  const withHole: AreaGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 0],
      ],
      [
        [1, 1],
        [3, 1],
        [3, 3],
        [1, 3],
        [1, 1],
      ],
    ],
  };
  assert.equal(pointInArea(0.5, 0.5, withHole), true);
  assert.equal(pointInArea(2, 2, withHole), false);
});

test("pointInArea: MultiPolygon y sin geometría", () => {
  const multi: AreaGeometry = {
    type: "MultiPolygon",
    coordinates: [square.coordinates, [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]],
  };
  assert.equal(pointInArea(1, 1, multi), true);
  assert.equal(pointInArea(10.5, 10.5, multi), true);
  assert.equal(pointInArea(5, 5, multi), false);
  assert.equal(pointInArea(5, 5, undefined), true);
});

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
