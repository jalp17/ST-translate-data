# ST-Universal-Translator

Extensión para SillyTavern que traduce contenido de lorebooks y tarjetas de personaje.

## Funcionalidad

- Traducción de lorebooks JSON (`world_info.entries`) con preservación de placeholders.
- Traducción de tarjetas de personaje PNG que almacenan metadatos en el chunk `chara`.
- Traducción de lotes de imágenes PNG y personajes ya agregados en SillyTavern.
- Soporta múltiples proveedores de traducción:
  - OpenAI / OpenRouter
  - KoboldCPP (local)
  - llama.cpp
  - Ollama
  - LLM Studio
  - Electron Hub
  - Google AI Studio
  - Google Translate básico
- Batch de traducción con delay configurable para evitar rate limiting.
- **Persistencia de configuración**: API key, modelo, proveedor, idiomas y modo de conexión se guardan entre sesiones via `extensionSettings` de SillyTavern.
- **CSS namespaced**: todas las clases de la extensión usan el prefijo `sttd-` para evitar colisiones con el core de SillyTavern.
- **Inicialización event-driven**: usa `eventSource.on(APP_READY)` en vez de polling, con fallback a `setTimeout` solo si `eventSource` no está disponible.

## Arquitectura

```
src/
├── loader.js            # Entry point (bundled por esbuild)
├── index.js             # Módulo principal, exports + STTranslatorModules
├── ui.js                # Panel de settings, event bindings
├── ui/settings.js       # Persistencia de configuración (get/save/populate)
├── translateProviders.js # 9 proveedores de traducción
├── characters.js        # Lógica de traducción de personajes y lorebooks
├── png.js               # Manipulación de chunks PNG para character cards
├── utils.js             # fetchJson, preservación de variables, errores
└── styles/
    ├── main.css         # Entry point CSS (@imports)
    ├── legacy-aliases.css # Aliases con prefijo sttd-
    ├── base.css
    ├── forms.css
    ├── buttons.css
    ├── cards.css
    ├── search.css
    ├── progress.css
    └── ...

dist/
└── script.js            # Bundle final (esbuild)
settings.html            # Template del panel de configuración
manifest.json            # Manifiesto de extensión ST
```

## Instalación

1. Clona o copia esta carpeta en `data/<user-handle>/extensions` o en `scripts/extensions/third-party` de SillyTavern.
2. Genera el bundle con `npm install` y `npm run build`.
3. Asegúrate de que `manifest.json`, `dist/script.js` y `src/styles/main.css` estén presentes.
4. Recarga SillyTavern. La extensión aparecerá en el panel de extensiones.

## Uso

1. Abre el panel de extensiones de SillyTavern.
2. Selecciona "ST Universal Translator".
3. Configura el proveedor, API URL, API key y modelo en el panel de settings.
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

### Nota sobre CORS

La extensión llama a los endpoints de traducción directamente desde el navegador. Muchos servidores locales (Ollama, llama.cpp) no envían cabeceras CORS y bloquearán las solicitudes. Si ves un error de CORS:

1. Usa un endpoint que envíe `Access-Control-Allow-Origin: *`.
2. O bien, usa el proxy backend de SillyTavern (planeado para una versión futura).
3. O usa un navegador con CORS deshabilitado para desarrollo.

## Advertencias

- La implementación actual asume que los datos de la imagen PNG en el chunk `chara` son Base64 de JSON.
- Debes probar cada proveedor con su endpoint y opciones específicas de configuración.
- Las claves de API se guardan en `extensionSettings` de SillyTavern (localstorage). No se envían a servidores externos salvo al proveedor configurado.

## Desarrollo

```bash
npm install
npm run build      # Bundlea dist/script.js
npm run watch      # Modo watch para desarrollo
```

## Licencia

MIT License. Consulta el archivo `LICENSE` para más detalles.
