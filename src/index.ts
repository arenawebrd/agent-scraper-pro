import { run } from "@grammyjs/runner";
import { config } from "./config";
import { createBot } from "./bot";

async function main() {
  if (!config.telegramToken) {
    console.error("Falta TELEGRAM_BOT_TOKEN en .env (consíguelo con @BotFather)");
    process.exit(1);
  }

  const bot = createBot();

  await bot.api.setMyCommands([
    { command: "buscar", description: "Buscar negocios en Google Maps" },
    { command: "directorio", description: "Igual que buscar, en formato listings-data.csv" },
    { command: "provincia", description: "Barre toda una provincia/región (ej: /provincia farmacias en Samaná)" },
    { command: "ayuda", description: "Cómo usar el bot" },
    { command: "pais", description: "País de búsqueda (ej: /pais do)" },
    { command: "idioma", description: "Idioma de resultados (ej: /idioma es)" },
    { command: "max", description: "Máximo de resultados (ej: /max 40)" },
    { command: "proveedor", description: "Fuente de datos (auto/anyapi/serpapi/mock)" },
    { command: "ajustes", description: "Ver configuración actual" },
  ]);

  const me = await bot.api.getMe();
  console.log(
    `[bot] @${me.username} iniciado (proveedor: ${config.provider}, IA: ${config.ai.enabled && config.ai.apiKey ? `${config.ai.provider}/${config.ai.model}` : "off"})`
  );

  // Runner: procesa updates en paralelo (una búsqueda larga ya no bloquea botones ni otros chats).
  // La exclusión por chat la hace el guard `busy` de runSearch/loadMore.
  const runner = run(bot);
  console.log("[bot] polling activo (runner concurrente). Esperando mensajes…");

  const stop = () => {
    if (runner.isRunning()) runner.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runner.task();
  } catch (error) {
    // 409 viene en error_code (la description es "Conflict: terminated by other getUpdates…")
    if ((error as { error_code?: number })?.error_code === 409) {
      console.error("");
      console.error("[bot] ⚠️  Telegram dice que YA hay otra instancia conectada (409 Conflict).");
      console.error('     Detén la otra con:  pkill -f "tsx src/index.ts"  y relanza este.');
      process.exit(1);
    }
    throw error;
  }
}

main().catch((error) => {
  console.error("[bot] fallo al arrancar:", error);
  process.exit(1);
});
