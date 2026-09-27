import { parsePNGChunks, buildPNG, buildTextChunkBytes } from './png.js';
import { juicyEncrypt, juicyDecrypt, JUICYCHAT_SECRET_KEY } from './juicychatCrypto.js';

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
   */
  toCharacterCard(raw, url) {
    const f = this.toCardFields(raw);
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
          creator_notes: `Extracted from ${url}`,
          system_prompt: '',
          post_history_instructions: '',
          alternate_greetings: [],
          character_book: null,
          tags: ['ideas', ...(f.tags || [])],
          creator: f.creator || '',
          character_version: '1.0',
          extensions: { source_url: url, source_service: this.name, gallery: f.galleryInfo ?? null },
        },
      },
      avatarUrl: f.avatarUrl || null,
      backgroundUrls: f.backgroundUrls || [],
      galleryInfo: f.galleryInfo ?? null,
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
      tags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
      creator: raw.creator_name || '',
      avatarUrl: raw.thumbnail_photo?.url || raw.background_photos?.[0]?.url || null,
      backgroundUrls: (raw.background_photos || []).map((p) => p?.url).filter(Boolean),
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
    const response = await fetch('https://api.tipsy.chat/api/v1/character/get/public', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, nsfw: true, language_code: 'es' }),
    });
    if (!response.ok) {
      throw new Error(`Tipsy respondió ${response.status} para el personaje ${characterId}`);
    }
    const payload = await response.json();
    if (payload?.code !== 0 || !payload?.data?.character) {
      throw new Error('Tipsy no devolvió datos de personaje válidos');
    }
    return payload.data.character;
  }

  toCardFields(raw) {
    const avatar = raw.image_url || raw.image || raw.animated_image_url || null;
    return {
      name: raw.nickname || raw.name || 'Tipsy character',
      description: raw.description || '',
      personality: raw.personality || '',
      scenario: raw.scenario || '',
      first_mes: raw.first_message || raw.first_mes || '',
      mes_example: raw.example_dialogue || raw.msg_example || '',
      tags: Array.isArray(raw.tags) ? raw.tags.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean) : [],
      creator: raw.creator_name || raw.author_name || '',
      avatarUrl: avatar && !/^https?:/i.test(avatar) ? `https://img.tipsy.chat/${avatar.replace(/^\//, '')}` : avatar,
      backgroundUrls: [],
    };
  }
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

    const desc = stripInlineImages(raw.introduction || raw.description || '');

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

    return {
      name: raw.characterName || raw.nickname || 'JuicyChat character',
      description: desc,
      personality,
      scenario: stripInlineImages(raw.scenario || ''),
      first_mes: stripInlineImages(raw.greeting || raw.firstMessage || ''),
      mes_example: stripInlineImages(raw.exampleConversation?.[0] || ''),
      tags: Array.isArray(raw.characterTags) ? raw.characterTags : [],
      creator: raw.characterUserInfo?.userName || raw.userName || '',
      // preferir thumb: siempre JPEG estático (characterPhoto a veces es GIF)
      avatarUrl: raw.characterThumb || raw.characterPhoto || null,
      backgroundUrls: [raw.characterPhoto, raw.characterThumb, ...unlockedUrls, ...galleryCovers]
        .filter((u, i, a) => u && a.indexOf(u) === i),
      galleryInfo: {
        albumCount: (raw._gallery?.albumList ?? []).length,
        galleryCount: (raw._gallery?.galleryList ?? []).length,
        unlockedCount: unlockedUrls.length,
        lockedCount,
        prompts: promptsFromUnlocked.length ? promptsFromUnlocked.join('\n') + promptsDebug : null,
      },
    };
  }
}

export const PROVIDERS = [new MoescapeProvider(), new TipsyProvider(), new JuicyChatProvider()];

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

  return provider.toCharacterCard(raw, url);
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
