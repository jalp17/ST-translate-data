# Investigación: Imágenes internas en mensajes de SillyTavern

**Fecha:** 2026-09-29
**Objetivo:** Determinar si ST puede resolver referencias a imágenes locales dentro del texto de un mensaje, y cuál es el punto de extensión correcto.
**Codebase analizado:** `/mnt/src_file/desarrollo_git/SillyTavern`
**Versión local:** `1.18.0` (rama `release`, HEAD `8172dcd0e`, 2026-07-07)
**Versión actual upstream:** `1.19.0` (tag, 2026-09-14) — **el checkout local está una versión por detrás**

---

## TL;DR — Los 3 hallazgos que cambian la ecuación

1. **Ya existe un mecanismo funcional, pero es una convención de rutas, no un esquema con nombre.** Cualquier ruta absoluta same-origin bajo una raíz servida por ST (`/characters/`, `/user/images/`, `/user/files/`, `/backgrounds/`, `/User Avatars/`, `/assets/`) funciona hoy dentro de markdown de un mensaje, sobrevive a DOMPurify y **no** la afecta `forbid_external_media`.

2. **ST 1.19.0 acaba de añadir exactamente el hook que necesitamos**: `MessageFormatter` (`public/scripts/message-formatter.js`), expuesto en `getContext().messageFormatter`, con un stage `afterMarkdown` que corre **después de showdown y antes de DOMPurify**. Es la API oficial para reescribir texto de mensaje desde una extensión sin tocar `chats.js`.

3. **El importador de CharX ya deposita los archivos exactamente en esas rutas servidas.** `src/charx.js:336` pone los assets "misc" en `data/<user>/user/images/<CharacterName>/`, y `src/charx.js:323` los sprites en `data/<user>/characters/<CharacterName>/`. Por lo tanto el resolver `embedded://` → URL es un mapeo de ~10 líneas.

**Extra:** existe un sistema de adjuntos de primera clase (`mes.extra.media`) que es la vía *oficial* y que ya funciona con archivos locales, pero es fuera del texto del mensaje.

---

## Respuestas directas

### 1. ¿Existe YA un mecanismo funcional para que un mensaje referencie una imagen local por ruta?

**Sí, en dos formas. Ninguna es un "esquema URI"; ambas son convenciones de URL servida.**

#### (a) Markdown con ruta absoluta servida — funciona hoy, sin código extra

ST monta un router de archivos de usuario en la **raíz** de la app:

`src/server-startup.js:141`
```js
app.use('/', userDataRouter);   // userDataRouter = { router } from './users.js'
```

`src/users.js:1213-1219` — las rutas servidas:
```js
router.use('/backgrounds/*',   createRouteHandler(req => req.user.directories.backgrounds));
router.use('/characters/*',     createRouteHandler(req => req.user.directories.characters));
router.use('/User%20Avatars/*', createRouteHandler(req => req.user.directories.avatars));
router.use('/assets/*',         createRouteHandler(req => req.user.directories.assets));
router.use('/user/images/*',    createRouteHandler(req => req.user.directories.userImages));  // ← L1217
router.use('/user/files/*',     createRouteHandler(req => req.user.directories.files));
```

Por lo tanto, dentro de `first_mes` o cualquier mensaje:

```markdown
![Seraphina sonriendo](/characters/Seraphina/joy.png)
![Foto](/user/images/Seraphina/escena_01.png)
```
funciona: el navegador resuelve contra el origen, pide la ruta, ST la sirve, y la imagen aparece.

**Evidencia dura de que este camino es real y está en producción — la extensión Expressions:**

`src/endpoints/sprites.js:142` — el endpoint que lista sprites devuelve rutas **absolutas same-origin**:
```js
return {
    label: label,
    path: `/characters/${name}/${file}` + (mtime ? `?t=${mtime}` : ''),
};
```
Y la extensión Expressions las mete tal cual en un `<img>` (`public/scripts/extensions/expressions/index.js:2175`):
```html
<img id="expression-image" class="expression">
```
Es exactamente la misma clase de ruta que necesitamos, y **funciona hoy**.

**Segunda evidencia — la extensión Gallery ya usa rutas relativas:**

`public/scripts/extensions/gallery/index.js:133`
```js
src: `user/images/${url}/${file}`,   // ruta RELATIVA, sin host
```
Esto también funciona: ST se sirve en `/`, así que el navegador resuelve `user/images/foo/bar.png` contra el origen → `/user/images/foo/bar.png` → cae en la ruta de `users.js:1217`. **Esto refina el hallazgo previo #6 del encargo**: `data/` no se sirve con `express.static`, pero sí se sirve con el router de `users.js`. El `express.static` de `server-main.js:242` solo cubre `public/`, pero las rutas de datos de usuario tienen su propio router dedicado y montado.

**Tercera evidencia — el endpoint de subida devuelve una URL directamente utilizable:**

`src/endpoints/images.js:73`
```js
response.send({ path: clientRelativePath(request.user.directories.root, pathToNewFile) });
```
Con `userImages: 'user/images'` (`src/constants.js:25`) y `clientRelativePath` haciendo un simple slice del root (`src/util.js:572-578`), el resultado es `/user/images/<archivo>` o `/user/images/<ch_name>/<archivo>` — **exactamente la ruta servida**.

