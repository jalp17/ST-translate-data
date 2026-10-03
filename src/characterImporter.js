import { parsePNGChunks, buildPNG, buildTextChunkBytes } from './pngChunks.js';
import { juicyEncrypt, juicyDecrypt, JUICYCHAT_SECRET_KEY } from './juicychatCrypto.js';
import { scopeDocumentCss } from './richCssInliner.js';
import { buildFontFaceCss, declaredFontFamilies } from './richFonts.js';
import { extractLorePages, lorePagesToDetails, lorePagesToBook } from './richLore.js';

/**
 * Importación de tarjetas de personaje desde sitios de roleplay IA por URL.
 *
 * Arquitectura: una clase por proveedor (CharacterProvider). Para añadir un
 * sitio nuevo basta con implementar canHandle/extractId/fetchRaw/toCardFields
 * y añadir la instancia a PROVIDERS.
 */

export class CharacterProvider {
  constructor(name) {
    this.name = name;
  }

  /** @param {string} _url @returns {boolean} */
  canHandle(_url) {
    return false;
  }

  /** @param {string} _url @returns {string|null} */
  extractId(_url) {
    return null;
  }

  /** @param {string} _id @returns {Promise<object>} */
  async fetchRaw(_id) {
    throw new Error('fetchRaw no implementado');
  }

  /**
   * Mapea el payload crudo del sitio a campos de chara_card_v2.
   * @param {object} _raw
   * @returns {{name:string, description:string, personality:string, scenario:string,
   *   first_mes:string, mes_example:string, tags:string[], creator:string,
   *   avatarUrl:string|null, backgroundUrls:string[]}}
   */
  toCardFields(_raw) {
    throw new Error('toCardFields no implementado');
  }

  /**
   * Construye una CharacterCard v2 compatible con SillyTavern.
   * @param {object} raw Payload crudo del sitio
   * @param {string} url URL original
   * @param {object} options Opciones de importación (p. ej. `richFormatMode`)
   */
  async toCharacterCard(raw, url, options = {}) {
    const f = await this.toCardFields(raw, options);
    // authorNote: nota del autor que el sitio muestra bajo la card (JuicyChat/Tipsy).
    // Si no hay, se genera una con los metadatos útiles de la extracción.
    const notes = f.authorNote
      ? `${f.authorNote}\n\n---\nExtraído de: ${url}`
      : (f.extraInfo
        ? `Extraído de: ${url}\n\n${f.extraInfo}`
        : `Extraído de: ${url}`);

    return {
      card: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: f.name || 'Personaje importado',
          description: f.description || '',
          personality: f.personality || '',
          scenario: f.scenario || '',
          first_mes: f.first_mes || '',
          mes_example: f.mes_example || '',
          creator_notes: notes,
          system_prompt: f.systemPrompt || '',
          post_history_instructions: f.postHistory || '',
          alternate_greetings: f.alternateGreetings || [],
          character_book: f.characterBook || null,
          tags: ['ideas', ...(f.tags || [])],
          creator: f.creator || '',
          character_version: '1.0',
          extensions: { source_url: url, source_service: this.name, gallery: f.galleryInfo ?? null },
        },
      },
      avatarUrl: f.avatarUrl || null,
      backgroundUrls: f.backgroundUrls || [],
      galleryInfo: f.galleryInfo ?? null,
      // Imágenes que el sitio embebe como markdown en el texto (greeting de
      // Tipsy). Se pueden embeber en un .charx para que la tarjeta no
      // dependa de un hosting externo.
      embeddedImages: f.embeddedImages || [],
      // Assets declarados por el provider para empaquetar en un .charx.
      // Cada uno: { name, type, url } con type ∈ expression|emotion|
      // background|misc. La UI los descarga y buildCharacterCardCharX()
      // los mete dentro del ZIP.
      charxAssets: f.charxAssets || [],
    };
  }
}

export class MoescapeProvider extends CharacterProvider {
  constructor() {
    super('moescape');
  }

  canHandle(url) {
    return /(^|\.)moescape\.ai$/i.test(new URL(url).hostname) && this.extractId(url) !== null;
  }

  extractId(url) {
    const m = String(url).match(/\/tavern\/characters\/([a-f0-9-]{36})/i);
    return m ? m[1] : null;
  }

  async fetchRaw(uuid) {
    const response = await fetch(`https://api.moescape.ai/v1/characters/${encodeURIComponent(uuid)}`);
    if (!response.ok) {
      throw new Error(`Moescape respondió ${response.status} para el personaje ${uuid}`);
    }
    return response.json();
  }

  toCardFields(raw) {
    const personality = [raw.char_persona, raw.nickname && raw.nickname !== raw.name ? `Nickname: ${raw.nickname}` : '']
      .filter(Boolean)
      .join('\n');
    return {
      name: raw.char_name || raw.name || 'Moescape character',
      description: raw.description || '',
      personality,
      scenario: raw.world_scenario || '',
      first_mes: raw.char_greeting || '',
      mes_example: raw.example_dialogue || '',
      authorNote: raw.creator_note || raw.creator_notes || raw.creator_comment || '',
      systemPrompt: raw.char_system_prompt || raw.system_prompt || '',
      postHistory: raw.char_post_history_instructions || raw.post_history_instructions || '',
      alternateGreetings: Array.isArray(raw.alternative_greetings)
        ? raw.alternative_greetings.filter(Boolean)
        : (raw.char_alternative_greetings ? [raw.char_alternative_greetings] : []),
      tags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
      creator: raw.creator_name || '',
      avatarUrl: raw.thumbnail_photo?.url || raw.background_photos?.[0]?.url || null,
      backgroundUrls: (raw.background_photos || []).map((p) => p?.url).filter(Boolean),
      // En .charx las fotos de fondo van como 'background'; ST las guarda en el
      // directorio de fondos del personaje.
      charxAssets: (raw.background_photos || [])
        .map((p, i) => p?.url ? { name: `background_${i + 1}`, type: 'background', url: p.url } : null)
        .filter(Boolean),
      extraInfo: [
        raw.nickname ? `nickname: ${raw.nickname}` : '',
        raw.content_rating ? `content_rating: ${raw.content_rating}` : '',
        typeof raw.chat_count === 'number' ? `chat_count: ${raw.chat_count}` : '',
      ].filter(Boolean).join('\n'),
    };
  }
}

export class TipsyProvider extends CharacterProvider {
  constructor() {
    super('tipsy');
  }

  canHandle(url) {
    return /(^|\.)tipsy\.chat$/i.test(new URL(url).hostname) && this.extractId(url) !== null;
  }

  extractId(url) {
    const m = String(url).match(/\/(?:character|characters|chat)\/(\d{6,})/i);
    return m ? m[1] : String(url).match(/(\d{15,})/)?.[1] || null;
  }

