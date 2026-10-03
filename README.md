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

El proyecto **se mantiene como una sola extensión**. No hay código compartido
entre extensiones de ST porque no hay mecanismo: cada una es un `<script
type="module">` con su propio ámbito (`extensions.js:813`) y su CSS va a
`document.head` sin scope (`extensions.js:781`). Dividir obligaría a duplicar
código o a servirlo con `importFromUrl()`, que es asíncrono y no está garantizado
por el orden de carga. El código está organizado en módulos para que la división
sea posible más adelante si alguna vez conviene.

```
src/
├── loader.js              # Entry point (bundled por esbuild)
├── extensionInfo.js       # Nombres canónicos: carpeta, clave de settings
├── index.js               # Módulo principal, exports + STTranslatorModules
├── ui.js                  # Panel de settings, event bindings
├── ui/settings.js         # Persistencia de configuración + migración
├── styles/                # UI del panel, toda con prefijo .sttd-
│
├──── Traducción ─────────────────────────────────────────────
├── translateProviders.js  # 9 proveedores
├── characters.js          # Traducción de personajes y lorebooks
├── pngTranslate.js        # Reescribe el chunk `chara` de un PNG
│
├──── Extracción ──────────────────────────────────────────────
├── characterImporter.js   # Importa personajes de tipsy/juicychat/...
├── juicychatCrypto.js     # Cifrado de la API de juicychat
├── richLore.js            # Recupera el lore que va dentro de un <script>
├── richCssInliner.js      # Reapunta el CSS de las cartas de documento
├── chatExportScripts.js   # Exporta chats al formato de cada sitio
│
└──── Base, sin dependencias ────────────────────────────────
    ├── pngChunks.js       # Primitivas de chunks PNG (cero imports)
    ├── utils.js           # fetchJson, preservación de variables
    └── stContext.js       # Acceso al contexto de ST
```

Las líneas en blanco marcan los grupos. Reglas que mantienen el grafo sano:

- **`pngChunks.js` no importa nada.** Lo consumen tanto la traducción como la
  extracción, y por eso vive aparte: si el módulo de traducción necesitara algo
  de él, la dependencia existiría en el grafo y no solo en el nombre del
  fichero. Antes estaba todo en `png.js`, que importaba `translateProviders` solo
  por una función de la mitad de abajo.
- **`extensionInfo.js` es la única fuente del nombre de la carpeta y de la clave
  de ajustes.** ST deriva ambos del `manifest.json`, no del código. Antes el
  nombre se adivinaba con un regex atado al nombre del bundle (`/dist/script.js`),
  que se rompía en silencio al renombrarlo, y la clave de ajustes era `translate`,
  que ST reserva para su propia extensión de traducción.
- **Ningún selector CSS sin prefijo `.sttd-`**, salvo las pocas reglas de
  `styles/lore.css` que tocan el chat a proposito (`#chat .mes_text .custom-sttd-msg`,
  `details.custom-sttd-lore`). Las clases que emite el importador para el chat
  llevan prefijo `custom-` porque ST lo añade al pasar un mensaje por
  `decodeStyleTags` (`chats.js:551`).

### Lo que NO es código de extensión

`temas-st/` contiene **temas JSON nativos de SillyTavern**, no una extensión.
Se instalan por `POST /api/themes/save` y viven en
`data/<usuario>/themes/`, junto a los que trae ST. `generar.mjs` es una
herramienta de build. Cero acoplamiento en runtime.

El aspecto de una web dentro del chat **viaja dentro de la tarjeta**: es el HTML
que el importador guarda en `first_mes`. Por eso las reglas que lo estilizan
dependen de clases que emite `characterImporter.js` y accompanying
`styles/lore.css`, y no de un tema aparte.

```
dist/
└── script.js               # Bundle final (esbuild)
settings.html               # Template del panel de configuración
manifest.json               # Manifiesto de extensión ST
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
