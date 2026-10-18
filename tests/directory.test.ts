import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTORY_COLUMNS, buildDirectoryCSV, slugify, toDirectoryRows } from "../src/directory";

test("slugify normaliza acentos y símbolos", () => {
  assert.equal(slugify("Café  Böen & Co."), "cafe-boen-co");
  assert.equal(slugify("  ---  "), "");
});

test("slug con título repetido usa el place_id y es estable", () => {
  const rows = toDirectoryRows([
    { title: "Farmacia", place_id: "p1" },
    { title: "Farmacia", place_id: "p2" },
  ] as any);
  assert.match(String(rows[0].slug), /^farmacia-[0-9a-f]{6}$/);
  assert.notEqual(rows[0].slug, rows[1].slug);

  const reversed = toDirectoryRows([
    { title: "Farmacia", place_id: "p2" },
    { title: "Farmacia", place_id: "p1" },
  ] as any)
    .map((r) => r.slug)
    .sort();
  assert.deepEqual(
    rows.map((r) => r.slug).sort(),
    reversed
  );
});

test("toDirectoryRows mapea horarios en español e inglés", () => {
  const [row] = toDirectoryRows([{ title: "H", opening_hours: { lunes: "08:00–19:00" } }] as any);
  assert.equal(row.monday, "08:00–19:00");
  assert.equal(row.sunday, "");
});

test("toDirectoryRows genera map_url/review_url nativas si faltan", () => {
  const [row] = toDirectoryRows([{ title: "X", cid: "999", place_id: "ChIJzzz" }] as any, "do", "es");
  assert.equal(row.map_url, "https://www.google.com/maps?cid=999&hl=es&gl=DO");
  assert.equal(row.review_url, "https://search.google.com/local/writereview?placeid=ChIJzzz");
});

test("buildDirectoryCSV: cabecera exacta y sin BOM", () => {
  const text = buildDirectoryCSV([{ title: "X", place_id: "p1" } as any]).toString("utf-8");
  assert.notEqual(text.charCodeAt(0), 0xfeff);
  assert.equal(text.split("\n")[0], DIRECTORY_COLUMNS.join(","));
});
