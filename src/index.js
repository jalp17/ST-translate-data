import * as utils from './utils.js';
import * as providers from './translateProviders.js';
import * as png from './png.js';
import * as characters from './characters.js';
import * as ui from './ui.js';
import * as settings from './ui/settings.js';

export async function initializeTranslator() {
  const translator = {
    translateCharacterCard: png.translateCharacterCard,
    translateCharacterData: characters.translateCharacterData,
    translateCharacters: characters.translateCharacters,
    translateImageBatch: png.translateImageBatch,
    getAvailableCharacters: characters.getAvailableCharacters,
    searchCharacters: characters.searchCharacters,
    getAvailableLorebooks: characters.getAvailableLorebooks,
    loadLorebookById: characters.loadLorebookById,
    translateLorebook: characters.translateLorebook,
    translateText: providers.translateText,
    preserveVariables: utils.preserveVariables,
    restoreVariables: utils.restoreVariables,
    saveBlobToDisk: utils.saveBlobToDisk,
    DEFAULT_TRANSLATION_PROVIDER: providers.DEFAULT_TRANSLATION_PROVIDER,
    SUPPORTED_TRANSLATION_PROVIDERS: providers.SUPPORTED_TRANSLATION_PROVIDERS,
  };

  window.STUniversalTranslator = translator;
  window.STTranslatorModules = { utils, providers, png, characters, ui, settings };
  return translator;
}

export async function onActivate() {
  await initializeTranslator();
  await initializeExtensionPanel();
}

export function initializeExtensionPanel() {
  return ui.initializeExtensionPanel();
}
