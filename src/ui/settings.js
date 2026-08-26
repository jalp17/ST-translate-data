import { DEFAULT_ENDPOINTS, SUPPORTED_TRANSLATION_PROVIDERS } from '../translateProviders.js';

export const MODULE_NAME = 'translate';

export const DEFAULT_SETTINGS = {
  sourceLang: 'auto',
  targetLang: 'es',
  provider: 'openai',
  apiUrl: '',
  model: '',
  connectionMode: 'manual',
  apiKey: '',
  useProfileProvider: false,
  apiKeyProfile: '',
  batchDelay: 500,
  outputFolder: '',
};

export function getSettings() {
  const context = globalThis.SillyTavern?.getContext?.();
  const extensionSettings = context?.extensionSettings;
  if (!extensionSettings) {
    return { ...DEFAULT_SETTINGS };
  }
  if (!extensionSettings[MODULE_NAME]) {
    extensionSettings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
  }
  return { ...DEFAULT_SETTINGS, ...extensionSettings[MODULE_NAME] };
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