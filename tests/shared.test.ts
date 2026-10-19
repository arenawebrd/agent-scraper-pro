import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCidFromDataId, formatTitle, normalizeDetails, transformHours } from "../src/providers/shared";

test("transformHours normaliza 12h, 24h y cerrado", () => {
  const h = transformHours({ monday: "8:00 AM – 6:00 PM", tuesday: "Open 24 hours", saturday: "Closed" });
  assert.deepEqual(h?.monday, { open: "08:00", close: "18:00" });
  assert.deepEqual(h?.tuesday, { open: "00:00", close: "24:00" });
  assert.equal(h?.saturday, "cerrado");
  assert.equal(h?.sunday, "cerrado");
});

test("formatTitle corrige TODO EN MAYÚSCULAS", () => {
  assert.equal(formatTitle("RESTAURANT EL PINO"), "Restaurant El Pino");
  assert.equal(formatTitle("dental global"), "Dental Global");
});

test("formatTitle respeta nombres ya escritos y siglas cortas", () => {
  assert.equal(formatTitle("OdontoLeon"), "OdontoLeon");
  assert.equal(formatTitle("GO Dental"), "GO Dental");
  assert.equal(formatTitle("UPA"), "UPA");
  assert.equal(formatTitle("McDonald's"), "McDonald's");
  assert.equal(formatTitle("BBQ HOUSE"), "BBQ House");
  assert.equal(formatTitle("SERVICIOS EEUU"), "Servicios EEUU");
});

test("formatTitle normaliza títulos con mayúsculas mezcladas", () => {
  assert.equal(formatTitle("supermercado LA SIRENA"), "Supermercado La Sirena");
  assert.equal(formatTitle("CLINICA DR. PEREZ"), "Clinica Dr. Perez");
  assert.equal(formatTitle("Farmacia CAROL 24H"), "Farmacia Carol 24H");
  assert.equal(formatTitle("MARIA & JOSE"), "Maria & Jose");
});

test("extractCidFromDataId convierte el hex a decimal", () => {
  assert.equal(extractCidFromDataId("0x1234:0x1234"), "4660");
  assert.equal(extractCidFromDataId("sin-dos-puntos"), null);
  assert.equal(extractCidFromDataId("0x1:no-hex"), null);
});

test("normalizeDetails extrae cid/horas sin red", () => {
  const out = normalizeDetails({ title: "X", cid: "999", hours: [{ monday: "9-5" }] });
  assert.equal(out.data_cid, "999");
  assert.deepEqual(out.opening_hours, { monday: "9-5" });
  assert.equal(out.open_state, "");
  assert.equal(out.hours, undefined);
  assert.equal(out.cid, undefined);
});
