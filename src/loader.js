import { initializeTranslator, initializeExtensionPanel, onActivate } from './index.js';

onActivate();

window.STUniversalTranslatorModule = { initializeTranslator, initializeExtensionPanel, onActivate };