  async fetchRaw(characterId) {
    const url = 'https://api.tipsy.chat/api/v1/character/get/public';
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, nsfw: true, language_code: 'es' }),
    };

    // Tipsy no envía cabeceras CORS, así que el fetch directo desde el navegador
    // falla siempre. El proxy de SillyTavern reenvía el POST desde el servidor
    // (src/middleware/corsProxy.js acepta POST/PUT/PATCH), así que va por ahí.
    const viaProxy = `/proxy/${encodeURIComponent(url)}`;

    // El proxy está exento de CSRF cuando enableCorsProxy está activo, pero
    // enviar el token no molesta y evita 403 si el usuario lo desactiva.
    const ctx = globalThis.SillyTavern?.getContext?.();
    const headers = { 'Content-Type': 'application/json' };
    const token = ctx?.getRequestHeaders?.()?.['X-CSRF-Token'];
    if (token) headers['X-CSRF-Token'] = token;

    let response = await fetch(viaProxy, { ...init, headers }).catch(() => null);
    if (!response || !response.ok) {
      response = await fetch(url, init);
    }
    if (!response.ok) {
      throw new Error(`Tipsy respondió ${response.status} para el personaje ${characterId}`);
    }
    const payload = await response.json();
    if (payload?.code !== 0 || !payload?.data?.character) {
      throw new Error('Tipsy no devolvió datos de personaje válidos');
    }

    // Los personajes content_type 3 guardan el saludo con formato en campos
    // hermanos de `character`, no dentro: data.rich_content trae el HTML
    // completo (con <img> y <h1>) y data.images el listado de imágenes.
    return {
      ...payload.data.character,
      _richContent: payload.data.rich_content || null,
      _imagePrimaryColor: payload.data.character?.img_primary_color || null,
      _images: Array.isArray(payload.data.images) ? payload.data.images : [],
    };
  }

  async toCardFields(raw, options = {}) {
    // Verificado contra la API real: el objeto `character` trae nickname,
    // introduction (pitch corto), greeting (primer mensaje), image_url (principal,
    // con watermark), face_url (recorte cuadrado del mismo render), etc.
    const avatar = raw.image_url || raw.animated_image_url || raw.face_url || null;
    const tags = Array.isArray(raw.tags)
      ? raw.tags.map((t) => (typeof t === 'string' ? t : (t?.desc || t?.alias || t?.name))).filter(Boolean)
      : [];

    // face_url es un recorte del MISMO render que image_url (mismo seed, distinto
    // encuadre). No aporta información, así que no se descarga como imagen extra.
    // Solo se recoge si es la única imagen disponible.
    const extraImages = [
      raw.animated_image_url,  // GIF/WebP animado, si existe
      raw.pc_image_url,        // versión escritorio, si existe
    ].filter(Boolean);

    // El saludo con formato. Los content_type 3 lo traen plano en `greeting`
    // y el formato real solo existe en rich_content.greeting_rich_text (HTML),
    // así que se convierte a markdown y se prefiere cuando está disponible.
    const plainGreeting = raw.greeting || raw.first_message || '';
    const richHtml = raw._richContent?.greeting_rich_text || '';

    let richMarkdown = '';
    if (richHtml) {
      if (options?.richFormatMode === 'fiel') {
        // Normaliza las etiquetas propietarias y, si la carta trae un bloque
        // <style> de documento completo, aplana ese CSS a estilos inline: ST
        // acota el CSS de los mensajes a `.mes_text`, con lo que `:root` y
        // `body` se vuelven selectores muertos. Ver preserveRichHtmlAsHtml.
        richMarkdown = preserveRichHtmlAsHtml(richHtml, tipsyBubbleColor(raw));

        // Tipografias: el saludo declara `font-family: 'Sancreek', serif` pero
        // las carga con un <link> a Google Fonts, que no llega al chat (DOMPurify
        // lo borra y ST bloquea la media externa). Sin la fuente real el texto
        // cae al fallback y la carta pierde medio aire. Se incrustan como data
        // URI, que si sobreviven. Va optativo porque pesa ~137 KB.
        // Ver richFonts.js.
        if (options?.embedWebFonts && /fonts\.googleapis\.com/i.test(richHtml)) {
          const familias = declaredFontFamilies(richHtml);
          const { css, bytes, ficheros } = await buildFontFaceCss(familias, options);
          if (css) {
            richMarkdown = richMarkdown.replace('<style>', `<style>${css}`);
            console.log(`[ST-Translator] tipografias incrustadas: ${ficheros} ficheros, ${Math.round(bytes / 1024)} KB`);
          }
        }
        // Si la carta es un documento HTML completo, se reapunta su CSS al
        // contenedor en vez de aplanarlo a estilos inline: inlinear rompe la
        // cascada y multiplicaba el tamaño (15.596 chars de atributos para
        // 1.937 de texto). Ver scopeDocumentCss.
        if (/<style\b/i.test(richMarkdown)) {
          richMarkdown = scopeDocumentCss(richMarkdown, 'custom-sttd-doc');
        }
      } else {
        richMarkdown = richHtmlToMarkdown(richHtml);
      }
    }
    const usedRich = Boolean(richMarkdown) && (!plainGreeting || richMarkdown.length > plainGreeting.length);
    const firstMes = usedRich ? richMarkdown : plainGreeting;
    // El saludo plano estaba realmente aplanado solo si no se pudo usar el rico
    const greetingWasFlat = detectFlattenedGreeting(raw) && !usedRich;

    // Imágenes: las del saludo con formato + las de data.images que no estén
    // repetidas. data.images es el listado completo del personaje y suele
    // traer más que las incrustadas en el texto.
    const greetingImages = extractMarkdownImageUrls(firstMes);
    const catalogImages = (raw._images ?? [])
      .map((img) => img?.image_url)
      .filter(Boolean);
    const allImages = [...new Set([...greetingImages, ...catalogImages])];

    // La "descripción" de la tarjeta. Se usa el texto plano de
    // data.character.description: la descripción va al prompt y al panel de
    // información, donde el HTML no aporta nada.
    //
    // NO se usa data.rich_content.tagline aunque en modo fiel tenga mejor
    // aspecto: el tagline de Tipsy es la *página de la carta*, no su
    // descripción. Medido sobre 45 personajes de content_type 3: mediana 1022
    // caracteres pero con un extremo de 78.210 (Guillotinea) y 32.235 (Aurel
    // Wisp), con bloques <style>, variables :root y hasta 14 <img> externos.
    // Meter eso en `description` son ~20k tokens de HTML en cada prompt.
    // El HTML bonito pertenece al saludo, que es donde lo usamos en modo fiel.
    let description = stripTipsyUiLabels(raw.description || raw.introduction || '');
    description = stripInlineImagesInTipsy(description).replace(/<img\b[^>]*>/gi, '').trim();

    // Si Tipsy no trajo descripción, el tagline es la única fuente: se usa
    // como texto plano (sin etiquetas ni estilos) y con un tope, por lo mismo.
    if (!description) {
      const tagline = raw._richContent?.tagline || '';
      if (tagline) {
        description = richHtmlToMarkdown(tagline)
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/[*_`>#]/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 4000);
      }
    }

    // Lore escondido en el <script> del tagline. Tipsy lo monta como visor
    // interactivo (botones de carrusel y paginacion) y guarda las paginas en
    // `const lorePages = [...]`. ST borra los <script> al sanear, asi que sin
    // esto el lore se pierde entero. Se recupera en dos formatos:
    //  - character_book: donde ST guarda el lore de verdad, por palabras clave.
    //  - creator_notes: bloques <details>, que el navegador pliega sin JS.
    const lorePages = extractLorePages(raw._richContent?.tagline || '');
    const loreBook = lorePages.length
      ? lorePagesToBook(lorePages, `${raw.nickname || 'Tipsy'} - Lore`)
      : null;
    const loreDetails = lorePagesToDetails(lorePages);
    const creatorNotes = [
      (raw.creator_notes || raw.creator_note || '').trim(),
      loreDetails,
    ].filter(Boolean).join('\n\n');

    return {
      name: raw.nickname || raw.name || 'Tipsy character',
      description,
      personality: Array.isArray(raw.personality) ? raw.personality.filter(Boolean).join(', ') : (raw.personality || ''),
      scenario: stripInlineImagesInTipsy(stripTipsyUiLabels(raw.scenario || '')),
      // El saludo lleva las imágenes de la tarjeta embebidas como markdown
      // ![](https://...) apuntando a hosts públicos (i.postimg.cc, i.ibb.co).
      // SillyTavern renderiza markdown igual que Tipsy, así que se conserva.
      first_mes: firstMes,
      mes_example: stripInlineImagesInTipsy(raw.example_dialogue || raw.dialog_example || ''),
      authorNote: creatorNotes,
      characterBook: loreBook,
      // Imágenes del saludo, para poder embeberlas en un .charx y que la
      // tarjeta no dependa de que el hosting siga sirviéndolas.
      embeddedImages: greetingImages,
      // Como assets de CharX van como 'expression': ST las guarda en
      // characters/<Personaje>/ con guiones, así el usuario puede renombrarlas
      // a una emoción concreta si quiere usarlas de sprite.
      charxAssets: allImages.map((url, i) => ({
        name: i < greetingImages.length ? `greeting_${i + 1}` : `image_${i + 1}`,
        type: 'expression',
        url,
      })),
      // content_type 1 = markdown en `greeting`; 3 = texto plano y el formato
      // solo en data.rich_content.greeting_rich_text.
      contentType: raw.content_type ?? null,
      usedRichContent: usedRich,
      // Tipsy no expone system_prompt ni post_history en el endpoint público
      systemPrompt: '',
      postHistory: '',
      alternateGreetings: [],
      tags,
      creator: raw.creator_name || raw.author_name || '',
      avatarUrl: avatar && !/^https?:/i.test(avatar) ? `https://img.tipsy.chat/${avatar.replace(/^\//, '')}` : avatar,
      backgroundUrls: extraImages,
      extraInfo: [
        raw.gender ? `gender: ${raw.gender}` : '',
        raw.lang ? `language: ${raw.lang}` : '',
        raw.is_translated ? `traducido automáticamente desde: ${raw.lang}` : '',
        raw.nsfw ? 'nsfw: yes' : '',
        typeof raw.character_type === 'number' ? `character_type: ${raw.character_type}` : '',
        raw.content_type != null ? `content_type: ${raw.content_type}` : '',
        usedRich ? 'saludo tomado de data.rich_content (formato original recuperado)' : '',
        greetingWasFlat ? 'AVISO: el texto llegó sin saltos de línea desde la API y no había rich_content; Tipsy lo devolvió plano.' : '',
        greetingImages.length ? `imágenes en el primer mensaje: ${greetingImages.length}` : '',
      ].filter(Boolean).join('\n'),
    };
  }
}

function stripInlineImagesInTipsy(s) {
  return (s || '').replace(/!\[[^\]]*\]\(https?:\/\/[^)]+\)/g, '').trim();
}

