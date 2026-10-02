# Temas de ST que replican tipsy.chat y juicychat.ai

Dos temas JSON del sistema nativo de SillyTavern que reproducen la WebUI de
esos dos sitios. Los colores salen de las hojas de estilo reales de cada web
(ver `~/work/ui-analysis/INFORME.md`), no de ojo.

## Archivos

| Archivo | Qué es |
|---|---|
| `generar.mjs` | Genera los dos JSON. Convierte hex+alfa a `rgba()` y compone el `custom_css`. Edita aquí, no el JSON a mano. |
| `Tipsy.chat.json` | Tema de tipsy.chat |
| `JuicyChat.ai.json` | Tema de juicychat.ai |
| `*.png` | Capturas de cómo queda cada tema (renderizadas con el mismo pipeline de ST) |

Regenerar: `node generar.mjs`

## Instalados

Los dos ya están en `data/default-user/themes/` de ST. Para volver a instalarlos
tras editar:

```bash
cd /mnt/vm/SillyTavern
node -e "
import fs from 'node:fs';
const jar = []; const store = r => { for (const c of (r.headers.getSetCookie?.()||[])) jar.push(c.split(';')[0]); };
const H = () => ({ Cookie: jar.join('; ') });
let r = await fetch('http://127.0.0.1:8005/csrf-token', { headers: H() }); store(r);
const { token } = await r.json();
for (const f of ['Tipsy.chat.json','JuicyChat.ai.json'])
  await fetch('http://127.0.0.1:8005/api/themes/save', { method:'POST',
    headers:{'Content-Type':'application/json','X-CSRF-Token':token, ...H()},
    body: JSON.stringify(JSON.parse(fs.readFileSync('/mnt/src_file/desarrollo_git/ST-translate-data/temas-st/'+f,'utf8'))) });
"
```

Para aplicarlos: *Ajustes de usuario → Tema de la interfaz* → elegir
`Tipsy.chat` o `JuicyChat.ai`. También por slash command: `/theme Tipsy.chat`.

## Extensiones instaladas

Ambas instaladas vía la API oficial (`POST /api/extensions/install`) en
`data/default-user/extensions/`:

- **Moonlit Echoes Theme** v3.1.1 — añade estilos de mensaje (Echo, Whisper,
  Hush, Ripple, Tide) aparte de Flat/Bubble/Document.
- **Character Style Customizer** v1.0.0 — color y CSS por personaje. Es lo que
  hace falta para el detalle de Tipsy: allí el color de la burbuja es **inline
  por personaje** (medido: Alec `rgba(41,84,173,.8)`, Noah `rgba(89,105,125,.8)`).
  El tema pone el token por defecto `#00000080`; CSC ajusta cada uno.

Auditoría de ambas: sin `eval`, sin `new Function`, sin WebAssembly, sin red
saliente (solo un enlace a docs.sillytavern.app) y sin acceso a cookies. La de
Moonlit usa `localStorage` para sus preferencias, lo normal.

## Qué cubre cada tema

### Lo que resuelve el sistema nativo (sin CSS)

Las burbujas de ST ya se pintan con variables del tema
(`public/css/toggle-dependent.css:304-316`), así que los colores dominantes
salen solos:

| | ST | Tipsy | JuicyChat |
|---|---|---|---|
| Burbuja personaje | `bot_mes_blur_tint_color` | `#00000080` | `#452A6F` |
| Burbuja usuario | `user_mes_blur_tint_color` | `#FFFFFFE6` | `#2B2E4E` |
| Borde | `border_color` | `rgba(255,255,255,.4)` | `#323463` |
| Fondo | `blur_tint_color` | `#231413` | `#02031F` |

Más los flags: `chat_display: 1` (burbujas) y `avatar_style: 0` (circular).

### Lo que sí necesita `custom_css`

- **Geometría de burbuja**: radio con la esquina superior a 0 (el "hocico" que
  apunta al avatar), `width: fit-content`, `max-width` y el `padding` de cada
  sitio.
- **JuicyChat**: `backdrop-filter: blur(8px)`, avatar de 36px con borde, columna
  de chat a 768px, y el formato rico (`h1`-`h6` a 14/22 w700, `strong` a 600, la
  `em` como narración en `#C3ABEA`, `img` a 100% con radio 5px).
- **Tipsy**: el degradado de firma del panel (negro → morado → marrón) y la
  aproximación del fondo cálido con cuatro `radial-gradient`.
- **Tipsy oculta los avatares por mensaje** (`hideChatAvatars_enabled: true`)
  porque el sitio no los tiene: solo uno de 46px en la cabecera del panel.

## Lo que no se pudo replicar

- **Fondo cálido de Tipsy**: en el sitio es un `<svg>` con dos `feGaussianBlur`
  y `body` no tiene `background-color`, así que no existe propiedad CSS que lo
  reproduzca. La aproximación son cuatro halos radiales; se ve parecido, no igual.
- **`backdrop-filter` de JuicyChat**: solo se aprecia si hay imagen de personaje
  detrás de la burbuja, igual que en el sitio.
- **Tipografía de JuicyChat**: declara `"KanunAR+LT"` pero realmente carga
  `Avenir-Medium.otf`, que no es redistribuible. No se cambia la fuente desde el
  tema; habría que hacerlo en el CSS de ST (`--mainFontFamily`).
- **Modo claro**: ninguno de los dos sitios lo tiene en funcionamiento
  (Tipsy lo tiene a medias y roto). Ambos temas son oscuros.

## Cartas de documento completo (el inliner de CSS)