**Cuarta evidencia — ST ya resuelve rutas locales para avatares de persona:**

`public/scripts/utils.js:1804-1818` (`resolveAvatarData`):
```js
// Local path or URL (e.g., characters/name.png) - fetch from ST server or same origin
// Supported paths: /characters/*, /backgrounds/*, /User Avatars/*, /assets/*, /user/images/*
if (trimmed.includes('/') || trimmed.endsWith('.png')) {
    let url = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    ...
    if (!url.includes('/', 1)) { url = '/characters/' + trimmed; }
    const response = await fetch(url);
```
Es un resolver de rutas de usuario **ya escrito y mantenido por ST**, que documenta explícitamente el conjunto de rutas servidas. Extrae esa misma lista y la tienes.

#### (b) Adjuntos de mensaje (`mes.extra.media`) — la vía oficial

ST tiene un sistema de media de primera clase, totalmente fuera del sanitizador:

`public/global.d.ts:111-137`
```ts
media?: MediaAttachment[],
...
type MediaAttachment = MediaAttachmentProps & ImageGenerationAttachmentProps & ImageCaptionAttachmentProps;
interface MediaAttachmentProps {
    url: string;
    title?: string;
    type: string;
    source?: string;
}
```

Renderizado en `public/script.js:2200-2214` con jQuery puro — **no pasa por DOMPurify en absoluto**:
```js
function appendImageAttachment(attachment, index) {
    const template = $('#message_image_template .mes_img_container').clone();
    template.attr('data-index', index);
    const image = template.find('.mes_img');
    image.attr('src', attachment.url);          // ← URL servida, sin sanitizar
    image.attr('title', attachment.title || mes.extra.title || '');
```

Es la vía del botón "**Embed File** / **Image**" documentado en https://docs.sillytavern.app/extensions/captioning/ ("Attach an image file to a message using the Embed File or Image button in the actions of a message"), y alimenta todo el pipeline multimodal/captioning/STABLE Diffusion.

Constantes: `MEDIA_DISPLAY` en `public/scripts/constants.js:86`, `MEDIA_TYPE` en `public/scripts/constants.js:103`.

---

### 2. ¿Cuál es la postura/arquitectura de ST respecto a esto? ¿Omisión deliberada?

**Omisión, no diseño deliberado. Evidencia:**

- **Issue #4767 — "[FEATURE REQUEST] 'Display local images in the message"** — abierto desde **2025-11-14**, labels `🦄 Feature Request` + `⚰️ Stale`, **cero respuesta de mantenedores**. El texto del issue pide exactamente lo que buscamos y señala a RisuAI como referencia. El bot de repo solo añadió el recordatorio de inactividad (2026-05-17).
  https://github.com/SillyTavern/SillyTavern/issues/4767

- **Issue #5878 — "[RFC] Character Card Spec v3.1"** — abierto, y en la especificación propuesta se dice explícitamente:
  > **`vrm_model_url`** *(string, optional)*: **URL or relative path** to a 3D VRM / GLB model file.

  Es decir: hoy el spec **no** soporta rutas relativas en contenido de tarjeta, y está *proponiéndose* añadirlas. Refuerza que la ausencia es histórica, no intencional.
  https://github.com/SillyTavern/SillyTavern/issues/5878

- **Sin respuesta a búsquedas en el tracker.** `gh search issues` con `"embedded://"`, `"charx embedded assets"`, `"markdown image src"`, `"forbid_external_media"` en `SillyTavern/SillyTavern` no devuelve **ningún** issue/PR sobre resolver URIs embebidas en el texto de mensajes. No hay ni un intento archivado.

- **La arquitectura sí contempla las tres piezas por separado**: capa de servidor (rutas de archivos de usuario), capa de adjuntos (`extra.media`), y —desde 1.19.0— capa de hook de renderizado (`MessageFormatter`). Lo único que falta es el pegamento de nivel texto.

---

### 3. ¿Hay una forma EN supported/oficial de achieveir esto, aunque sea indirecta?

**Sí: `mes.extra.media` (adjuntos).** Es la única vía oficialmente soportada, documentada y con UI. Flujo:

1. Botón "Embed File/Image" en las acciones del mensaje
2. `uploadFileAttachment()` — `public/scripts/chats.js:274-296` → `POST /api/files/upload` con `{name, data}` (base64)
3. `src/endpoints/files.js:28-52` guarda en `request.user.directories.files` y devuelve `{path}` vía `clientRelativePath` → `/user/files/<nombre>`
4. `public/scripts/chats.js:252-257` lo mete en `message.extra.files[]`
5. Para imágenes hay una vía más directa: `POST /api/images/upload` (`src/endpoints/images.js:39-78`) → `/user/images/...`

Y para imágenes, la forma canónica de `extra.media` es:
```js
message.extra.media.push({ type: 'image', url: '/user/images/Seraphina/escena.png' });
```

**Limitación importante**: no es "una imagen dentro del texto". Es un bloque de media adjunto al mensaje, con su propia UI (galería, swipes, contador). No controlas la posición relativa dentro del texto, y queda persistido en el JSONL del chat.

