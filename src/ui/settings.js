import { DEFAULT_ENDPOINTS, SUPPORTED_TRANSLATION_PROVIDERS } from '../translateProviders.js';
import { SETTINGS_KEY, LEGACY_SETTINGS_KEYS } from '../extensionInfo.js';

/** Clave propia dentro de `extension_settings`. Ver extensionInfo.js. */
export const MODULE_NAME = SETTINGS_KEY;

export const DEFAULT_SETTINGS = {
  sourceLang: 'auto',
  targetLang: 'es',
  providerSelect: 'st_backend',
  apiUrl: '',
  modelInput: '',
  connectionModeSelect: 'manual',
  apiKey: '',
  useProfileProvider: false,
  apiKeyProfileSelect: '',
  batchDelay: 500,
  outputFolder: '',
};

/**
 * Recoge los ajustes que se guardaron bajo las claves antiguas y los lleva a la
 * actual, sin perder nada.
 *
 * `translate` era una clave RESERVADA de ST (`extensions.js:193`), en uso por su
 * propia extensión de traducción, así que ahí conviven sus campos
 * (`target_language`, `provider`, `deepl_endpoint`...) con los nuestros
 * (`providerSelect`, `connectionModeSelect`...). De esa clave solo se copian
 * los campos que existen en DEFAULT_SETTINGS: lo demás es de ST y no se toca.
 *
 * `stTranslate` era solo nuestra (la caché de modelos), así que se migra
 * entera. Esa caché es volátil y se puede perder sin consequencia.
 */
function migrateLegacySettings(extensionSettings) {
  const viejo = extensionSettings.translate;
  if (viejo && typeof viejo === 'object' && !Array.isArray(viejo)) {
    const nuestros = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in viejo) nuestros[key] = viejo[key];
    }
    if (Object.keys(nuestros).length) {
      extensionSettings[SETTINGS_KEY] = { ...extensionSettings[SETTINGS_KEY], ...nuestros };
    }
  }

  const cacheVieja = extensionSettings.stTranslate;
  if (cacheVieja && typeof cacheVieja === 'object' && !Array.isArray(cacheVieja)) {
    extensionSettings[SETTINGS_KEY] = { ...extensionSettings[SETTINGS_KEY], ...cacheVieja };
    delete extensionSettings.stTranslate;
  }
}

export function getSettings() {
  const context = globalThis.SillyTavern?.getContext?.();
  const extensionSettings = context?.extensionSettings;
  if (!extensionSettings) {
    return { ...DEFAULT_SETTINGS };
  }
  if (!extensionSettings[SETTINGS_KEY]) {
    extensionSettings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
  }
  migrateLegacySettings(extensionSettings);
  return { ...DEFAULT_SETTINGS, ...extensionSettings[SETTINGS_KEY] };
}

export function saveSettings(partial = {}) {
  const context = globalThis.SillyTavern?.getContext?.();
  if (!context?.extensionSettings) {
    console.warn('[ST-Translator] saveSettings called before extensionSettings available');
    return;
  }
  if (!context.extensionSettings[MODULE_NAME]) {
    context.extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
  }
  Object.assign(context.extensionSettings[MODULE_NAME], partial);
  context.saveSettingsDebounced?.();
}

const FIELD_KEYS = [
  'sourceLang', 'targetLang', 'providerSelect', 'apiUrl', 'modelInput',
  'connectionModeSelect', 'apiKey', 'useProfileProvider', 'apiKeyProfileSelect',
  'batchDelay', 'outputFolder',
];

const DEFAULT_SOURCE_LANG = 'auto';
const DEFAULT_TARGET_LANG = 'es';
const DEFAULT_PROVIDER = 'openai';
const DEFAULT_CONNECTION_MODE = 'manual';

export function populateForm() {
  const settings = getSettings();
  const sourceLangEl = document.getElementById('sourceLang');
  if (sourceLangEl && settings.sourceLang) {
    sourceLangEl.value = settings.sourceLang;
  }
  const targetLangEl = document.getElementById('targetLang');
  if (targetLangEl && settings.targetLang) {
    targetLangEl.value = settings.targetLang;
  }
  const providerEl = document.getElementById('providerSelect');
  if (providerEl && settings.providerSelect) {
    providerEl.value = settings.providerSelect;
  }
  const modelEl = document.getElementById('modelInput');
  if (modelEl && settings.modelInput !== undefined) {
    modelEl.value = settings.modelInput;
  }
  const urlEl = document.getElementById('apiUrl');
  if (urlEl && settings.apiUrl) {
    urlEl.value = settings.apiUrl;
  }
  const modeEl = document.getElementById('connectionModeSelect');
  if (modeEl && settings.connectionModeSelect) {
    modeEl.value = settings.connectionModeSelect;
  }
  const keyEl = document.getElementById('apiKey');
  if (keyEl && settings.apiKey) {
    keyEl.value = settings.apiKey;
  }
  const profileEl = document.getElementById('useProfileProvider');
  if (profileEl) {
    profileEl.checked = Boolean(settings.useProfileProvider);
  }
  const profileSelectEl = document.getElementById('apiKeyProfileSelect');
  if (profileSelectEl && settings.apiKeyProfileSelect) {
    profileSelectEl.value = settings.apiKeyProfileSelect;
  }
  const delayEl = document.getElementById('batchDelay');
  if (delayEl && settings.batchDelay) {
    delayEl.value = settings.batchDelay;
  }
  const folderEl = document.getElementById('outputFolder');
  if (folderEl && settings.outputFolder) {
    folderEl.value = settings.outputFolder;
  }
}

export function bindAutoSave() {
  for (const key of FIELD_KEYS) {
    const el = document.getElementById(key);
    if (!el || el.dataset.autoSaveBound === 'true') continue;
    el.dataset.autoSaveBound = 'true';
    const eventType = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventType, () => {
      let value = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') {
        value = Number(value);
      }
      saveSettings({ [key]: value });
    });
  }
}