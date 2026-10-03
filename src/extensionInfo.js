/**
 * Nombres canonicos de la extension.
 *
 * Viven aqui, en un solo sitio, porque ST los deriva del `manifest.json` y del
 * nombre de la carpeta, y no de lo que diga el codigo. Duplicarlos era una
 * fuente de bugs:
 *
 * - El nombre de la carpeta lo sacaba ST con un regex atado al nombre del
 *   bundle (`.../dist/script.js`), asi que renombrar la salida dejaba el panel
 *   de ajustes sin cargar y sin error visible.
 * - La clave de `extension_settings` era `translate`, que ST ya reserva para su
 *   propia extension de traduccion (`extensions.js:193`, en uso por
 *   `public/scripts/extensions/translate/index.js:153`). Convivia con `stTranslate`
 *   para la cache de modelos, dos claves para lo mismo.
 *
 * Si cambia el nombre del repositorio o de la carpeta, hay que cambiarlo tambien
 * aqui y en manifest.json. La migracion de ajustes esta en ui/settings.js.
 */

/** Carpeta de la extension. Debe coincidir con manifest.json `name`. */
export const EXTENSION_FOLDER = 'ST-translate-data';

/** Clave propia dentro de `extension_settings`. No usar nombres de ST. */
export const SETTINGS_KEY = 'stUniversalTranslator';

/**
 * Claves antiguas que se migran a SETTINGS_KEY la primera vez que se abre el
 * panel. Se conservan aqui para que la migracion sea explicita y no adivinada.
 */
export const LEGACY_SETTINGS_KEYS = ['translate', 'stTranslate'];