/**
 * Convierte el HTML rico de `rich_content.greeting_rich_text` a markdown.
 *
 * Tipsy guarda el saludo en dos sitios según la versión del personaje:
 *  - content_type 1 → data.character.greeting ya viene en markdown
 *  - content_type 3 → data.character.greeting viene aplastado en una línea y
 *    el formato real (etiquetas, párrafos e imágenes) queda solo en
 *    data.rich_content.greeting_rich_text, que es HTML completo.
 *
 * SillyTavern renderiza markdown en los mensajes, así que convertimos a
 * markdown en vez de dejar HTML suelto (DOMPurify le quitaría el <style>).
 */
export function richHtmlToMarkdown(html) {
  if (!html || typeof html !== 'string') return '';

  let text = html;

  // Descartar bloques que no aportan al texto del mensaje
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<meta[^>]*>/gi, '');
  text = text.replace(/<link[^>]*>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Imágenes: <img ... src="URL" ...> → ![](URL)
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    return src ? `![](${src})` : '';
  });

  // Encabezados
  text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, '\n\n# $1\n\n');
  text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  text = text.replace(/<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n');

  // Énfasis
  text = text.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  text = text.replace(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, '~~$2~~');

  // Párrafos y saltos
  text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, '\n\n$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Listas
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1');
  text = text.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n');

  // Citas
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n\n> $1\n\n');

  // Cualquier etiqueta suelta
  text = text.replace(/<\/?[a-z][^>]*>/gi, '');

  // Entidades HTML comunes y numéricas
  const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#34;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&hellip;': '…', '&mdash;': '—', '&ndash;': '–' };
  for (const [ent, ch] of Object.entries(entities)) {
    text = text.replaceAll(ent, ch);
  }
  // Resto de entidades numéricas (&#39;, &#8220;, …)
  text = text.replace(/&#(\d+);/g, (_, code) => {
    try {
      return String.fromCodePoint(Number(code));
    } catch {
      return _;
    }
  });

  // Colapsar líneas en blanco repetidas y espacios sobrantes
  text = text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

/**
 * Convierte un Blob en un data URI base64. Se hace por trozos porque
 * btoa(String.fromCharCode(...array)) revienta la pila con blobs de MB.
 * @param {Blob} blob
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
export async function blobToDataUri(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

/**
 * Sustituye las referencias `![](url)` de un texto por `![](data:...)`
 * usando los data URI ya calculados.
 *
 * Por qué: SillyTavern solo sabe resolver `embedded://` al importar el .charx
 * para extraer los archivos, nunca reescribe el texto de los mensajes. La única
 * forma de que un mensaje use la imagen incrustada en vez de la URL es
 * llevarla dentro como data URI. Verificado que el DOMPurify de ST acepta
 * `data:` en el src de <img>, así que la imagen se ve igual en el chat.
 *
 * Las imágenes que superan maxBytes se dejan con su URL: convertirlas
 * inflaría el card.json (base64 suma ~33%) sin ganancia práctica.
 *
 * @param {string} text Texto con markdown
 * @param {Map<string, {dataUri: string, size: number}>} map url → data URI
 * @param {number} maxBytes Tamaño máximo del blob original para incrustar
 * @returns {{text: string, inlined: number, kept: number, bytes: number}}
 */
