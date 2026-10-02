/**
 * Genera los temas JSON de SillyTavern que replican la WebUI de
 * tipsy.chat y juicychat.ai.
 *
 * Los colores se dan en hex + alfa y se convierten a `rgba(r, g, b, a)`,
 * que es el formato que espera el <input type="color"> de ST y del que
 * `applyThemeColor()` hace `.split('(')[1].split(')')[0].split(',')`.
 *
 * Valores tomados literalmente de las hojas de estilo de cada sitio
 * (ver INFORME.md de ~/work/ui-analysis).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const rgba = (hex, a = 1) => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

// --- ST: enum de estilos (public/scripts/power-user.js:95-106) ---
const AVATAR = { ROUND: 0, RECTANGULAR: 1, SQUARE: 2, ROUNDED: 3 };
const CHAT = { DEFAULT: 0, BUBBLES: 1, DOCUMENT: 2 };

const base = (name, o) => ({
  name,
  blur_strength: o.blur_strength ?? 10,
  main_text_color: o.mainText,
  italics_text_color: o.italics,
  underline_text_color: o.underline ?? o.italics,
  quote_text_color: o.quote ?? o.italics,
  blur_tint_color: o.bg,
  chat_tint_color: o.chatBg,
  user_mes_blur_tint_color: o.userBubble,
  bot_mes_blur_tint_color: o.botBubble,
  shadow_color: rgba('#000000', o.shadowAlpha ?? 1),
  shadow_width: o.shadow_width ?? 2,
  border_color: o.border,
  font_scale: o.font_scale ?? 1,
  fast_ui_mode: false,
  waifuMode: false,
  avatar_style: o.avatar,
  chat_display: o.chat,
  noShadows: o.noShadows ?? true,
  chat_width: o.chat_width ?? 50,
  timer_enabled: false,
  timestamps_enabled: false,
  timestamp_model_icon: false,
  toastr_position: 'toast-bottom-right',
  mesIDDisplay_enabled: false,
  hideChatAvatars_enabled: o.hideAvatars ?? false,
  message_token_count_enabled: false,
  expand_message_actions: false,
  enableZenSliders: false,
  enableLabMode: false,
  hotswap_enabled: false,
  custom_css: o.customCss ?? '',
  bogus_folders: false,
  zoomed_avatar_magnification: false,
  reduced_motion: false,
  compact_input_area: false,
  show_swipe_num_all_messages: false,
  click_to_edit: false,
  media_display: o.media_display ?? 0,
});

export const juicychatCss = `/* ==========================================================================
   Replica de juicychat.ai — burbuja, formato rico y color de roles.
   Valores literales de index-CGLceTsY.css / index-BnrrLcpV.css y de los
   estilos computados de _markdownContent_fni99.
   ========================================================================== */
:root {
  --jc-bg: ${rgba('#02031F')};           /* --sea-bg-color */
  --jc-surface: ${rgba('#171932')};       /* --bg-color-2 */
  --jc-border: ${rgba('#323463')};        /* --border-color */
  --jc-accent: ${rgba('#F75ECD')};        /* --main-color */
  --jc-muted: ${rgba('#7D80AD')};
  --jc-name-char: ${rgba('#C3ABEA')};
  --jc-name-user: ${rgba('#A3AAF8')};
  --jc-narration-char: ${rgba('#C3ABEA')};
  --jc-narration-user: ${rgba('#9AA2F1')};
  --jc-badge-bg: ${rgba('#26174A')};
  --jc-badge-text: ${rgba('#B382FF')};
  --jc-bubble-char: ${rgba('#452A6F', 0.8)};
  --jc-bubble-user: ${rgba('#2B2E4E', 0.8)};
  --jc-lastword: linear-gradient(90deg, #FFFFFF, #26D5FF, #F75ECD);
}

/* La columna de chat de JuicyChat mide 768px de maximo */
#sheld { --sheldWidth: min(768px, 96vw); }

/* --- Burbuja del personaje: "tarjeta con esquinas", la esquina superior
   izquierda a 0 hace el hocico que apunta al avatar, y lleva backdrop-filter
   (solo apreciable sobre la imagen del personaje). --- */
body.bubblechat .mes {
  border-radius: 0 12px 12px 12px;
  background-color: var(--jc-bubble-char);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--jc-border);
  padding: 10px;
}
body.bubblechat .mes[is_user="true"] {
  background-color: var(--jc-bubble-user);
  border-radius: 12px 0 12px 12px;
  margin-left: auto;
}

