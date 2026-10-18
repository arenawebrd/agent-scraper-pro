import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMapsUrl, parseMapsUrl } from "../src/gmaps";

test("parseMapsUrl extrae query y coordenadas", () => {
  const p = parseMapsUrl("https://www.google.com/maps/search/dentistas+en+madrid/@40.4,-3.7,12z");
  assert.equal(p.query, "dentistas en madrid");
  assert.equal(p.ll, "@40.4,-3.7,12z");
});

test("parseMapsUrl añade la z si falta", () => {
  assert.equal(parseMapsUrl("https://www.google.com/maps/place/Foo/@1.5,2.5,15").ll, "@1.5,2.5,15z");
});

test("parseMapsUrl lee ?query=", () => {
  assert.equal(parseMapsUrl("https://www.google.com/maps?api=1&query=restaurantes").query, "restaurantes");
});

test("extractMapsUrl acepta hosts de Google y links cortos", () => {
  assert.ok(extractMapsUrl("mira https://maps.google.es/maps/place/X/@1,2,3z"));
  assert.ok(extractMapsUrl("https://maps.app.goo.gl/abc123"));
});

test("extractMapsUrl rechaza hosts ajenos que imitan a Google", () => {
  assert.equal(extractMapsUrl("https://google.com.evil.io/maps/place/x"), null);
  assert.equal(extractMapsUrl("https://maps.atacante.com/maps/place/x"), null);
  assert.equal(extractMapsUrl("no hay enlace"), null);
});
