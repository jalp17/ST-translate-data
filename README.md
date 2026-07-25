# ST-Universal-Translator

Extensión para SillyTavern que traduce contenido de lorebooks y tarjetas de personaje.

## Funcionalidad

- Traducción de lorebooks JSON (`world_info.entries`) con preservación de placeholders.
- Traducción de tarjetas de personaje PNG que almacenan metadatos en el chunk `chara`.
- Traducción de lotes de imágenes PNG y personajes ya agregados en SillyTavern.
- Soporta múltiples proveedores de traducción:
  - OpenAI
  - KoboldCPP (local)
  - llama.cpp
  - Ollama
  - LLM Studio
  - OpenRouter
  - Electron Hub
  - Google AI Studio
  - Google Translate básico
- Batch de traducción con delay configurable para evitar rate limiting.

## Archivos principales

- `src/`: código modular de la extensión.
- `src/loader.js`: punto de entrada usado para el bundle.
- `dist/script.js`: archivo empaquetado final que carga en SillyTavern.
- `settings.html`: panel de configuración con selectores de idioma, proveedor, API URL, API key y barra de progreso.

## Uso

1. Instala la extensión colocando esta carpeta en `data/<user-handle>/extensions` o en `scripts/extensions/third-party` de SillyTavern.
2. Genera el bundle con `npm install` y `npm run build`.
3. Asegúrate de que `manifest.json` y `dist/script.js` estén presentes en el mismo directorio.
4. Abre `settings.html` dentro de SillyTavern o en el contexto de la extensión.

Repositorio del proyecto: https://github.com/jalp17/ST-translate-data
4. Selecciona el idioma origen y destino.
5. Elige el proveedor de traducción y configura `API URL` / `API key` según el proveedor.
6. Para un solo PNG, sube el archivo y pulsa `Traducir tarjeta PNG`.
7. Para un lote de imágenes, selecciona múltiples PNG y especifica la carpeta de salida.
8. Para traducir personajes, selecciona uno o varios personajes en la lista y pulsa `Traducir personajes seleccionados`.
9. Para lorebooks ya cargados en SillyTavern, pulsa `Traducir lorebook actual`.

## Configuración de proveedores

- `openai`: usa el endpoint de OpenAI o uno personalizado en `apiUrl`.
- `local_koboldcpp`, `llama_cpp`, `ollama`, `llm_studio`, `openrouter`, `electron_hub`: soportan endpoint local o remoto.
- `google_aistudio`: se puede usar con `apiKey` o `apiUrl` personalizado.
- `google_translate`: requiere `apiKey` o `apiUrl` personalizado para Google Translate.

## Advertencias

- La implementación actual asume que los datos de la imagen PNG en el chunk `chara` son Base64 de JSON.
- Debes probar cada proveedor con su endpoint y opciones específicas de configuración.

## Licencia

MIT License. Consulta el archivo `LICENSE` para más detalles.