/* Avatares: 36px con borde, como en el sitio */
body.bubblechat .avatar {
  box-sizing: border-box;
  width: 36px;
  height: 36px;
  min-width: 36px;
  border: 1px solid var(--jc-border);
  border-radius: 50%;
  overflow: hidden;
}
body.bubblechat .mesAvatarWrapper {
  width: 36px;
  flex: 0 0 36px;
}

/* --- Formato del mensaje: el markdown arranca en negrita 14/22 --- */
body.bubblechat .mes_text {
  font-size: 14px;
  line-height: 22px;
  font-weight: 700;
  color: #FFFFFF;
}
body.bubblechat .mes_text h1,
body.bubblechat .mes_text h2,
body.bubblechat .mes_text h3,
body.bubblechat .mes_text h4,
body.bubblechat .mes_text h5,
body.bubblechat .mes_text h6 {
  font-size: 14px;
  line-height: 22px;
  font-weight: 700;
  color: #FFFFFF;
  margin: 0;
}
body.bubblechat .mes_text strong { font-weight: 600; color: #FFFFFF; }
/* la em es la "narracion" del sitio */
body.bubblechat .mes_text i,
body.bubblechat .mes_text em {
  font-weight: 400;
  font-style: normal;
  color: var(--jc-narration-char);
}
body.bubblechat .mes[is_user="true"] .mes_text i,
body.bubblechat .mes[is_user="true"] .mes_text em { color: var(--jc-narration-user); }
body.bubblechat .mes_text img {
  width: 100%;
  margin: 20px 0;
  border-radius: 5px;
}

body.bubblechat .name_text {
  font-size: 14px;
  line-height: 24px;
  font-weight: 700;
  max-width: 400px;
}
body.bubblechat .mes[is_user="false"] .name_text { color: var(--jc-name-char); }
body.bubblechat .mes[is_user="true"]  .name_text { color: var(--jc-name-user); }
`;

export const tipsyCss = `/* ==========================================================================
   Replica de tipsy.chat — degradado de firma, fondo calido y burbujas.
   El fondo real del sitio es un <svg> con dos feGaussianBlur, que no tiene
   propiedad CSS equivalente: se aproxima con radial-gradients apilados.
   Tipsy NO tiene avatar por mensaje (solo uno de 46px en la cabecera del
   panel), asi que se ocultan con el flag nativo hideChatAvatars_enabled.
   ========================================================================== */
:root {
  --ts-panel-gradient: linear-gradient(
    rgba(0, 0, 0, 0.6) 0%,
    rgba(87, 47, 102, 0.6) 50%,
    rgba(29, 21, 21, 0.6) 100%);
  /* Burbuja por defecto. El sitio usa un color por personaje al 80% (medido:
     Alec rgba(41,84,173,.8), Noah rgba(89,105,125,.8)). El token --bubble-bg-char
     (#00000080) es negro al 50% y sobre el fondo oscuro resulta invisible, asi
     que los mensajes se leen como un bloque corrido. Se usa el azul real del
     sitio como valor por defecto; CSC lo cambia por personaje. */
  --ts-bubble-char-token: ${rgba('#3C3C42', 0.92)};
  --ts-bubble-user: ${rgba('#FFFFFF', 0.9)};         /* --bubble-bg-user */
  --ts-border: ${rgba('#FFFFFF', 0.28)};
  --ts-text-char: ${rgba('#F2F0F4', 0.95)};        /* blanco casi opaco: el gris de fondo lo exige */
  --ts-text-user: ${rgba('#1E1E24', 0.95)};        /* casi negro sobre blanco */
  --ts-narration-shadow: 0 4px 20px ${rgba('#000000')};
}

/* Degradado de firma del panel de chat */
body.bubblechat #chat {
  background: var(--ts-panel-gradient);
}

/* Aproximacion del fondo calido: cuatro halos radiales sobre la base */
body {
  background-color: ${rgba('#231413')};
  background-image:
    radial-gradient(60% 80% at 15% 100%, ${rgba('#1D100C', 0.9)}, transparent 70%),
    radial-gradient(70% 90% at 85% 100%, ${rgba('#2F1613', 0.9)}, transparent 70%),
    radial-gradient(80% 70% at 100% 100%, ${rgba('#331614', 0.9)}, transparent 70%),
    radial-gradient(50% 50% at 50% 100%, ${rgba('#4B3F3D', 0.5)}, transparent 70%);
  background-attachment: fixed;
}