export function inlineImagesAsDataUris(text, map, maxBytes = 600 * 1024) {
  let inlined = 0;
  let kept = 0;
  let bytes = 0;

  const result = String(text || '').replace(
    /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g,
    (match, url) => {
      const entry = map.get(url);
      if (!entry?.dataUri) {
        return match;
      }
      if (entry.size > maxBytes) {
        kept++;
        return match;
      }
      inlined++;
      bytes += entry.size;
      return match.replace(url, entry.dataUri);
    }
  );

  return { text: result, inlined, kept, bytes };
}

/**
 * Replica el `sanitize-filename` que usa ST al importar (src/endpoints/characters.js
 * hace `card.data.name = sanitize(card.data.name)` y usa ese nombre como carpeta
 * de sprites). Si no coinciden, la ruta generada no existiría.
 */
export function sanitizeSTFileName(name) {
  return String(name ?? '')
    // caracteres de control + los ilegales en la lista de sanitize-filename
    .replace(/[\u0000-\u001F\u0080-\u009F<>:"/\\|?*]/g, '')
    // puntos y espacios al final (Windows no los permite)
    .replace(/[. ]+$/g, '')
    .trim();
}

/**
 * Replica `getCharXAssetBaseName(name, fallback, useHyphens=true)` de
 * src/charx.js, que es como ST nombra el archivo de un sprite al importar.
 * Los sprites usan guiones, no guiones bajos, para que el extractor de
 * etiquetas los separe bien.
 */
export function charxSpriteBaseName(name, fallback = 'sprite') {
  const cleaned = String(name ?? '').trim();
  if (!cleaned) {
    return fallback.toLowerCase();
  }
  return cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Construye la ruta por la que ST servirá un sprite del personaje tras
 * importar el .charx.
 *
 * Verificado contra la instancia en marcha: ST sirve `data/` con un router
 * dedicado (src/users.js:1213-1219, `router.use('/characters/*', ...)`), no
 * por express.static, y las subcarpetas también responden. Una ruta relativa
 * no es "media externa" (chats.js isExternalUrl exige '://' o '//' al
 * principio), así que sobrevive a forbid_external_media.
 *
 * @param {string} charName Nombre de la tarjeta tal como aparecerá en ST
 * @param {string} assetName Nombre del asset declarado en el charx
 * @param {string} ext Extensión del archivo (sin punto)
 * @returns {string} p.ej. /characters/A%20Mother's%20Envy/greeting-1.jpg
 */
export function buildSpriteReference(charName, assetName, ext) {
  const folder = sanitizeSTFileName(charName);
  const base = charxSpriteBaseName(assetName);
  const folderEnc = encodeURIComponent(folder);
  return `/characters/${folderEnc}/${base}.${String(ext || 'png').toLowerCase()}`;
}

/**
 * Quita las etiquetas de interfaz que algunos autores de Tipsy pegan dentro
 * del campo de descripcion, porque el texto lo copian de la plantilla del
 * carrusel de la carta. En Guillotinea, de 480 caracteres de `introduction`,
 * 360 son esto:
 *
 *     Recordatorio: Algunas imagenes pueden tardar unos segundos en cargarse.
 *     PAGINA 01 / 09
 *     Imagen anterior / Imagen siguiente / Pagina anterior / Pagina siguiente
 *
 * Solo se borran lineas completas que coinciden con esas etiquetas, nunca
 * texto que las contenga: si el autor escribio "la pagina anterior estaba
 * vacia" eso se conserva.
 */
function stripTipsyUiLabels(text) {
  if (!text) return text;
  const LINEAS_BASURA = [
    /^Recordatorio\s*:/i,
    /^P[\u00c1A]GINA\s+\d+\s*\/\s*\d+$/i,
    /^(Imagen|P[\u00e1a]gina)\s+(anterior|siguiente|principal)$/i,
    /^(Imagen|P[\u00e1a]gina)\s+\d+\s*\/\s*\d+$/i,
    /^[\u00d7x]$/,
    /^Ver\s+(todo|original|traducci[\u00f3]n)$/i,
  ];
  return String(text)
    .split('\n')
    .filter((linea) => !LINEAS_BASURA.some((re) => re.test(linea.trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Etiquetas proprias de Tipsy para el saludo, y como reproducir su aspecto.
 *
 * Tipsy renderiza el saludo procesando el HTML en el cliente:
 *
 *   - `<message>`   -> lo envuelve en `.char-message-bubble`, con fondo
 *                      `toRgba(img_primary_color, 0.8)`, es decir el color
 *                      dominante de la IMAGEN del personaje. Por eso la burbuja
 *                      cambia de color segun el personaje: no es un estilo de
 *                      tema, se calcula de la imagen. Constantes de Tipsy:
 *                        DEFAULT_CHAT_BUBBLE_COLOR    = #8145A8  (morado)
 *                        CHAT_BUBBLE_BACKGROUND_ALPHA = 0.8
 *                        CHAT_BUBBLE_BACKDROP_FILTER  = blur(22.8px)
 *   - `<narration>` -> `.narration-segment`: texto normal, sin burbuja.
 *   - `<html-box>`  -> contenedor; es la unica que admite `<script>` dentro.
 *
 * Por eso aqui NO se quitan las etiquetas:
 *
 *  - narration se desenvuelve a texto plano, que es exactamente como lo
 *    pinta Tipsy (`text-shadow:0 4px 20px #000; font-size:14px; line-height:20px`).
 *  - message se convierte en `<span class="sttd-msg">` con el color del personaje
 *    puesto en linea, porque `style="..."` si sobrevive al sanitizado de ST y las
 *    clases tambien. La geometria de la burbuja la pone el CSS de la extension.
 *
 * Sin esto, un saludo de Tipsy se veia como un bloque de texto plano: se perdia
 * justo lo que distingue la narración del diálogo.
 */

/**
 * Convierte el color de la imagen a `rgba()` con el alfa que usa Tipsy para las
 * burbujas. Constantes sacadas del bundle del sitio (modulo 750709):
 *   DEFAULT_CHAT_BUBBLE_COLOR    = '#8145A8'  (morado, si el personaje no trae color)
 *   CHAT_BUBBLE_BACKGROUND_ALPHA = 0.8
 */
const TIPSY_DEFAULT_BUBBLE_COLOR = '#8145A8';
const TIPSY_BUBBLE_ALPHA = 0.8;

/** Devuelve el color de burbuja que Tipsy pintaria para este personaje. */
function tipsyBubbleColor(raw) {
  const hex = String(raw?._imagePrimaryColor || TIPSY_DEFAULT_BUBBLE_COLOR).trim();
  const h = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) {
    // si Tipsy no trae color, se usa el suyo por defecto con su alfa
    const d = TIPSY_DEFAULT_BUBBLE_COLOR.slice(1);
    return `rgba(${parseInt(d.slice(0,2),16)}, ${parseInt(d.slice(2,4),16)}, ${parseInt(d.slice(4,6),16)}, ${TIPSY_BUBBLE_ALPHA})`;
  }
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${TIPSY_BUBBLE_ALPHA})`;
}

/**
 * Devuelve las reglas de reemplazo para las etiquetas de Tipsy, con el color de
 * la burbuja ya resuelto (va en linea porque `style="..."` sobrevive al
 * sanitizado de ST y las clases tambien).
 */
function proprietaryTagRules(bubbleColor) {
  return [
    [/<\/?html-box(\s[^>]*)?>/gi, (m) => (m.startsWith('</') ? '</div>' : '<div>')],
    [/<\/?narration(\s[^>]*)?>/gi, ''],
    [/<message(\s[^>]*)?>/gi, () => `<span class="sttd-msg" style="background:${bubbleColor}">`],
    [/<\/message\s*>/gi, '</span>'],
  ];
}


/**
 * Deja los `<style>` en la forma exacta que ST espera (`<style>` sin atributos)
 * para que su `encodeStyleTags` los capture y `decodeStyleTags` los acote a
 * `.mes_text`. Un `<style type="text/css">` se salta ese regex, pasa intacto por
 * DOMPurify —donde `style` sí está permitido— y aplica a toda la interfaz.
 */
function normalizeStyleTags(html) {
  return String(html).replace(
    /<style\b([^>]*)>/gi,
    (match, attrs) => {
      // Los atributos type/media/scoped solo cambian cómo interpreta el bloque el
      // navegador; justo por conservarlos es por lo que puede escapar del scope.
      // `scoped` es booleano (sin `=`), así que se comprueba el nombre suelto,
      // anclado a un espacio para no confundirlo con p. ej. `data-type`.
      const risky = /(?:^|\s)(?:type|media|scoped)\b/i.test(attrs || '');
      return risky ? '<style>' : match;
    },
  );
}

/**
 * Prepara el rich_content HTML de Tipsy para que ST lo renderice igual que en
 * la web. Comprobado contra el pipeline real de ST 1.19.0
 * (showdown -> DOMPurify -> decodeStyleTags, public/script.js:1955):
 *
 * 1. Los estilos **inline** sobreviven intactos: DOMPurify los permite y solo
 *    desenvuelve las etiquetas propietarias. Como el estilo de cada elemento
 *    va en su propio atributo `style`, perder la etiqueta no cambia nada de
 *    aspecto. Tipsy además no usa clases ni CSS externo (verificado en los
 *    bundles del sitio), así que no hay nada más que preservar.
 * 2. Los bloques `<style>` se dejan casi tal cual: `messageFormatting` los
 *    codifica (encodeStyleTags), los sanea y los acota a `.mes_text` con
 *    prefijo `.custom-` en las clases (decodeStyleTags). Reimplementar eso
 *    aquí solo risks double-scoping.
 * 3. Se les quita el atributo `type` (ver normalizeStyleTags). El regex de
 *    ST es /<style>(.+?)<\/style>/: exige la etiqueta desnuda, así que un
 *    `<style type="text/css">` NO lo captura, llega crudo a DOMPurify (donde
 *    `style` sí está en la lista blanca) y se inyecta como CSS **global**,
 *    saltándose el prefijo `.mes_text`. Como el HTML viene de una API de
 *    terceros, se neutraliza ese camino.
 *
 * @param {string} html
 * @returns {string} HTML listo para first_mes
 */
export function preserveRichHtmlAsHtml(html, bubbleColor = tipsyBubbleColor({})) {
  if (!html || typeof html !== 'string') return html;

  let text = String(html);

  // Zap del <head>: no aportan nada visible en el mensaje
  text = text.replace(/<head[\s\S]*?<\/head>/gi, '');
  text = text.replace(/<meta[^>]*>/gi, '');
  text = text.replace(/<link[^>]*>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<title>[\s\S]*?<\/title>/gi, '');

  text = normalizeStyleTags(text);

  // Etiquetas proprietarias -> HTML estándar (evita el <p> fantasma de showdown)
  for (const [re, fn] of proprietaryTagRules(bubbleColor)) {
    text = text.replace(re, fn);
  }

  return text;
}

/** Extrae las URLs de imágenes markdown de un texto, sin repetir y en orden. */
export function extractMarkdownImageUrls(text) {
  // Dos sintaxis: markdown ![](url) en el saludo plano, y <img src="url"> en
  // el HTML rico (modo fiel). Con solo la primera, las imagenes de las cartas
  // con formato se escapaban y sus assets CharX nunca se descargaban.
  const patrones = [
    /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g,
    /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
  ];
  const urls = [];
  for (const patron of patrones) {
    for (const m of String(text || '').matchAll(patron)) {
      if (!urls.includes(m[1])) urls.push(m[1]);
    }
  }
  return urls;
}

/**
 * Detecta si Tipsy devolvió el greeting completamente plano: texto largo sin
 * ningún salto de línea ni markdown. Suele pasar con content_type 3, donde la
 * traducción automática de Google ya aplanó la estructura antes de que la
 *Character llegue a la API. No es recuperable desde el lado del cliente.
 */
function detectFlattenedGreeting(raw) {
  const g = String(raw?.greeting || '');
  if (g.length < 400) return false;
  const hasBreaks = /\n/.test(g);
  const hasMarkdown = /\*\*|^\s*[-*>#]|!\[[^\]]*\]\(/.test(g);
  return !hasBreaks && !hasMarkdown;
}

/**
 * JuicyChat cifra todas sus llamadas API con AES-128-CBC + doble Base64.
 * Los valores (key "yume1aJ83ZbPpkwb", IV "yume2024cccydnzc", header
 * secretkey) están hardcodeados en la app oficial publicada; ver
 * `juicychatCrypto.js` para detalles.
 *
 * Endpoints relevantes (descifrados del traffic dump en evidencia/):
 * - POST /yume/api/user/v1/character/getCharacterDetail
 *     Request: {"requestData": encrypt({"characterId":"..."})}
 *     Response: {"responseData": encrypt({"code":"200","data":{...}})}
 * - Imágenes: characterThumb (.jpeg siempre) o characterPhoto (.gif/.webp).
 *   characterThumb es la opción consistente para el avatar.
 */
export class JuicyChatProvider extends CharacterProvider {
  constructor() {
    super('juicychat');
  }

  canHandle(url) {
    return /(^|\.)juicychat\.ai$/i.test(new URL(url).hostname) && this.extractId(url) !== null;
  }

  extractId(url) {
    // URLs tipo: /es/chat/2072087837881249794, /chat/2072087837881249794, /character/...
    const m = String(url).match(/\/(?:chat|character)\/(\d{6,})/i);
    if (m) return m[1];
    // Fallback: cualquier secuencia larga de dígitos (p.ej. query string)
    return String(url).match(/(\d{15,})/)?.[1] ?? null;
  }

  async fetchRaw(characterId) {
    const { juicyEncrypt, juicyDecrypt, JUICYCHAT_SECRET_KEY } = await import('./juicychatCrypto.js');

    const postEncrypted = async (path, bodyObj) => {
      const body = JSON.stringify({
        requestData: await juicyEncrypt(JSON.stringify(bodyObj)),
      });
      const response = await fetch(`https://www.juicychat.ai${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'secretkey': JUICYCHAT_SECRET_KEY,
          'appversion': '0.1.38',
          'client': 'pc',
          'platformtype': 'web',
          'system': 'other',
          'language': 'es'
        },
        body,
      });
      if (!response.ok) {
        throw new Error(`JuicyChat ${path} respondió ${response.status}`);
      }
      const payload = await response.json();
      if (!payload?.responseData) {
        throw new Error(`JuicyChat ${path}: respuesta sin responseData`);
      }
      const inner = JSON.parse(await juicyDecrypt(payload.responseData));
      if (String(inner?.code) !== '200') {
        throw new Error(`JuicyChat ${path}: ${inner?.msg || 'sin datos'}`);
      }
      return inner.data;
    };

    const detail = await postEncrypted('/yume/api/user/v1/character/getCharacterDetail', { characterId: String(characterId) });

    // Galería completa (albumList + galleryList) — opcional si falla
    let gallery = null;
    try {
      gallery = await postEncrypted('/yume/api/user/v1/character/picture/getCharacterPictureData', { characterId: String(characterId) });
    } catch (err) {
      console.warn('JuicyChat: no se pudo cargar la galería (opcional)', err);
    }

    // Para cada galería temática (galleryList) intentar traer sus fotos individuales.
    // Si el endpoint acepta la petición pública, recuperamos las URL claras; si está
    // tras paywall (unlockPrice > 0) devuelve sólo los blurred, lo cual se detecta.
    if (gallery?.galleryList?.length) {
      const galleries = await Promise.allSettled(
        gallery.galleryList.map(async (g) => {
          if (!g?.galleryId) return null;
          try {
            const pics = await postEncrypted(
              '/yume/api/user/v1/gallery/galleryPicturePage',
              { galleryId: String(g.galleryId), pageNo: 1, pageSize: 100, needLoginUserData: false }
            );
            return { gallery: g, pics: pics?.list ?? pics ?? [] };
          } catch {
            return { gallery: g, pics: [] };
          }
        })
      );
      gallery.expandedGalleries = galleries
        .filter((r) => r.status === 'fulfilled' && r.value)
        .map((r) => r.value);
    }

    return { ...detail, _gallery: gallery };
  }

  toCardFields(raw) {
    const personality = Array.isArray(raw.personality)
      ? raw.personality.filter(Boolean).join(', ')
      : (raw.personality || '');

    // La greeting/introduction pueden llevar markdown ![](url) para previews
    // inline del sitio; SillyTavern no las sirve (CORS). Se quitan.
    const stripInlineImages = (s) => (s || '').replace(/!\[[^\]]*\]\(https?:[^)]+\)/g, '').trim();

    // `setting` es el campo que describe realmente al personaje
    // ("{{char}} is Hazel (step-mom), Veronica..."). Es el equivalente directo del
    // campo Description de SillyTavern, así que va allí (no a personality).
    // `introduction` es solo el pitch de marketing de la card, va a creator_notes.
    const setting = stripInlineImages(raw.setting || '');
    const intro = stripInlineImages(raw.introduction || raw.description || '');
    const desc = setting || intro;

    // sceneCard: tarjeta de escena (defaultScene, displayType) — útil como extra
    let sceneCardNote = '';
    try {
      const sc = typeof raw.sceneCard === 'string' ? JSON.parse(raw.sceneCard) : raw.sceneCard;
      if (sc && typeof sc === 'object') {
        const parts = [];
        if (sc.defaultScene != null) parts.push(`defaultScene=${sc.defaultScene}`);
        if (sc.displayType != null) parts.push(`displayType=${sc.displayType}`);
        if (parts.length) sceneCardNote = parts.join(', ');
      }
    } catch { /* sceneCard no es JSON */ }

    // Galería: cada imagen lleva su propio switch de paywall — clearPictureUrl SOLO
    // viene en el payload si el usuario actual la desbloqueó o es gratis (unlockCoin 0).
    // imagePrompt es JSON string doble-escapado con los tags SDXL completos.
    const parsePrompt = (raw) => {
      if (!raw) return null;
      try {
        const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
        // Recoger los campos no vacíos en una línea legible para editor
        const order = ['illustration_description', 'action', 'background', 'dressing_situation', 'interaction_with_the_viewer', 'viewer_exposed_limbs'];
        const parts = order
          .map((k) => (j[k] ? String(j[k]).trim() : null))
          .filter(Boolean);
        if (!parts.length) return null;
        return parts.join('\n');
      } catch {
        return typeof raw === 'string' ? raw : null;
      }
    };

    // Solo las desbloqueadas traen clearPictureUrl
    const unlockedPics = [];
    const lockedPics = [];

    const pushPic = (item) => {
      if (!item) return;
      const info = {
        pictureId: item.pictureId,
        clearUrl: item.clearPictureUrl ?? null,
        blurUrl: item.blurPictureUrl ?? null,
        prompt: parsePrompt(item.imagePrompt),
        inputContent: item.inputContent || null, // senario que originó la imagen (con {{user}})
        unlockCoin: typeof item.unlockCoin === 'number' ? item.unlockCoin : null,
        proportion: item.imageProportion ?? null,
        createType: item.createType ?? null,
      };
      if (info.clearUrl) {
        unlockedPics.push(info);
      } else if (info.blurUrl) {
        lockedPics.push(info);
      }
    };

    for (const albumItem of raw._gallery?.albumList ?? []) {
      pushPic(albumItem);
    }
    for (const gal of raw._gallery?.expandedGalleries ?? []) {
      for (const pic of gal.pics ?? []) {
        pushPic({ ...pic, clearPictureUrl: pic.pictureUrl, blurPictureUrl: pic.maskPictureUrl });
      }
    }
    // Cubiertas de galería (portada siempre libre)
    const galleryCovers = (raw._gallery?.galleryList ?? [])
      .map((g) => g?.coverUrl ?? null)
      .filter(Boolean);

    const lockedCount = lockedPics.length;

    // Prompts de las desbloqueadas, resumidos como texto (uno por línea, con índice
    // para que el usuario vea qué imágenes pueden regenerarse).
    // Las bloqueadas solo tienen blur: su prompt también se guarda como nota inutilizable.
    const promptsFromUnlocked = unlockedPics
      .map((p, i) => (p.prompt ? `#${i + 1} [${p.proportion === 0 ? 'H' : 'V'}]: ${p.prompt}` : null))
      .filter(Boolean);
    const promptsDebug = lockedPics.length
      ? `\n\n† ${lockedPics.length} imágenes están tras paywall (solo blurred).`
      : '';

    const unlockedUrls = unlockedPics.map((p) => p.clearUrl);

    // Assets para .charx (opción B elegida):
    //   characterPhoto            → 'background'  (imagen principal del chat)
    //   albumList[].clearPictureUrl → 'misc'      (ST los guarda en
    //   galleryList[].coverUrl                    user/images/<Personaje>/)
    // No van como 'expression' porque no son reacciones emocionales sino
    // escenas distintas: marcarlas así haría que ST las mostrara al azar.
    const charxAssets = [];
    if (raw.characterPhoto) {
      charxAssets.push({ name: 'main_photo', type: 'background', url: raw.characterPhoto });
    }
    unlockedPics.forEach((pic, i) => {
      charxAssets.push({ name: `album_${i + 1}`, type: 'misc', url: pic.clearUrl });
    });
    galleryCovers.forEach((url, i) => {
      charxAssets.push({ name: `gallery_${i + 1}`, type: 'misc', url });
    });

    return {
      name: raw.characterName || raw.nickname || 'JuicyChat character',
      description: desc,
      personality,
      scenario: stripInlineImages(raw.scenario || ''),
      first_mes: stripInlineImages(raw.greeting || raw.firstMessage || ''),
      mes_example: stripInlineImages(raw.exampleConversation?.[0] || ''),
      // introduction es el pitch de la card, no la descripción -> creator_notes
      authorNote: stripInlineImages(raw.authorNote || raw.author_note || '') || intro,
      tags: Array.isArray(raw.characterTags) ? raw.characterTags : [],
      creator: raw.characterUserInfo?.userName || raw.userName || '',
      age: raw.characterAge ?? null,
      // preferir thumb: siempre JPEG estático (characterPhoto a veces es GIF)
      avatarUrl: raw.characterThumb || raw.characterPhoto || null,
      backgroundUrls: [raw.characterPhoto, raw.characterThumb, ...unlockedUrls, ...galleryCovers]
        .filter((u, i, a) => u && a.indexOf(u) === i),
      extraInfo: [
        sceneCardNote ? `sceneCard: ${sceneCardNote}` : '',
        raw.figureId ? `figureId: ${raw.figureId}` : '',
        typeof raw.chatCount === 'number' ? `chatCount: ${raw.chatCount}` : '',
        typeof raw.galleryCount === 'number' ? `galleryCount: ${raw.galleryCount}` : '',
        typeof raw.genPictureCount === 'number' ? `genPictureCount: ${raw.genPictureCount}` : '',
      ].filter(Boolean).join('\n'),
      galleryInfo: {
        albumCount: (raw._gallery?.albumList ?? []).length,
        galleryCount: (raw._gallery?.galleryList ?? []).length,
        unlockedCount: unlockedUrls.length,
        lockedCount,
        prompts: promptsFromUnlocked.length ? promptsFromUnlocked.join('\n') + promptsDebug : null,
      },
      charxAssets,
    };
  }
}