La vía del markdown con ruta absoluta **no está documentada** en ningún lado de docs.sillytavern.app, aunque funciona. Hay que tratarla como semi-oficial.

---

### 4. ¿Han otros implementado algo parecido? ¿Qué enfoque usaron?

**RisuAI — dos mecanismos distintos, y ST importó uno de ellos a medias:**

**(i) Assets embebidos por URI en la tarjeta.** El propio código de ST lo admite, `src/charx.js:9-10`:
```js
// 'embeded://' is intentional - RisuAI exports use this misspelling
const CHARX_EMBEDDED_URI_PREFIXES = ['embeded://', 'embedded://', '__asset:'];
```
Es la **spec de tarjeta de RisuAI**: el campo `data.assets[].uri` contiene `embeded://ruta/dentro/del.zip`, y el archivo está embebido en el ZIP de la tarjeta.

> **CONFIRMADO (refina el hallazgo previo #7):** ST lee esas URIs **solo** para extraer los archivos del ZIP. `collectCharXAssets()` — `src/charx.js:172-200`:
> ```js
> collectCharXAssets(card) {
>     const assets = _.get(card, 'data.assets');   // ← ÚNICO sitio que se lee
>     if (!Array.isArray(assets)) { return []; }
>     return assets.map((asset, index) => {
>         const zipPath = this.getEmbeddedZipPathFromUri(asset.uri);
>         ...
> ```
> Nunca escanea `first_mes`, `mes_example`, `alternate_greetings` ni `extra`. El texto de los mensajes **no se reescribe en ningún momento**. Lo único que queda es el texto tal cual.

Y ahí está la asimetría: **ST importó la mitad de extracción del CharX de RisuAI, pero no la mitad de renderizado.** Los archivos salen a disco (`src/charx.js:309-380`, `persistCharXAssets`) y el texto sigue diciendo `embeded://...`, que luego DOMPurify elimina. Es un hueco funcional, no una decisión.

**(ii) Marcadores de imagen tipo Post-History Instructions.** Del issue #4767:
> "In one or more other similar character chat programs, I found that they use settings similar to our 'Post-History Instructions' to display local images in messages"
> ```
> [<img="Serena"> | Serena Eve | Head of the Augusta Family | Augusta Family ]
> ```
> "The actual role‑playing application address of this example: **https://risuai.xyz/**"

Es decir: RisuAI combina un PHI que instruye al modelo a emitir un token `<img="Nombre">`, y un resolver cliente que lo convierte en una imagen local.

**ST no tiene nada equivalente.** Lo más cercano es la extensión Expressions, que es un overlay fuera del mensaje y controlado por reglas/prompt, no por tokens del modelo.

---

### 5. Si implementáramos un hook `uponSanitizeAttribute` con `case 'src'`, ¿hay problemas técnicos previsibles?

**El hook funciona técnicamente — verificado contra el código fuente de DOMPurify 3.4.2.** Pero tiene cinco.matices que hay que conocer.

#### ✅ El orden del hook es correcto (esto era la duda principal)

`node_modules/dompurify` es `^3.4.2` (`package.json:48`). En `dist/purify.cjs`, `_sanitizeAttributes` (L1147) hace:

```js
_executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
value = hookEvent.attrValue;                       // ← toma el valor REESCRITO
...
if (!_isValidAttribute(lcTag, lcName, value)) {    // ← valida DESPUÉS
    _removeAttribute(name, currentNode);
    continue;
}
```

Es decir: **`uponSanitizeAttribute` se ejecuta ANTES de la validación de URI, y el valor reescrito es el que se valida y el que se escribe de vuelta.** Reescribir `data.attrValue` funciona. Además existe `hookEvent.forceKeepAttr = true` para saltarse la validación por completo.

#### ⚠️ Riesgo 1 — Por qué hace falta el hook: `embedded://` es RECHAZADO por DOMPurify

`IS_ALLOWED_URI` por defecto (purify.cjs:282):
```js
/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
```

| `src` | Resultado | Motivo |
|---|---|---|
| `/characters/x.png` | ✅ pasa | empieza con `/` → rama `[^a-z]` |
| `user/images/x.png` | ✅ pasa | `user` casa `[a-z+.\-]+`, luego `/` casa `[^a-z+.\-:]` |
| `https://...` | ✅ pasa | esquema en la lista |
| `data:image/png;base64,...` | ✅ pasa | caso especial purify.cjs:1117 + `DATA_URI_TAGS` incluye `img` (L561) |
| `embedded://x.png` | ❌ **BLOQUEADO** | `embedded` casa `[a-z+.\-]+`, pero el siguiente char es `:` — excluido de `[^a-z+.\-:]` y no es fin de cadena |

**ST no define `ALLOWED_URI_REGEXP` en ninguna de sus dos configs de sanitización de mensajes** (`public/script.js:1899-1906` y `public/scripts/chats.js:689-695`; solo `RETURN_*`, `MESSAGE_SANITIZE`, `ADD_TAGS`), así que se aplica el default. Por eso `embedded://` desaparece y hace falta un hook o un stage previo.

#### ⚠️ Riesgo 2 — Los hooks de DOMPurify son GLOBALES e IRREMOVIBLES

`DOMPurify.addHook()` muta la instancia compartida (`SillyTavern.libs.DOMPurify`). **No existe `removeHook`**. La única forma de limpiar es `removeAllHooks()`, que **rompería los hooks de ST** (`chats.js:1903`, `1910`, `1937`).

Consecuencia: el hook vive toda la sesión. Aceptable, pero hay que hacerlo **idempotente** (registrar una sola vez) y **puro** (sin estado que crezca en cada render).

#### ⚠️ Riesgo 3 — Guardar con `config.MESSAGE_SANITIZE`

ST usa un flag propio en la config para activar sus hooks de mensaje (`public/global.d.ts:243-249`):
```ts
declare module 'dompurify' {
    interface Config {
        MESSAGE_SANITIZE?: boolean;
        MESSAGE_ALLOW_SYSTEM_UI?: boolean;
    }
}
```
Sin ese guard, tu hook se dispararía también en `Popup`, plantillas, `templates.js:77`, `slash-commands.js:4580`, etc. — sanitizaciones que **no** son mensajes.

#### ⚠️ Riesgo 4 — `uponSanitizeElement` corre antes que `uponSanitizeAttribute`

`chats.js:1937` (el que hace `node.remove()` por media externa) es `uponSanitizeElement`, que DOMPurify ejecuta en `_sanitizeElements` — **antes** de `_sanitizeAttributes`. Es decir: **ST bloquea la imagen antes de que tú puedas reescribir su `src`.**

En la práctica **no es un problema** para nuestro caso, porque `isExternalUrl()` (`utils.js:187-189`) devuelve `false` para `/characters/...` y para `user/images/...` (no tienen `://` ni `//` inicial). Pero sí lo sería si quisiéramos resolver un `https://` externo a local.

#### ⚠️ Riesgo 5 — El texto del mensaje se usa para mucho más que para renderizar

`mes` alimenta: el prompt del LLM, la exportación de chat, TTS, captioning, el historial de swipes, y el guardado en JSONL. **Reescribir solo en render** (sin mutar `chat[i].mes`) es obligatorio; mutar el objeto contaminaría el prompt y los exports.

---

### 6. ¿Hay Content-Security-Policy en ST? ¿Bloquea `img-src` o `data:`?

**No hay CSP. Ninguna.**

`src/server-main.js:104-106`:
```js
app.use(helmet({
    contentSecurityPolicy: false,   // ← CSP DESHABILITADO explícitamente
}));
```

**Verificado idéntico en el tag 1.19.0** (`git show 1.19.0:src/server-main.js` → mismas líneas 104-106).

Consecuencias:
- No existe directiva `img-src` → nada restringe `<img src=...>`.
- No hay `default-src` → **no hay restricción de `data:` URIs**.
- Helmet sí aplica sus otros headers por defecto (`X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, etc.), pero son irrelevantes para carga de imágenes.

**No hay ningún problema de CSP para ninguna de las opciones de implementación.**

---

### 7. ¿Existe algún registry de extensiones que ya intercepte el renderizado de mensajes?

**Sí, dos — y uno es exactamente lo que necesitamos, pero solo desde 1.19.0.**

#### (a) `MessageFormatter` — API oficial, **ST ≥ 1.19.0** ⭐

Commit `060f224f28c67273aec54319aa1f13c18e55424e` — *"Add `MessageFormatter`: a structured hook system for extensions to transform message content pre-DOM (#5652)"* — Wolfsblvt, 2026-05-18.

- Verificado: `git merge-base --is-ancestor 060f224f2 1.19.0` → **sí está en 1.19.0**
- Verificado: `git merge-base --is-ancestor 060f224f2 release` (local, 1.18.0) → **NO está en 1.18.0**

Fichero: `public/scripts/message-formatter.js` (259 líneas).

**Expuesto en el contexto** — `public/scripts/st-context.js:113,246` (1.19.0):
```js
import { MessageFormatter } from './message-formatter.js';
...
messageFormatter: MessageFormatter,
```

**API** (de `message-formatter.js`):
```js
messageFormatter.addHook(fn, { stage = 'afterMarkdown', order = 50 })
messageFormatter.runStage(stage, mes, base)
messageFormatter.format(mes, characterName, isSystem, isUser, messageId, sanitizerOverrides, isReasoning)
messageFormatter.stage   // { BEFORE_REGEX, AFTER_REGEX, AFTER_MARKDOWN }
messageFormatter.order   // { EARLIEST:0, EARLY:10, NORMAL:50, LATE:90, LATEST:100 }
```

Características relevantes:
- Hooks **sincrónicos** (lanzar `TypeError` si es `async`; si devuelve no-string, se ignora con warning).
- `ctx` es `Object.freeze({characterName, isSystem, isUser, messageId, isReasoning, stage})`.
- Cada hook va en `try/catch`; un error se loguea y el pipeline continúa.
- **"There is intentionally no post-sanitize stage"** — por diseño, para evitar vectores XSS. Los 3 stages corren **antes** de DOMPurify.

Documentado en https://docs.sillytavern.app/for-contributors/writing-extensions/ (sección "Message formatting hooks").

#### (b) Hooks de DOMPurify — punto de extensión global, todas las versiones

`DOMPurify.addHook(...)` es global y shared. ST mismo lo usa (`chats.js:1903/1910/1937`). Funciona en 1.18.0 y en 1.19.0. No está documentado como API pública, pero es estable (el internal `_sanitizeAttributes` no ha cambiado).

#### (c) Eventos de post-render (último recurso)

`event_types.USER_MESSAGE_RENDERED` y `CHARACTER_MESSAGE_RENDERED` permiten manipular el DOM ya insertado. **Demasiado tarde** para arreglar un `src` roto (ya se pidió el recurso y va a fallar → flash de imagen rota), pero útil para正常的xygen customization.

#### (d) Lo que **no** existe

`STTranslatorModules` es solo lo que expone nuestro propio `src/index.js:33` (`window.STTranslatorModules = { utils, providers, png, characters, ui, settings }`). No es un registry de ST.

---

## Diagrama del pipeline de renderizado de mensajes

### ST 1.19.0 (con MessageFormatter)

```
chat[i].mes  (texto crudo, persistido en JSONL)
   │
   │  printMessages()                    script.js:1475
   │  └─► addOneMessage(mes)             script.js:2492
   │        └─► getMessageTextHTML(msg)  script.js:2464
   │              └─► messageFormatting(mes, name, isSystem, isUser,
   │                                 messageId, sanitizerOverrides, isReasoning)
   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    messageFormatting()  script.js:1753                │
├──────────────────────────────────────────────────────────────────────┤
│  1. Prompt-bias stripping (solo mensaje 0)                          │
│  2. Normalización de comentarios / hidden                            │
│  3. ★ MessageFormatter.runStage(BEFORE_REGEX)   script.js:1855      │
│  4. Custom regex rules  (getRegexedString)    script.js:~1860        │
│  5. ★ MessageFormatter.runStage(AFTER_REGEX)    script.js:1866      │
│  6. Markdown auto-fix (fixMarkdown)                                 │
│  7. HTML tag encoding (encode_tags)                                 │
│  8. Showdown: Markdown → HTML   (converter.makeHtml)  script.js:~1919│
│  9. ★ MessageFormatter.runStage(AFTER_MARKDOWN)  script.js:1948      │
│         ▲                                                              │
│         │  >>> AQUÍ va nuestro resolver de embedded://                 │
│         │      "![](embedded://a.png)" ya es <img src="embedded://a.png">│
│ 10. Name-prefix stripping (allow_name2_display)                      │
│ 11. DOMPurify.sanitize(mes, config)              script.js:~1957     │
│         │                                                              │
│         ├─► _sanitizeElements  →  uponSanitizeElement   purify.cjs:1004│
│         │        └─ ST: chats.js:1937 — IMG + isExternalUrl()          │
│         │           → node.remove() si es externo y media prohibida    │
│         │                                                              │
│         └─► _sanitizeAttributes → uponSanitizeAttribute  purify.cjs:~1180
│                  └─ ST: chats.js:1910 — switch(attrName) case 'class'│
│                  └─ ★ AQUÍ alternativamente: nuestro case 'src'        │
│         ▼                                                              │
│      _isValidAttribute(lcTag, lcName, value)    purify.cjs:~1120      │
│         IS_ALLOWED_URI (default) — rechaza embedded://                 │
│      decodeStyleTags(mes, {prefix:'.mes_text '})                       │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼  string HTML
messageElement.find('.mes_text').html(messageHTML)   script.js:2637
   │
   ▼  DOM real → el browser pide /user/images/... o /characters/...
      users.js:1217 / users.js:1214  →  res.sendFile(...)
```

### Rutas servidas (users.js:1213-1219, montadas en server-startup.js:141)

```
                     ┌─ /backgrounds/*      → data/<user>/backgrounds/
                     ├─ /characters/*        → data/<user>/characters/
petición HTTP ───────┼─ /User Avatars/*      → data/<user>/User Avatars/
  (cookie de sesión) ├─ /assets/*            → data/<user>/assets/
                     ├─ /user/images/*       → data/<user>/user/images/    ← CharX misc
                     ├─ /user/files/*        → data/<user>/user/files/
                     └─ /scripts/extensions/third-party/*
                              │
                              └─ createRouteHandler() users.js:1065-1085
                                 · decodeURIComponent(req.params[0])
                                 · isPathUnderParent() → 403 si traversal
                                 · res.sendFile(filePath, {root: directory})
```

### Dónde acaba cada tipo de asset de un CharX

```
CharX .cardx (ZIP)
   └── card.json
        ├── data.assets[]  { uri: "embeded://ruta/en/el.zip", type, name, ext }
        │      │
        │      └── collectCharXAssets()      charx.js:172   ← ÚNICO consumidor de la URI
        │             getEmbeddedZipPathFromUri()
        ▼
   persistCharXAssets()   charx.js:309
        ├── type emotion/expression ──► data/<user>/characters/<Char>/<name>.png
        │                                   servible en /characters/<Char>/<name>.png
        └── misc ───────────────────────► data/<user>/user/images/<Char>/<name>.png
                                            servible en /user/images/<Char>/<name>.png
   ⚠ data.first_mes  ── NO se toca ── sigue diciendo "embeded://..." en el texto
```

---

## Opciones de implementación

### Opción A — `MessageFormatter.addHook` en stage `afterMarkdown`  ⭐ RECOMENDADA

```js
// En init() de la extensión (solo si ST >= 1.19.0)
const { messageFormatter } = SillyTavern.getContext();
messageFormatter.addHook((mes, ctx) => {
    // reescribir embedded://... → /user/images/<charName>/...
    return mes.replace(/src="embedded:\/\/([^"]+)"/g, (m, p) => `src="/user/images/${charName}/${p}"`);
}, { stage: messageFormatter.stage.AFTER_MARKDOWN, order: messageFormatter.order.EARLY });
```

| | |
|---|---|
| **Pros** | API oficial y documentada · Orden determinista (`order`) · Errores aislados en try/catch por hook · Sin mutación global · Sin tocar `chats.js` · El output sigue pasando por DOMPurify (defensa en profundidad) · Reutilizable por otras extensiones |
| **Contras** | Requiere **ST ≥ 1.19.0** (el checkout local es 1.18.0 → hay que actualizar o hacer fallback) · Solo síncrono (no hay `await` para un fetch de comprobación) · Trabaja con strings: hay que usar regex sobre HTML, no un DOM |
| **Riesgos** | Bajo. El regex debe decodificar/entregar correctamente. Nombre de personaje con espacios/caracteres especiales → hay que codificar con `encodeURI` |

---

### Opción B — Hook `DOMPurify.addHook('uponSanitizeAttribute')` con `case 'src'`

```js
DOMPurify.addHook('uponSanitizeAttribute', (node, data, config) => {
    if (!config.MESSAGE_SANITIZE) return;              // guard obligatorio
    if (data.attrName !== 'src' || !node.tagName) return;
    if (node.tagName === 'IMG' && /^(embedded|__asset):\/\//i.test(data.attrValue)) {
        data.attrValue = resolver(data.attrValue);
    }
});
```

| | |
|---|---|
| **Pros** | Funciona en **todas** las versiones (1.18.0 incluida) · Opera sobre el atributo ya parseado, no sobre HTML con regex → robusto ante rarezas de showdown · Es exactamente el punto que ya usa ST (`chats.js:1910`) |
| **Contras** | Hook **global e irremovible** (no hay `removeHook`) · API no documentada → riesgo de rotura en futuras versiones de DOMPurify · Hay que acordarse del guard `MESSAGE_SANITIZE` o se filtra a Popups/plantillas |

---

### Opción C — `mes.extra.media` (adjuntos oficiales)

```js
chat[i].extra.media.push({ type: 'image', url: '/user/images/Seraphina/escena.png' });
```

| | |
|---|---|
| **Pros** | 100% soportado, con UI propia (galería, swipes, contador) · **Fuera de DOMPurify** → immune a cualquier cambio de sanitización · Alimenta el pipeline multimodal/captioning/SD · Es el formato que Data Maid reconoce (ver riesgo) |
| **Contras** | No es una imagen *dentro* del texto: es un bloque aparte, posición no controlable · Persiste en el JSONL del chat (ensucia la tarjeta si se exporta) · Pierde el layout inline del markdown |

---

### Opción D — Post-proceso DOM en `CHARACTER_MESSAGE_RENDERED`

| | |
|---|---|
| **Pros** | Cero API interna, solo eventos públicos |
| **Contras** | **Demasiado tarde**: el `src` roto ya se pidió → flash de imagen rota en cada render. Además hay que re-aplicar en cada re-render (streaming, swipe, edición). **Descartada** salvo como parche de emergencia |

---

## Recomendación

**Opción A como camino principal + Opción B como fallback para 1.18.x.** Son complementarias, no excluyentes:

1. **Si `getContext().messageFormatter` existe (ST ≥ 1.19.0)** → registrar hook en `afterMarkdown` con `order: EARLY`. Es la vía soportada, ordenada y sin efectos globales.
2. **Si no existe (ST 1.18.x)** → caer al hook de DOMPurify con el guard `config.MESSAGE_SANITIZE`.
3. **Si ninguna de las dos está disponible** → no registrar nada y avisar al usuario (mejor no hacer un post-proceso frágil).

**¿Por qué esta combinación?**

- La **Opción A** es lo que ST quiere: un punto de extensión de primera clase, con orden determinista, aislamiento de errores, y por diseño antes del sanitizador. Además es *documentado*, así que no depende de detalles internos que puedan cambiar.
- La **Opción B** es necesaria **solo** por el desfase de versión. El `manifest.json` de nuestra extensión declara `"minimum_client_version": "1.0.0"`, así que hay usuarios en 1.18.x. Es un guard de ~10 líneas detrás de un `if`.
- La **Opción C** no se descarta: es complementaria. Si el caso de uso es "la imagen acompaña al mensaje" (no "inline en el texto"), `extra.media` es objetivamente mejor y no deberíaorzarse.

**Sobre la Opción A en la práctica:** el hook es síncrono y el punto correcto (`afterMarkdown`) es *antes* de DOMPurify. Eso significa que reescribir el `src` a `/user/images/...` **no depende de que el hook evite la validación** — DOMPurify acepta rutas relativas/absolutas same-origin por default (verificado arriba). El hook solo tiene que producir una URL servible. Esto reduce mucho el riesgo: no estamosominiendo reglas de sanitización, estamos crackeando una URL que ST sirve por diseño.

**Diseño de datos recomendado (decisión de arquitectura, no implementada aquí):**

- Mantener `embedded://<nombre>` **en el texto de la tarjeta**. Es portable (funciona si el usuario abre la tarjeta en RisuAI) y no ensucia con rutas absolutas específicas de una instalación.
- **Resolver solo en render**, nunca mutar `chat[i].mes` (si no, el prompt enviado al LLM, los exports y el TTS se contaminan).
- Resolver contra el directorio donde ST **ya** puso los archivos al importar el CharX:
  - assets de tipo `emotion`/`expression` → `/characters/<CharName>/<file>.png`
  - assets `misc` → `/user/images/<CharName>/<file>.png`
  - esto sale directo de `src/charx.js:323` y `src/charx.js:336`.

**⚠️ Riesgo operativo que hay que conocer antes de decidir — Data Maid:**

`src/endpoints/data-maid.js:185-230` marca como "sueltos" y **borra** los archivos de `user/images/` que no estén referenciados en:
- `extra.media[].url` (L192-198) ✅
- `extra.image` (deprecated) (L~180)
- `extra.image_swipes` (deprecated) (L187-190)
- `chat_metadata.chat_backgrounds` (L200-207)

**No reconoce imágenes referenciadas dentro del texto de `mes`.** Consecuencia: si la extensión resuelve `embedded://` → `/user/images/<Char>/x.png` **solo en render** y nunca registra el archivo en `extra.media`, un barrido de Data Maid puede **borrar el archivo del disco** y la imagen se romperá de forma permanente.

Dos salidas:
- **(i)** Registrar además la imagen en `extra.media` (mezcla de Opción A + C) — es la que evita Data Maid, y de paso activa captioning/multimodal.
- **(ii)** Asumir el riesgo y documentarlo.

Dado que `extra.media` ya es la vía oficial y Data Maid la reconoce, **(i) es claramente superior** y no cuesta casi nada.

**Verificación pendiente antes de implementar:** los assets "misc" de un CharX importado (`data/<user>/user/images/<Char>/`) quedan en el mismo árbol que la galería del usuario, así que **sí caen dentro del alcance de Data Maid**. Conviene confirmar esto empíricamente antes de depender de él, o marcar esos archivos de forma que Data Maid los respete.

---

## Hallazgos que contradicen o refinan lo que ya sabíamos

| # | Hallazgo previo | Corrección / refinamiento |
|---|---|---|
| 1 | "6. `express.static` en `src/server-main.js:242` solo sirve `public/`. El directorio `data/` **NO** se sirve estáticamente." | **Correcto pero incompleto, y la conclusión cambia.** `data/` no se sirve por `express.static`, pero **sí** por un router dedicado: `src/users.js:1213-1219` monta 7 rutas de datos de usuario, y `src/server-startup.js:141` las cuelga en la raíz con `app.use('/', userDataRouter)`. `/user/images/*` y `/characters/*` **son servibles**. Esto es la pieza que faltaba y es la que hace viable todo lo demás. |
| 2 | "5. Gallery construye `user/images/...` como ruta RELATIVA" | **Confirmado, y funciona.** No es un bug: el navegador la resuelve contra el origen y cae en `users.js:1217`. La extensión Expressions en cambio usa ruta **absoluta** (`/characters/<n>/<f>`), vía `sprites.js:142`. Ambas formas son válidas; la absoluta es más robusta. |
| 3 | "7. CharX reconoce `embeded://` SOLO para extraer" | **Confirmado al 100%.** `collectCharXAssets()` (`charx.js:172-200`) lee exclusivamente `_.get(card, 'data.assets')` y su `asset.uri`. El texto de los mensajes nunca se escanea ni se reescribe. Añádase que el resultado es un **hueco funcional Importado a medias**: ST trae la mitad de extracción de RisuAI, no la de renderizado. |
| 4 | "8. `processImageAttachment()` solo aplica a imágenes generadas en conversación" | **Confirmado y complementado:** el mecanismo relevante no es ese helper sino `mes.extra.media` (`global.d.ts:111-137`, render en `script.js:2200-2214`), que es de primera clase, está **fuera de DOMPurify**, y es lo que usa el botón "Embed File". Es la vía oficial que no estaba en la lista. |
| 5 | (no estaba considerado) | **ST 1.19.0 (2026-09-14) añadió `MessageFormatter`** — la API oficial de hooks de renderizado de mensajes, expuesta en `getContext().messageFormatter`, con stage `afterMarkdown` justo antes de DOMPurify. **El checkout local (1.18.0) no la tiene.** Esto cambia la respuesta de la pregunta 7 y sostiene la recomendación. |
| 6 | (no estaba considerado) | **`/api/images/upload` ya devuelve una URL directamente servible** (`images.js:73` + `constants.js:25` → `/user/images/...`). No hace falta construir la ruta a mano para imágenes subidas por la extensión. |
| 7 | (no estaba considerado) | **Data Maid borra archivos de `user/images/` no referenciados en `extra.media`/`extra.image`/`extra.image_swipes`/`chat_backgrounds`** (`data-maid.js:185-230`). Resolver `embedded://` solo en render, sin tocar `extra.media`, expone los archivos a borrado. Riesgo operativo real. |
| 8 | (no estaba considerado) | **El hook `uponSanitizeAttribute` sí es un punto de extensión válido** — verificado en el código fuente de DOMPurify 3.4.2: el hook corre antes de `_isValidAttribute`, y el valor reescrito es el validado. La preocupación sobre el orden de hooks queda despejada. |
| 9 | (no estaba considerado) | **`embedded://` es rechazado por el `IS_ALLOWED_URI` por defecto de DOMPurify** (`purify.cjs:282`) — el `:` tras `[a-z+.-]+` no casa ninguna rama. Confirma que hace falta un hook; no se puede confiar en que "ya pase". En cambio `/characters/...`, `user/images/...` y `data:image/...` **sí** pasan sin tocar nada. |
| 10 | (no estaba considerado) | **No hay CSP** — `helmet({ contentSecurityPolicy: false })` en `server-main.js:104-106`, sin cambios en 1.19.0. Elimina toda una categoría de riesgos. |
| 11 | (no estaba considerado) | **El propio ST ya resuelve rutas de usuario para avatares** (`utils.js:1782-1841`, `resolveAvatarData`), y documenta en un comentario la lista exacta de rutas servidas. Es un resolver de referencia ya escrito y mantenido por ST. |

---

## Fuentes

**Código (SillyTavern @ `release` = 1.18.0, y `@ 1.19.0`)**
- `src/users.js:1213-1219` — router de archivos de usuario
- `src/users.js:1065-1085` — `createRouteHandler`
- `src/server-startup.js:141` — montaje en raíz
- `src/server-main.js:104-106` — helmet sin CSP; `:242` — `express.static`; `:248` — `requireLoginMiddleware`
- `src/endpoints/sprites.js:142` — sprites como `/characters/<n>/<f>`
- `src/endpoints/images.js:39-78` — `/api/images/upload`
- `src/endpoints/files.js:28-52` — `/api/files/upload`
- `src/constants.js:25,43` — `userImages: 'user/images'`, `files: 'user/files'`
- `src/util.js:572-578` — `clientRelativePath`
- `src/charx.js:9-10,172-200,309-380` — prefijos URI, `collectCharXAssets`, `persistCharXAssets`
- `src/endpoints/data-maid.js:185-230` — limpieza de `user/images`
- `public/script.js:1753-1960` — `messageFormatting`; `:2200-2214` — `appendImageAttachment`; `:2464-2478` — `getMessageTextHTML`; `:2492-2637` — `addOneMessage`
- `public/scripts/chats.js:689-703` — `formatCreatorNotes`; `:1910-1935` — `uponSanitizeAttribute`; `:1937-2051` — `uponSanitizeElement`; `:852-867` — `isExternalMediaAllowed`; `:274-296` — `uploadFileAttachment`
- `public/scripts/utils.js:187-189` — `isExternalUrl`; `:1782-1841` — `resolveAvatarData`
- `public/global.d.ts:111-150,243-249` — `MediaAttachment`, flags de DOMPurify
- `public/scripts/constants.js:86-113` — `MEDIA_DISPLAY`, `MEDIA_TYPE`
- `public/scripts/extensions/gallery/index.js:132-134` — rutas relativas
- `public/scripts/extensions/expressions/index.js:2175` — `<img id="expression-image">`
- `1.19.0: public/scripts/message-formatter.js` (259 líneas) — API completa
- `1.19.0: public/scripts/st-context.js:113,246` — exposición en `getContext()`
- `1.19.0: public/script.js:1855,1866,1948` — `runStage` en el pipeline

**DOMPurify 3.4.2** (`https://unpkg.com/dompurify@3.4.2/dist/purify.cjs`)
- L282 — `IS_ALLOWED_URI`
- L561 — `DEFAULT_DATA_URI_TAGS` (incluye `img`)
- L1004 — `uponSanitizeElement` en `_sanitizeElements`
- L1147+ — `_sanitizeAttributes`; orden `uponSanitizeAttribute` → `_isValidAttribute`
- L1117 — caso especial `data:` para `src`/`href`/`xlink:href`

**Issues / web**
- https://github.com/SillyTavern/SillyTavern/issues/4767 — "Display local images in the message" (abierto, stale, sin respuesta de mantenedores; referencia a RisuAI)
- https://github.com/SillyTavern/SillyTavern/issues/5878 — RFC Character Card v3.1 (propone "URL or relative path")
- PR/commit `060f224f2` — "Add `MessageFormatter`" (#5652, 2026-05-18)
- https://docs.sillytavern.app/for-contributors/writing-extensions/ — sección "Message formatting hooks"
- https://docs.sillytavern.app/extensions/captioning/ — botón "Embed File or Image"
- https://docs.sillytavern.app/usage/user-settings/ — "Forbid External Media"; nota sobre Data Maid borrando `user/images` y `user/files` no asociados
- https://www.reddit.com/r/SillyTavernAI/comments/1kygp5f/ — imágenes markdown no visibles por `forbid_external_media` (activo por defecto en versiones nuevas)
- https://risuai.xyz/ — plataforma de referencia en el issue #4767
