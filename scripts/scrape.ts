import fs from "node:fs";
import path from "node:path";
import { config, PROVIDER_IDS } from "../src/config";
import { searchAll } from "../src/scraper";
import { searchArea } from "../src/sweep";
import { buildCSV, buildJSON, exportFilename } from "../src/export";
import { buildDirectoryCSV } from "../src/directory";
import { applyFilters } from "../src/filters";
import { EMPTY_FILTERS, type Filters, type ProviderId, type SearchParams } from "../src/types";

// CLI sin Telegram: misma fachada que el bot (searchAll) exportando a disco.
// No necesita TELEGRAM_BOT_TOKEN ni la IA: solo las claves del proveedor de mapas.

const USAGE = `
Uso:
  npm run scrape -- "dentistas en Santo Domingo" [opciones]

Opciones:
  --max N              Máximo de resultados (default: MAX_RESULTS del .env, 0 = sin límite)
  --out, -o ARCHIVO    Archivo de salida (default: leads_<fecha>.csv)
  --format csv|json|directory
                      csv = columnas del bot · json = lo mismo en JSON ·
                      directory = listings-data.csv de la plantilla
                      business-directory-astro (para process-listings)
  --provider, -p P     auto | anyapi | serpapi | mock (default: MAPS_PROVIDER del .env)
  --gl XX --hl XX      País e idioma (default: DEFAULT_GL/DEFAULT_HL del .env)
  --location "Ciudad"  Ciudad/zona para geocodificar (SerpAPI/AnyAPI)
  --provincia          Barre TODA la provincia/región del texto (rejilla)
                       ej: --provincia "farmacias en Samaná"
  --sin-web            Filtra los que ya tienen página web
  --sin-telefono       Filtra los que ya tienen teléfono
  --sin-fotos          Filtra los que ya tienen fotos
  --pocas-reviews      Filtra los que tienen 10+ reseñas
  --rating-bajo        Filtra los de rating ≥ 3,5
  -h, --help           Esta ayuda

Ejemplos:
  npm run scrape -- "restaurantes en Las Terrenas" --max 40 -o restaurantes.csv
  npm run scrape -- "dentistas Santiago" --sin-web --format json
  npm run scrape -- "restaurantes en Las Terrenas" --max 40 --format directory -o listings-scraped.csv
`;

interface CliArgs {
  query: string;
  max?: number;
  out?: string;
  format: "csv" | "json" | "directory";
  provider?: ProviderId;
  gl?: string;
  hl?: string;
  location?: string;
  province: boolean;
  filters: Filters;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const filters = { ...EMPTY_FILTERS };
  const words: string[] = [];
  let max: number | undefined;
  let out: string | undefined;
  let format: "csv" | "json" | "directory" = "csv";
  let provider: ProviderId | undefined;
  let gl: string | undefined;
  let hl: string | undefined;
  let location: string | undefined;
  let province = false;
  let help = false;

  const value = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`Falta el valor de ${flag}`);
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "--max":
        max = parseInt(value(i++, "--max"), 10);
        if (!Number.isFinite(max) || max < 0) throw new Error("--max debe ser un número ≥ 0");
        break;
      case "--out":
      case "-o":
        out = value(i++, "--out");
        break;
      case "--format": {
        const f = value(i++, "--format").toLowerCase();
        if (f !== "csv" && f !== "json" && f !== "directory") {
          throw new Error(`--format debe ser csv, json o directory (recibí "${f}")`);
        }
        format = f;
        break;
      }
      case "--provider":
      case "-p": {
        const p = value(i++, "--provider").toLowerCase() as ProviderId;
        if (!PROVIDER_IDS.includes(p)) throw new Error(`--provider debe ser ${PROVIDER_IDS.join(" | ")}`);
        provider = p;
        break;
      }
      case "--gl":
        gl = value(i++, "--gl");
        break;
      case "--hl":
        hl = value(i++, "--hl");
        break;
      case "--location":
      case "-l":
        location = value(i++, "--location");
        break;
      case "--provincia":
        province = true;
        break;
      case "--sin-web":
        filters.sinWeb = true;
        break;
      case "--sin-telefono":
        filters.sinTelefono = true;
        break;
      case "--sin-fotos":
        filters.sinFotos = true;
        break;
      case "--pocas-reviews":
        filters.pocasReviews = true;
        break;
      case "--rating-bajo":
        filters.ratingBajo = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`Opción desconocida: ${a}\n${USAGE}`);
        words.push(a);
    }
  }

  return { query: words.join(" "), max, out, format, provider, gl, hl, location, province, filters, help };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (!args.query.trim()) {
    console.log(USAGE);
    throw new Error("Falta la búsqueda (ej.: npm run scrape -- \"dentistas en Santo Domingo\")");
  }

  const params: SearchParams = {
    query: args.query.trim(),
    gl: args.gl ?? config.defaultGl,
    hl: args.hl ?? config.defaultHl,
    max: args.max ?? config.maxResults,
    location: args.location,
  };
  const active = (Object.keys(args.filters) as (keyof Filters)[]).filter((k) => args.filters[k]);
  console.log(
    `[scrape] "${params.query}" · gl/hl ${params.gl}/${params.hl} · máx ${params.max || "sin límite"}` +
      ` · proveedor ${args.provider ?? config.provider}${active.length ? ` · filtros: ${active.join(", ")}` : ""}`
  );

  const started = Date.now();
  const page = args.province
    ? await searchArea(params, args.provider, {
        onCell: (done, total, found) =>
          process.stdout.write(`\r  … celda ${done}/${total} · ${found} resultados   `),
      })
    : await searchAll(params, (n) => process.stdout.write(`\r  … ${n} resultados   `), args.provider);
  process.stdout.write("\n");

  const results = applyFilters(page.results, args.filters);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `[scrape] ${results.length}/${page.results.length} tras filtros · proveedor ${page.provider}` +
      ` · coste $${(page.costUsd ?? 0).toFixed(4)} · ${secs}s`
  );
  if (results.length === 0) {
    console.log("[scrape] Sin resultados: no se escribe ningún archivo.");
    return;
  }

  const out = args.out ?? exportFilename(args.format === "directory" ? "csv" : args.format);
  const body =
    args.format === "directory" ? buildDirectoryCSV(results, params.gl)
    : args.format === "json" ? buildJSON(results)
    : buildCSV(results);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, body);
  console.log(`[scrape] ✓ ${args.format.toUpperCase()} → ${path.resolve(out)}`);
}

main().catch((err) => {
  console.error("\nFALLO:", err.message);
  process.exit(1);
});