/**
 * Emochi (flowgpt infra): los endpoints /api/prompt/{id} del backend K8s
 * (emochi-backend-k8s.flowgpt.com) devuelven 403 sin sesión válida y el
 * site se basa en Next.js SSR: toda la info de la página de personaje ya
 * viene server-side en el HTML. En lugar de probar endpoints posteópad
 * con CORS, leemos el HTML y parseamos los datos visibles:
 *
 *   - JSON-LD (script type="application/ld+json") con Person
 *   - og-title / og-description / og-image meta tags
 *   - link/body markdown-trimmed intro text
 *   - creator link: /prompt/bot-creator-profile?creatorId=XXX&promptId=YYY
 *
 * El HTML incluye siempre: título, intro/descripción, tags (visibles como
 * lastwords after dots / keywords SEO), avatar (trans-images/prompt/{id}/{ts}.webp),
 * creatorId y prompt_id. No incluye first_mes (ese es un campo de sesión).
 */
export class EmochiProvider extends CharacterProvider {
  constructor() {
    super('emochi');
  }

  canHandle(url) {
    return /(^|\.)emochi\.com$/i.test(new URL(url).hostname) && this.extractId(url) !== null;
  }

  extractId(url) {
    // URLs tipo /character/chomiks-text-adventure o /character/{name}-{id}/chat
    const m = String(url).match(/\/character\/([a-z0-9][\w-]*?)(?:\/chat)?(?:[?#]|$)/i);
    return m ? m[1] : null;
  }

  async fetchRaw(slug) {
    const response = await fetch(`https://emochi.com/character/${encodeURIComponent(slug)}`, {
      headers: { 'Accept': 'text/html' },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`Emochi respondió ${response.status} al cargar la página del personaje.`);
    }
    const html = await response.text();
    return this.parseHtml(html, slug);
  }

  /**
   * Parsea el HTML SSR de Emochi. Cada dato viene de:
   * - <title>Nombre Profile on Emochi...</title>
   * - meta og:title / og:description / og:image
   * - JSON-LD ProfilePage + Person (name, description en algunos jsonld)
   * - link "Created by @XXX" -> roto: aparece en el texto
   * - Intro text: viene tras el heading "Intro" marcado como <div>Intro</div>
   * - tags: vienen tras "Created by" line como palabras separadas por comas
   *
   * Es un scrape tolerante a cambios menores del HTML.
   */
  parseHtml(html, slug) {
    // --- JSON-LD (datos principales) ---
    let jsonld = {};
    const ldBlocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of ldBlocks) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed['@type'] === 'ProfilePage') {
          jsonld = parsed;
          break;
        }
      } catch {
        /* ignorar bloques malformed */
      }
    }

