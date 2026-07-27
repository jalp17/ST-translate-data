import { preserveVariables, restoreVariables, sleep } from './utils.js';
import { translateText } from './translateProviders.js';

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

function isCharacterLike(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const hasName = Boolean(item.name || item.title || item.characterName || item.id || item.uuid);
  const hasCharacterField = Object.keys(item).some((key) => /name|description|personality|scenario|bio|note|comment|profile/i.test(key));
  return hasName && hasCharacterField;
}

export function normalizeCharacterSource(source) {
  if (!source) {
    return [];
  }
  if (Array.isArray(source)) {
    return source;
  }
  if (typeof source === 'object') {
    if (Array.isArray(source.items)) {
      return source.items;
    }
    if (Array.isArray(source.results)) {
      return source.results;
    }
    if (Array.isArray(source.data)) {
      return source.data;
    }
    return Object.values(source);
  }
  return [];
}

function scanWindowForCharacters() {
  const candidates = [];
  const keys = Object.keys(window).filter((key) => /character|persona|actor|npc/i.test(key));
  for (const key of keys) {
    candidates.push(...normalizeCharacterSource(window[key]));
  }

  if (window.SillyTavern && typeof window.SillyTavern === 'object') {
    const stKeys = Object.keys(window.SillyTavern).filter((key) => /character|persona|actor|npc|context/i.test(key));
    for (const key of stKeys) {
      candidates.push(...normalizeCharacterSource(window.SillyTavern[key]));
    }
  }

  if (window.ST && typeof window.ST === 'object') {
    const stKeys = Object.keys(window.ST).filter((key) => /character|persona|actor|npc|context/i.test(key));
    for (const key of stKeys) {
      candidates.push(...normalizeCharacterSource(window.ST[key]));
    }
  }

  return candidates;
}

export function getAvailableCharacters() {
  const sources = [
    window.getCurrentCharacters?.(),
    window.getCurrentCharacter?.(),
    window.getCharacters?.(),
    window.SillyTavern?.getContext?.()?.characters,
    window.SillyTavern?.characters,
    window.SillyTavern?.currentCharacters,
    window.ST?.characters,
    window.ST?.currentCharacters,
    window.characters,
    window.currentCharacters,
    window.characterList,
    window.allCharacters,
  ];

  const allItems = [];
  for (const source of sources) {
    allItems.push(...normalizeCharacterSource(source));
  }

  if (!allItems.length) {
    allItems.push(...scanWindowForCharacters());
  }

  const visibleItems = allItems.filter(isCharacterLike);
  const uniqueById = new Map();

  visibleItems.forEach((item, index) => {
    const id = item?.id ?? item?.uuid ?? `${item?.name ?? 'char'}-${index}`;
    if (!uniqueById.has(id)) {
      uniqueById.set(id, item);
    }
  });

  return Array.from(uniqueById.values()).map((item, index) => ({
    id: item?.id ?? item?.uuid ?? `char-${index}`,
    name: item?.name ?? item?.characterName ?? item?.title ?? `Personaje ${index + 1}`,
    data: item,
  }));
}

export function searchCharacters(query) {
  const all = getAvailableCharacters();
  if (!query || typeof query !== 'string') {
    return all;
  }
  const term = query.toLowerCase().trim();
  return all.filter((item) => item.name.toLowerCase().includes(term));
}

export function getAvailableLorebooks() {
  const candidates = [
    window.getCurrentLorebook?.(),
    window.SillyTavern?.getCurrentLorebook?.(),
    window.SillyTavern?.getContext?.()?.lorebook,
    window.SillyTavern?.lorebook,
    window.ST?.lorebook,
    window.lorebook,
    window.worldInfo,
    window.SillyTavern?.worldInfo,
  ];

  const found = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      found.push(...candidate);
    } else if (typeof candidate === 'object') {
      found.push(candidate);
    }
  }

  return found.map((item, index) => ({
    id: item?.id ?? item?.uuid ?? `lorebook-${index}`,
    name: item?.name ?? item?.title ?? `Lorebook ${index + 1}`,
    data: item,
  }));
}

export async function translateLorebook(lorebook, sourceLang = 'auto', targetLang = 'es', batchDelay = 500, providerConfig = { provider: 'openai' }) {
  if (!lorebook?.world_info?.entries) {
    return lorebook;
  }

  const translated = { ...lorebook };
  translated.world_info = { ...translated.world_info };
  translated.world_info.entries = [];

  for (const entry of lorebook.world_info.entries) {
    const copy = { ...entry };
    for (const field of ['content', 'key', 'comment']) {
      if (typeof copy[field] === 'string') {
        const { text: protectedText, tokenMap } = preserveVariables(copy[field]);
        const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
        copy[field] = restoreVariables(translatedText, tokenMap);
      }
    }
    translated.world_info.entries.push(copy);
    await sleep(batchDelay);
  }

  return translated;
}
