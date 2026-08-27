import { initializeTranslator, initializeExtensionPanel, onActivate } from './index.js';

console.log('[ST-translate-data] 🚀 LOADER START');
console.log('[ST-translate-data] SillyTavern global:', !!globalThis.SillyTavern);
console.log('[ST-translate-data] Already initialized:', !!window.STUniversalTranslatorInitialized);

if (!window.STUniversalTranslatorInitialized) {
  window.STUniversalTranslatorInitialized = true;
  console.log('[ST-translate-data] Calling onActivate...');
  onActivate()
    .then(() => console.log('[ST-translate-data] ✅ onActivate resolved'))
    .catch(err => console.error('[ST-translate-data] ❌ onActivate rejected:', err));
} else {
  console.log('[ST-translate-data] Skipping (already initialized)');
}

console.log('[ST-translate-data] Exposing module on window.STUniversalTranslatorModule');
window.STUniversalTranslatorModule = { initializeTranslator, initializeExtensionPanel, onActivate };