    const person = jsonld.mainEntity || {};
    const profile = jsonld;

    // --- Meta tags fallback ---
    const meta = (name) => {
      const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i');
      const m = html.match(re);
      return m ? m[1] : null;
    };

    // --- Nombre (og:title o title fallback) ---
    const ogTitle = meta('og:title') || '';
    const name = person.name
      || ogTitle.replace(/ Profile on Emochi.*/i, '').replace(/ Profile \|.*/i, '').trim()
      || slug;

    // --- Descripción larga (intro) ---
    // El texto plano tras <div>Intro</div> / debajo de la imagen. A veces es el toc que sigue a "Creator".
    let introBody = '';

    // Buscar la zona entre "Creator" section y el siguiente heading (AdventureComedy...)
    // Patrón observado: ...Created by @X<br>... more text ... Intro ...  * tags ... description
    // Mejor: buscar en orden los dos últimos bloques de texto plano que contienen las "more" sentences
    const plain = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'");

    const lines = plain.split('\n').map((l) => l.trim()).filter((l) => l.length > 40);
    // La intro suele ser el bloque con más texto natural (no badge, no slogans)
    for (const line of lines) {
      if (/is (le|a|an|the|your|your's|my|(.+)).*funny|adventure|story|roleplay|fantasy|scenari/i.test(line)
          && line.length > introBody.length) {
        introBody = line;
      }
    }
    // Si no encontramos intro por patrón, tomamos el bloque con más contenido tras 'Created by'
    if (!introBody) {
      const createdIdx = plain.indexOf('Created by');
      if (createdIdx > 0) {
        introBody = plain.slice(createdIdx, createdIdx + 4000).split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 40 && !l.startsWith('http'))
          .join('\n\n');
      }
    }

