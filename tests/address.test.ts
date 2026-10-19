import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAddress, formatAddressComponent } from "../src/address";
import type { Business } from "../src/types";

test("formatAddressComponent expande abreviaturas y capitaliza", () => {
  assert.equal(formatAddressComponent("AV. 27 DE FEBRERO"), "Avenida 27 de Febrero");
  assert.equal(formatAddressComponent("c/ DUARTE #12"), "Calle Duarte No. 12");
  assert.equal(formatAddressComponent("RES. LOS PINOS"), "Residencial Los Pinos");
});

test("formatAddressComponent respeta marcas y reinicia tras la coma", () => {
  assert.equal(formatAddressComponent("CALLE PRINCIPAL, LAS TERRENAS"), "Calle Principal, Las Terrenas");
  assert.equal(formatAddressComponent("McDonald's"), "McDonald's");
});

test("formatAddress recompone desde componentes y deduplica", () => {
  const b = {
    title: "X",
    data_id: "x",
    address: "Av. 27 de Febrero 45, Santo Domingo, República Dominicana",
    street: "AV. 27 DE FEBRERO 45",
    locality: "SANTO DOMINGO",
    province: "SANTO DOMINGO",
    country: "DO",
  } as Business;
  assert.equal(formatAddress(b, "do"), "Avenida 27 de Febrero 45, Santo Domingo, República Dominicana");
});

test("formatAddress incluye sector, provincia y CP", () => {
  const b = {
    title: "X",
    data_id: "x",
    address: "Calle Duarte 5, Villas Agrícolas, Santo Domingo",
    street: "CALLE DUARTE 5",
    neighborhood: "villas agricolas",
    locality: "SANTO DOMINGO",
    province: "DISTRITO NACIONAL",
    postal_code: "10112",
    country: "República Dominicana",
  } as Business;
  assert.equal(
    formatAddress(b, "do"),
    "Calle Duarte 5, Villas Agricolas, Santo Domingo, Distrito Nacional, 10112, República Dominicana"
  );
});

test("formatAddress evita repetir la localidad si ya está en la calle", () => {
  const b = {
    title: "X",
    data_id: "x",
    street: "CALLE DUARTE 5, SANTO DOMINGO",
    locality: "SANTO DOMINGO",
    country: "República Dominicana",
  } as Business;
  assert.equal(formatAddress(b, "do"), "Calle Duarte 5, Santo Domingo, República Dominicana");
});

test("formatAddress usa el texto crudo si no hay calle", () => {
  const b = { title: "X", data_id: "x", address: "CALLE PRINCIPAL, LAS TERRENAS" } as Business;
  assert.equal(formatAddress(b, "do"), "Calle Principal, Las Terrenas");
});
