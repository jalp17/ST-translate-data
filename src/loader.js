import { initializeTranslator, initializeExtensionPanel, onActivate } from './index.js';

if (!window.STUniversalTranslatorInitialized) {
  window.STUniversalTranslatorInitialized = true;
  onActivate();
}

window.STUniversalTranslatorModule = { initializeTranslator, initializeExtensionPanel, onActivate };
