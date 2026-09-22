import { preserveVariables, restoreVariables, sleep } from './utils.js';
import { translateText } from './translateProviders.js';
import { getSTContext } from './stContext.js';

const CHARACTER_TRANSLATION_KEYS = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'mes_example',
  'example',
  'note',
  'notes',
  'comment',
  'bio',
  'long_description',
  'summary',
]);

const CHARACTER_TRANSLATION_PATTERNS = [
  /name/i,
  /description/i,
  /personality/i,
  /scenario/i,
  /example/i,
  /note/i,
  /comment/i,
  /bio/i,
];

export function shouldTranslateCharacterField(key) {
  if (typeof key !== 'string') {
    return false;
  }

  const normalized = key.toLowerCase();
  return CHARACTER_TRANSLATION_KEYS.has(normalized) || CHARACTER_TRANSLATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export async function translateCharacterData(character, sourceLang = 'auto', targetLang = 'es', providerConfig = { provider: 'openai' }) {
  if (Array.isArray(character)) {
    return Promise.all(character.map((item) => translateCharacterData(item, sourceLang, targetLang, providerConfig)));
  }

  if (!character || typeof character !== 'object') {
    return character;
  }

  const translated = { ...character };
  for (const [key, value] of Object.entries(translated)) {
    if (typeof value === 'string' && shouldTranslateCharacterField(key)) {
      const { text: protectedText, tokenMap } = preserveVariables(value);
      const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
      translated[key] = restoreVariables(translatedText, tokenMap);
      continue;
    }

    if (Array.isArray(value)) {
      translated[key] = await Promise.all(value.map(async (item) => {
        if (typeof item === 'string' && shouldTranslateCharacterField(key)) {
          const { text: protectedText, tokenMap } = preserveVariables(item);
          const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
          return restoreVariables(translatedText, tokenMap);
        }
        if (item && typeof item === 'object') {
          return translateCharacterData(item, sourceLang, targetLang, providerConfig);
        }
        return item;
      }));
      continue;
    }

    if (value && typeof value === 'object') {
      translated[key] = await translateCharacterData(value, sourceLang, targetLang, providerConfig);
    }
  }

  return translated;
}

export async function translateCharacters(characters, sourceLang = 'auto', targetLang = 'es', batchDelay = 500, providerConfig = { provider: 'openai' }) {
  if (!characters) {
    return characters;
  }

  if (Array.isArray(characters)) {
    const result = [];
    for (const character of characters) {
      result.push(await translateCharacterData(character, sourceLang, targetLang, providerConfig));
      await sleep(batchDelay);
    }
    return result;
  }

  return translateCharacterData(characters, sourceLang, targetLang, providerConfig);
}

// ---------------------------------------------------------------------------
// API oficial de SillyTavern — Personajes
// ---------------------------------------------------------------------------

/**
 * Devuelve todos los personajes registrados en SillyTavern (API oficial).
 * Lee el array `ctx.characters` directamente — es la fuente canónica.
 * NO llamar a ctx.getCharacters(): no devuelve datos (muta el array y
 * re-renderiza la UI de ST como side-effect, señal de uso interno).
 *
 * @returns {Promise<Array<{id: string, name: string, data: object}>>}
 */
export async function getAvailableCharacters() {
  let ctx;
  try {
    ctx = getSTContext();
  } catch (err) {
    console.warn('ST Translator: contexto ST no disponible aún', err?.message);
    return [];
  }

  const list = Array.isArray(ctx.characters) ? ctx.characters : [];

  return list
    .filter((c) => c && (c.name || c.avatar))
    .map((c, index) => ({
      id: c.avatar || `char-${index}`,   // id estable: nombre de fichero PNG/avatar
      name: c.name ?? c.avatar ?? 'Desconocido',
      data: c,
    }));
}

/**
 * Búsqueda de personajes (client-side filter sobre la lista oficial).
 */
export async function searchCharacters(query) {
  const all = await getAvailableCharacters();
  if (!query || typeof query !== 'string') {
    return all;
  }
  const term = query.toLowerCase().trim();
  return all.filter((item) => item.name.toLowerCase().includes(term));
}

// ---------------------------------------------------------------------------
// API oficial de SillyTavern — Lorebooks
// ---------------------------------------------------------------------------

/**
 * Devuelve la lista de lorebooks instalados (nombre = id para ST).
 * Usa `getWorldInfoNames()` que expone los nombres de fichero sin extensión.
 *
 * @returns {Promise<Array<{id: string, name: string, data: null}>>}
 */
export async function getAvailableLorebooks() {
  let ctx;
  try {
    ctx = getSTContext();
  } catch (err) {
    console.warn('ST Translator: contexto ST no disponible aún, lorebooks vacíos', err?.message);
    return [];
  }

  if (typeof ctx.getWorldInfoNames !== 'function') {
    console.warn('ST Translator: getWorldInfoNames no está disponible en el contexto ST');
    return [];
  }

  const names = ctx.getWorldInfoNames();
  return names.map((name) => ({
    id: name,
    name,
    data: null, // se carga bajo demanda con loadLorebookById
  }));
}

/**
 * Carga el contenido completo de un lorebook por su nombre.
 * La API real de ST devuelve `{ entries: { uid: entry } }` (objeto, no array).
 *
 * @param {string} name - Nombre del lorebook (sin extensión)
 * @returns {Promise<{name: string, entries: Array}|null>}
 */
export async function loadLorebookById(name) {
  const ctx = getSTContext();
  const data = await ctx.loadWorldInfo(name);
  if (!data?.entries) {
    return null;
  }
  return {
    name,
    entries: Object.values(data.entries),
  };
}

/**
 * Traduce un lorebook completo (entries).
 * Acepta tanto `{ entries: Array }` como `{ entries: { uid: entry } }`.
 *
 * @param {object} book - Lorebook con clave `entries`
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {number} batchDelay
 * @param {object} providerConfig
 * @returns {Promise<object>} Lorebook traducido (entries como array)
 */
export async function translateLorebook(book, sourceLang = 'auto', targetLang = 'es', batchDelay = 500, providerConfig = { provider: 'openai' }) {
  if (!book) {
    return book;
  }

  const entries = Array.isArray(book.entries)
    ? book.entries
    : Object.values(book.entries ?? {});

  const outEntries = [];
  for (const entry of entries) {
    const copy = { ...entry };
    for (const field of ['content', 'key', 'comment']) {
      const value = copy[field];
      const strings = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? [value] : null);

      if (!strings) {
        continue;
      }

      const translated = [];
      for (const s of strings) {
        const { text: protectedText, tokenMap } = preserveVariables(s);
        const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
        translated.push(restoreVariables(translatedText, tokenMap));
      }
      copy[field] = Array.isArray(value) ? translated : translated[0];
    }
    outEntries.push(copy);
    await sleep(batchDelay);
  }

  return { ...book, entries: outEntries };
}