    // --- Tags: vienen tras "Intro" como líneas separadas "Adventure\n\nComedy\n\nGuide..."
    let tags = [];
    const introIdx = plain.indexOf('\nIntro\n');
    if (introIdx > 0) {
      const afterIntro = plain.slice(introIdx, introIdx + 400).split('\n');
      const stopAt = afterIntro.findIndex((l, i) => i > 0 && l.trim() === '...');
      const slice = (stopAt > 0 ? afterIntro.slice(1, stopAt) : afterIntro.slice(1, 15));
      // Convertir "\n\n" de formato de bloques a items únicos, y aplanar camelCase
      const lines = slice.map((l) => l.trim()).filter((l) => l && l !== 'Intro');
      const flatTags = new Set();
      for (const line of lines) {
        // cada línea puede ser "Adventure" O "AdventureComedyGuide" (si el HTML puso un solo bloque con join)
        const parts = line.split(/(?=[A-Z])/).filter(Boolean);
        for (const p of parts) {
          if (/^[A-Z][A-Za-z]+$/.test(p) && !/^[A-Z]{2}/.test(p)) flatTags.add(p);
        }
      }
      tags = Array.from(flatTags).filter(Boolean);
    }
    // Si no encontramos tags por el patrón, extralos del title/keywords SEO
    if (!tags.length) {
      const mKeywords = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);
      if (mKeywords) {
        tags = mKeywords[1].split(',').map((t) => t.trim()).filter((t) => t && t.length < 25 && !/^(character|ai|roleplay|Anime)$/i.test(t)).slice(0, 8);
      }
    }

    // --- Creator ---
    let creator = person.author?.name || person['@creator']?.name || '';
    if (!creator) {
      const match = html.match(/type\s*=\s*literal[^>]*>@([\w\.~\- ]+)/)
        || html.match(/Created by\s*@?([A-Za-z0-9_\.\- ]+)/)
        || html.match(/by\s*@([\w\.\- ]+)/i);
      if (match) creator = match[1].trim();
    }

    // --- Avatar ---
    // og:image siempre trae trans-images/prompt/... preferir la no-trans-image (sin CDN transform)
    const ogImg = meta('og:image') || '';
    let avatarUrl = ogImg || null;
    // Buscar la versión no-trans-image (raw) en el HTML
    const rawImgMatch = html.match(/(https:\/\/image-cdn\.flowgpt\.com\/(?:prompt|avatars)\/[^\s"'\)\]<>,\\]+)/i);
    if (rawImgMatch) avatarUrl = rawImgMatch[1];
    // Limpiar \\ al final si existe
    if (avatarUrl) avatarUrl = avatarUrl.replace(/\\+$/, '');

    // --- El greeting no viene en el HTML público (es campo de sesión). Se usa la intro. ---
    const greeting = introBody;

    // --- PromptId (para extensiones) ---
    let promptId = person.identifier
      || html.match(/promptId=([A-Za-z0-9_\-]+)/)?.[1]
      || null;
    // Rescatar del og:image si viene ahí
    if (!promptId && avatarUrl) {
      const m = avatarUrl.match(/\/prompt\/([A-Za-z0-9_\-]+)\//);
      if (m) promptId = m[1];
    }

    return {
      name,
      description: introBody,
      personality: '',
      scenario: '',
      first_mes: greeting,
      mes_example: '',
      promptId,
      tags,
      creator,
      avatarUrl,
      backgroundUrls: [],
      _emochi: { ogDesc: person.description || '' },
    };
  }

  toCardFields(raw) {
    return {
      name: raw.name,
      description: raw.description,
      personality: raw.personality,
      scenario: raw.scenario,
      first_mes: raw.first_mes,
      mes_example: raw.mes_example,
      tags: raw.tags,
      creator: raw.creator,
      avatarUrl: raw.avatarUrl,
      backgroundUrls: raw.backgroundUrls ?? [],
      emochiNotes: `PromptId: ${raw.promptId || 'desconocido'} | Extracto de página pública — el greeting original solo aparece al estar logueado.`,
    };
  }
}

export const PROVIDERS = [new MoescapeProvider(), new TipsyProvider(), new JuicyChatProvider(), new EmochiProvider()];

/**
 * Devuelve el primer proveedor que reconoce la URL.
 * @param {string} url
 * @returns {CharacterProvider|null}
 */
export function detectProvider(url) {
  try {
    return PROVIDERS.find((p) => p.canHandle(url)) || null;
  } catch {
    return null;
  }
}

/**
 * Detecta la fuente según la URL, extrae los datos del personaje y devuelve
 * un objeto CharacterCard v2 compatible con SillyTavern.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, rawJson?: object|null }} [options]
 *   rawJson: si se pasa, se usa directamente como payload (bypas de CORS con
 *   JSON pegado manualmente) y no se hace fetch.
 * @returns {Promise<{card: object, avatarUrl: string|null, backgroundUrls: string[]}>}
 */
export async function importCharacterFromUrl(url, options = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('URL vacía o inválida');
  }

  const provider = detectProvider(url);
  if (!provider) {
    const known = PROVIDERS.map((p) => p.name).join(', ');
    throw new Error(`URL no reconocida. Proveedores soportados: ${known}.`);
  }

  const id = provider.extractId(url);
  if (!id) {
    throw new Error(`No se pudo extraer el ID del personaje de la URL para ${provider.name}.`);
  }

  let raw;
  if (options.rawJson) {
    raw = options.rawJson?.data?.character ?? options.rawJson;
  } else {
    try {
      raw = await provider.fetchRaw(id);
    } catch (error) {
      if (error instanceof TypeError) {
        // Típico fallo de red/CORS en navegador ("Failed to fetch")
        throw new Error(
          'El sitio bloquea CORS. Usa el proveedor "Importar por JSON": pega el JSON del personaje, o pide al autor un endpoint con CORS habilitado.'
        );
      }
      throw error;
    }
  }

  return await provider.toCharacterCard(raw, url, options);
}

/**
 * Construye un PNG con la imagen dada y la tarjeta embebida en chunk `chara`.
 * Si la imagen no es PNG (JPEG/WebP), la convierte con OffscreenCanvas.
 * @param {Blob|ArrayBuffer} imageData
 * @param {object} card Chara card v2
 * @returns {Promise<Blob>}
 */
export async function buildCharacterCardPng(imageData, card) {
  if (!imageData) {
    throw new Error('Se requiere una imagen de avatar');
  }
  if (!card || card.spec !== 'chara_card_v2') {
    throw new Error('Se requiere una tarjeta chara_card_v2 válida');
  }

  let blob = imageData instanceof Blob ? imageData : new Blob([imageData]);

  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const isPng = PNG_MAGIC.every((b, i) => head[i] === b);

  if (!isPng) {
    // Convertir a PNG: el chunk chara solo es válido dentro de un PNG real
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    blob = await canvas.convertToBlob({ type: 'image/png' });
  }

  const arrayBuffer = await blob.arrayBuffer();
  const chunks = parsePNGChunks(arrayBuffer);

  const payload = btoa(unescape(encodeURIComponent(JSON.stringify(card))));
  const newChunk = { type: 'tEXt', dataBytes: buildTextChunkBytes('chara', payload) };

  const filtered = chunks.filter((chunk) => {
    if (chunk.type !== 'tEXt') return true;
    const raw = new TextDecoder('latin1').decode(chunk.dataBytes);
    const [key] = raw.split('\x00', 1);
    return key !== 'chara';
  });

  // Insertar el chunk chara antes de IEND
  const iendIndex = filtered.findIndex((c) => c.type === 'IEND');
  const insertAt = iendIndex >= 0 ? iendIndex : filtered.length;
  filtered.splice(insertAt, 0, newChunk);

  const out = buildPNG(filtered);
  return new Blob([out], { type: 'image/png' });
}