/* Burbujas: 0 10px 10px 10px en el personaje, 10px 2px 10px 10px en el usuario.
   En Tipsy el color del personaje va inline por tarjeta (rgba(41,84,173,.8) para
   Alec, rgba(89,105,125,.8) para Noah); aqui se pone el token por defecto
   #00000080 y Character Style Customizer ajusta por personaje. */
body.bubblechat .mes {
  margin-bottom: 18px;
  border-radius: 0 10px 10px 10px;
  padding: 8px 12px 10px;
  border: 1px solid var(--ts-border);
}
body.bubblechat .mes[is_user="false"] {
  background-color: var(--ts-bubble-char-token);
  color: var(--ts-text-char);
}
body.bubblechat .mes[is_user="true"] {
  background-color: var(--ts-bubble-user);
  color: var(--ts-text-user);
  border-radius: 10px 2px 10px 10px;
  margin-left: auto;
}

body.bubblechat .mes_text {
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
}
/* La cursiva depende del fondo de la burbuja: sobre gris oscuro va clara, sobre
   la burbuja blanca del usuario va oscura. El color global del tema no puede
   hacer las dos cosas. */
body.bubblechat .mes[is_user="false"] .mes_text i,
body.bubblechat .mes[is_user="false"] .mes_text em {
  color: ${rgba('#D8D4DE', 0.92)};
  font-style: italic;
  font-weight: 400;
}
body.bubblechat .mes[is_user="true"] .mes_text i,
body.bubblechat .mes[is_user="true"] .mes_text em {
  color: ${rgba('#33333A', 0.95)};
  font-style: italic;
  font-weight: 400;
}
/* Sin avatar por mensaje (tipsy.chat no los tiene), pero SOLO dentro del chat:
   el flag global hideChatAvatars de ST tambien borraba los retratos del panel de
   Chats recientes (public/css/welcome.css:32), que si queremos conservar.
   Moonlit pone display con !important en .mesAvatarWrapper, de ahi el !important. */
#chat .mes .mesAvatarWrapper { display: none !important; }
`;

export const themes = {
  'Tipsy.chat.json': base('Tipsy.chat', {
    bg: rgba('#231413'),
    chatBg: rgba('#1D1512', 0.6),
    mainText: rgba('#FFFFFF', 0.88),
    // La cursiva es gris muy claro (#FFFFFF99) y dentro de la burbuja blanca del
    // usuario queda ilegible. Se pone oscura por defecto (para el fondo claro) y
    // el CSS la aclara solo en la burbuja oscura del personaje.
    italics: rgba('#3A3A40', 0.95),
    quote: rgba('#C9A7E8', 0.8),
    botBubble: rgba('#3C3C42', 0.92),   // gris oscuro pedido: el texto claro destaca
    userBubble: rgba('#FFFFFF', 0.9),
    border: rgba('#FFFFFF', 0.4),
    shadowAlpha: 0.6,
    blur_strength: 0,
    avatar: AVATAR.ROUND,
    chat: CHAT.BUBBLES,
    chat_width: 50,
    hideAvatars: false,
    customCss: tipsyCss,
  }),
  'JuicyChat.ai.json': base('JuicyChat.ai', {
    bg: rgba('#02031F'),
    chatBg: rgba('#02031F', 0.35),
    mainText: rgba('#FFFFFF', 1),
    italics: rgba('#C3ABEA', 1),
    quote: rgba('#B382FF', 1),
    botBubble: rgba('#452A6F', 0.8),
    userBubble: rgba('#2B2E4E', 0.8),
    border: rgba('#323463', 0.5),
    shadowAlpha: 1,
    blur_strength: 8,
    avatar: AVATAR.ROUND,
    chat: CHAT.BUBBLES,
    chat_width: 50,
    hideAvatars: false,
    customCss: juicychatCss,
  }),
};

const dir = path.dirname(new URL(import.meta.url).pathname);
for (const [file, theme] of Object.entries(themes)) {
  await fs.writeFile(path.join(dir, file), JSON.stringify(theme, null, 4) + '\n', 'utf8');
  console.log('escrito:', file, `(${(JSON.stringify(theme).length / 1024).toFixed(1)} KB)`);
}
