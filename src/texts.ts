// Textos de cara al usuario (HTML de Telegram).
export const HELP_TEXT = `🤖 <b>Agent Scraper Pro</b> — busca prospectos en Google Maps y exporta CSV/JSON

<b>Modo rápido</b>
<code>/buscar dentistas en Santo Domingo</code>
<code>/directorio restaurantes en Las Terrenas</code> — igual, pero en formato listings-data.csv
<code>/provincia farmacias en Samaná</code> — barre TODA la provincia (rejilla), no solo una ciudad

<b>Modo agente (IA)</b> — escribe como si hablaras:
<code>busca cafeterías sin web en Madrid con menos de 20 reseñas</code>
<code>trae los listings de dentistas en Santiago para el directorio</code>
también conversa: «¿qué puedes hacer?», «hola», «¿cómo exporto?»

<b>Enlace de Google Maps</b> — pega cualquier link y lo interpreto:
<code>google.com/maps/search/restaurantes+en+barcelona/@41.38,2.16,16z</code>

<b>Ajustes</b>
<code>/pais do</code> — país de búsqueda (código ISO)
<code>/idioma es</code> — idioma de resultados
<code>/max 40</code> — máximo de resultados por búsqueda
<code>/max todo</code> — sin límite, trae todos los disponibles
<code>/proveedor anyapi</code> — fuente de datos (auto / anyapi / serpapi / mock)
<code>/ajustes</code> — ver configuración

<b>Después de cada búsqueda</b>
📄 CSV / 🧾 JSON — exportar archivo
📁 Directorio — CSV con las columnas de la plantilla de directorios (listings-data.csv)
➕ Cargar más — siguiente página de resultados
🔍 Filtros — sin web, sin teléfono, rating bajo, pocas reseñas, sin fotos`;
