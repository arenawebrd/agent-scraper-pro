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

  try {
    await bot.start({
      onStart: () => console.log("[bot] polling activo. Esperando mensajes…"),
    });
  } catch (error) {
    const description = String((error as { description?: string })?.description ?? "");
    if (description.includes("409")) {
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
