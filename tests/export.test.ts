import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCSV, buildJSON, prepareDataForExport, toCSV } from "../src/export";
import type { Business } from "../src/types";

test("toCSV escapa comas, comillas y saltos de línea", () => {
  const csv = toCSV([{ a: "hola,mundo", b: 'di "hola"', c: "línea1\nlínea2", d: 42 }]);
  assert.equal(csv, 'a,b,c,d\n"hola,mundo","di ""hola""","línea1\nlínea2",42');
});

test("toCSV respeta el orden de cabecera indicado", () => {
  assert.equal(toCSV([{ b: 1, a: 2 }], ["a", "b"]), "a,b\n2,1");
});

test("toCSV celdas vacías quedan vacías", () => {
  assert.equal(toCSV([{ a: "", b: null, c: undefined } as any]), "a,b,c\n,,");
});

test("buildCSV antepone BOM UTF-8", () => {
  const buf = buildCSV([{ title: "Café" } as Business]);
  assert.equal(buf.toString("utf-8").charCodeAt(0), 0xfeff);
});

test("buildJSON produce JSON parseable", () => {
  const arr = JSON.parse(buildJSON([{ title: "X", rating: 4.5 } as Business]).toString("utf-8"));
  assert.equal(arr[0].title, "X");
  assert.equal(arr[0].rating, 4.5);
});

test("prepareDataForExport genera map_url/review_url nativas si faltan", () => {
  const prepared = prepareDataForExport(
    [
      { title: "A", cid: "123", place_id: "ChIJabc" },
      { title: "B", place_id: "ChIJdef" },
      { title: "C", map_url: "https://mio", review_url: "https://rev" },
    ] as Business[],
    "do",
    "es"
  );
  assert.equal(prepared[0].map_url, "https://www.google.com/maps?cid=123&hl=es&gl=DO");
  assert.equal(prepared[0].review_url, "https://search.google.com/local/writereview?placeid=ChIJabc");
  assert.match(prepared[1].map_url, /query_place_id=ChIJdef/);
  assert.equal(prepared[2].map_url, "https://mio");
  assert.equal(prepared[2].review_url, "https://rev");
});

test("prepareDataForExport genera columnas dinámicas ext_* ordenadas", () => {
  const prepared = prepareDataForExport([
    { title: "A", extensions: [{ highlights: ["x", "y"] }] },
    { title: "B", extensions: [{ payments: ["cash"] }] },
  ] as any);
  const ext = Object.keys(prepared[0]).filter((k) => k.startsWith("ext_"));
  assert.deepEqual(ext, ["ext_highlights", "ext_payments"]);
  assert.equal(prepared[0].ext_highlights, "x, y");
  assert.equal(prepared[0].position, 1);
});
