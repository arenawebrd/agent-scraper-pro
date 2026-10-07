import { config } from "../src/config";
import { aiAvailable } from "../src/agent";
import { searchAll } from "../src/scraper";
import { buildCSV, buildJSON, exportFilename } from "../src/export";
import { applyFilters } from "../src/filters";

async function main() {
  console.log("── Config ──────────────────────────────");
  console.log(`SerpAPI : ${config.serpapiKey ? "real" : "MOCK"}`);
  console.log(`IA      : ${aiAvailable() ? `${config.ai.provider}/${config.ai.model}` : "desactivada"}`);
  console.log(`Límite  : ${config.maxResults || "todos (sin límite)"} resultados`);

  console.log("\n── Búsqueda ────────────────────────────");
  // Con key real usamos poco para no gastar créditos de SerpAPI
  const params = { query: "dentistas en Santo Domingo", gl: "do", hl: "es", max: config.serpapiKey ? 5 : 12 };
  const page = await searchAll(params);
  console.log(`Resultados: ${page.results.length} · hasMore: ${page.hasMore}`);
  const first = page.results[0];
  if (!first) throw new Error("Sin resultados");
  console.log(`Primer lead: ${first.title} | ${first.phone || "s/tel"} | ${first.website || "s/web"} | map_url: ${first.map_url ? "ok" : "falta"}`);

  console.log("\n── Filtro 'sin web' ───────────────────");
  const filtered = applyFilters(page.results, { sinWeb: true, sinTelefono: false, ratingBajo: false, pocasReviews: false, sinFotos: false });
  console.log(`Sin web: ${filtered.length}/${page.results.length}`);

  console.log("\n── Export ──────────────────────────────");
  const csv = buildCSV(page.results);
  const json = buildJSON(page.results);
  console.log(`CSV  ${exportFilename("csv")} → ${csv.length} bytes`);
  console.log(`JSON ${exportFilename("json")} → ${json.length} bytes`);
  const lines = csv.toString("utf-8").split("\n");
  console.log(`Columnas: ${lines[0]}`);
  console.log(`Fila 1  : ${lines[1]?.slice(0, 160)}...`);
  JSON.parse(json.toString("utf-8"));
  console.log("JSON válido ✓");

  console.log("\n── Agente IA ──────────────────────────");
  if (!aiAvailable()) {
    console.log("Desactivado (configura AI_PROVIDER y su API key). Saltando.");
    return;
  }
  const { classifyMessage } = await import("../src/agent");
  const defaults = { gl: config.defaultGl, hl: config.defaultHl, max: config.maxResults };

  const search = await classifyMessage("busca cafeterías sin web en Madrid, máximo 20", defaults);
  if (search?.kind !== "search") throw new Error(`Esperaba una búsqueda, obtuve: ${JSON.stringify(search)}`);
  console.log("[búsqueda] query:", search.params.query, "| gl/hl:", search.params.gl + "/" + search.params.hl, "| max:", search.params.max);
  console.log("[búsqueda] filtros:", JSON.stringify(search.filters));

  const chat = await classifyMessage("hola", defaults);
  if (chat?.kind !== "chat") throw new Error(`Esperaba una respuesta de chat, obtuve: ${JSON.stringify(chat)}`);
  console.log("[chat] reply:", chat.reply.slice(0, 140));

  const ask = await classifyMessage("¿qué puedes hacer?", defaults);
  console.log("[pregunta] tipo:", ask?.kind, "|", ask?.kind === "chat" ? ask.reply.slice(0, 140) : "");
}

main()
  .then(() => {
    console.log("\nTODO OK ✓");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nFALLO:", err.message);
    process.exit(1);
  });