La mayoria de las cartas `content_type: 3` de Tipsy usan solo estilos inline y
ST las renderiza pixel-identico. Pero algunas son un **documento HTML entero**
con un bloque `<style>` que define el diseno con `:root`, `body` y clases
(Three Days on the Widow Ranch, parte de Guillotinea, Contracted to the Ice
Queen, Valerie - Tutor). Esas no sobreviven: ST antepone `.mes_text` a todo
selector, con lo que `:root` pasa a `.mes_text :root` y `body` a `.mes_text body`
— selectores imposibles.

`src/richCssInliner.js` lo resuelve **en el momento de importar**: parsea el
`<style>` con el parser del navegador, resuelve `var(--x)` con las definiciones
de `:root`, calcula la cascada y escribe el resultado como `style="..."` inline
por elemento. ST conserva los estilos inline intactos, asi que el diseno llega.

Solo se inlinean propiedades de **pintura** (color, fondo, tipografia,
bordes, sombra, padding). Las de maquetacion (`position`, `transform`,
`display:flex/grid`, dimensiones) se descartan a proposito: dependen de reglas
que aqui no se resuelven, y aplicarlas produce texto solapado, que es peor que
no aplicar nada. Con solo pintar, el resultado degrada a un documento legible.

Limites que quedan:

- **Las tipografias no se pueden cargar.** El `<link>` de Google Fonts y el
  `@import` los elimina DOMPurify. El `font-family` queda puesto, asi que usa la
  fuente si la tienes instalada y si no cae en el fallback (serif/monospace).
- No se resuelven `@media`, `:hover`, `:nth-*` ni `::before`.
- Los selectores con combinadores hermanos se tratan como descendencia.
- El efecto de pergamino rotado de Widow Ranch se pierde.

## Gotchas

- **`min-height` en `.mes` COLAPSA el mensaje y superpone el texto.** Declarar
  `min-height: 38px` en `.mes` (copiado de la ficha de Tipsy) pisa el `min-height`
  que Moonlit ya define, y el contenedor se queda a 323px mientras su
  `.mes_block` mide 2437px: con `overflow: visible` el texto se derrama encima
  del resto del chat. Medido: `.mes_block - .mes` = **+2055px de desborde**; sin
  esa declaración, -1px. La regla: no declarar propiedades que Moonlit o ST ya
  gestionan en `.mes`/`.mes_block` sin comprobar antes quien manda.
- **`overflow: hidden` en `.mes` ROMPE el desplazamiento del chat.** Puesto en
  `.mes`, el elemento se recorta a la altura de su propia caja (763px) mientras
  su hijo `.mes_block` mide 3541px, así que `#chat` se queda sin desbordamiento
  (`scrollHeight == clientHeight`) y la rueda no tiene nada que desplazar. Se
  quitó de los dos temas. Para recortar las imágenes al radio de la burbuja hay
  que hacerlo sobre `.mes_block`, nunca sobre `.mes`.
- **Moonlit resetea `.mes` a propósito**: `style.css` (~línea 934) trae
  `.mes { background-color: unset !important; border-radius: 0 }` y pinta la
  burbuja sobre `.mes_block` usando `--SmartThemeBotMesBlurTintColor` /
  `--SmartThemeUserMesBlurTintColor`. Por eso:
  - Los **colores** de los temas sí llegan a la burbuja (Moonlit los lee de las
    variables del tema).
  - La **geometría** de los temas (radio, padding, ancho) NO se aplica con
    Moonlit activo: gana Moonlit. Verificado: `.mes_block` queda con
    `border-radius: 5px 20px 20px 40px; padding: 15px 15px 25px`, no con lo que
    digan los temas.
- **Para ver la geometría exacta de los temas**, hay que desactivar Moonlit
  (Extensiones → Moonlit Echoes Theme) y usar un estilo de mensaje nativo
  (Flat / Bubble / Document). `disabledExtensions` **solo se aplica al
  arrancar**: cambiarlo en caliente y recargar no basta, hay que reiniciar ST.
- **Cambiar de tema borra el `custom_css`.** El CSS va embebido en el JSON del
  tema, así que en estos dos archivos viaja con los colores: no se pierde. Pero
  si editas el CSS a mano desde *Ajustes de usuario* y luego aplicas otro tema,
  lo pierdes.
- **Moonlit no declara `minimum_client_version`**, así que ST no puede impedir
  instalarla en una versión incompatible. Verificada contra ST 1.19.0: carga y
  sirve sus ficheros, y sus estilos se aplican.
- **`extractMarkdownImageUrls` solo miraba markdown.** Las imagenes de las
  cartas con formato llegan como `<img src>`, asi que no se descargaban y sus
  sprites quedaban como URLs externas. Corregido: ahora cubre las dos
  sintaxis.
- **El CLI miente en el resumen**: contaba como `ok` los personajes que habian
  fallado, asi que un `3/3 ok` con tres `createImageBitmap is not defined` no
  instalaba nada. Corregido, y ademas pide el avatar ya en PNG via
  images.weserv.nl porque en Node no hay `createImageBitmap` ni `OffscreenCanvas`.
- **CSC crea un `<link>` extra con una ruta mal formada** (`extensions/third-party/SillyTavern-CharStyleCustomizer/styles.css`: sin
  barra inicial, nombre de carpeta y de fichero equivocados) que devuelve 403.
  Es cosmético: su CSS entra igualmente por la vía del manifiesto
  (`third-party_SillyTavern-CharacterStyleCustomizer-css`), que sí funciona. Solo
  ensucia la consola.
