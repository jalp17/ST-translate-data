/**
 * Traduccion dentro de una tarjeta PNG.
 *
 * Reconstruye el PNG con el texto ya traducido en el chunk `chara`. Es la unica
 * parte del antiguo `png.js` que necesita al proveedor de traduccion y a los
 * preservadores de variables; el resto son primitivas puras y viven en
 * pngChunks.js.
 */

import { preserveVariables, restoreVariables } from './utils.js';
import { translateText } from './translateProviders.js';
import { parsePNGChunks, findPNGChunk, findTextChunk, utf8ToString, stringToUtf8, buildTextChunkBytes, buildPNG } from './pngChunks.js';

export async function translateCharacterCard(file, sourceLang = 'auto', targetLang = 'es', providerConfig = { provider: 'openai' }) {
  if (!(file instanceof File || file instanceof Blob)) {
    throw new Error('Se requiere un File o Blob de PNG');
  }

  const arrayBuffer = await file.arrayBuffer();
  const chunks = parsePNGChunks(arrayBuffer);
  let charaChunk = findPNGChunk(chunks, 'chara');
  let textChunk = null;
  let isTextChunk = false;

  if (!charaChunk) {
    textChunk = findTextChunk(chunks, 'chara');
    if (textChunk) {
      charaChunk = textChunk;
      isTextChunk = true;
    }
  }

  if (!charaChunk) {
    throw new Error('No se encontró el chunk chara ni la entrada tEXt con clave chara en el PNG');
  }

  let base64Text = utf8ToString(charaChunk.dataBytes);
  if (isTextChunk) {
    const separatorIndex = base64Text.indexOf('\x00');
    base64Text = separatorIndex >= 0 ? base64Text.slice(separatorIndex + 1) : base64Text;
  }
  const jsonText = atob(base64Text);
  const metadata = JSON.parse(jsonText);

  const keysToTranslate = ['description', 'personality', 'scenario', 'mes_example'];
  for (const key of keysToTranslate) {
    if (typeof metadata[key] === 'string') {
      const { text: protectedText, tokenMap } = preserveVariables(metadata[key]);
      const translatedText = await translateText(protectedText, sourceLang, targetLang, providerConfig);
      metadata[key] = restoreVariables(translatedText, tokenMap);
    }
  }

  const newPayload = JSON.stringify(metadata);
  const newBase64 = btoa(newPayload);
  const newDataBytes = isTextChunk
    ? buildTextChunkBytes('chara', newBase64)
    : stringToUtf8(newBase64);

  const updatedChunks = chunks.map((chunk) => {
    if (chunk === charaChunk) {
      return { ...chunk, dataBytes: newDataBytes, length: newDataBytes.length };
    }
    return chunk;
  });

  const translatedArrayBuffer = buildPNG(updatedChunks);
  return new Blob([translatedArrayBuffer], { type: 'image/png' });
}

export async function translateImageBatch(files, sourceLang = 'auto', targetLang = 'es', outputFolder = '', providerConfig = { provider: 'openai' }, batchDelay = 500, onProgress = null) {
  if (!files || !files.length) {
    return [];
  }

  const results = [];
  const total = files.length;
  for (let i = 0; i < total; i++) {
    const file = files[i];
    onProgress?.({ step: i + 1, total, label: file.name || `imagen-${i + 1}` });
    const translatedBlob = await translateCharacterCard(file, sourceLang, targetLang, providerConfig);
    const filename = file.name || `translated-${Date.now()}.png`;
    const saveInfo = await window.STUniversalTranslator.saveBlobToDisk(translatedBlob, filename, outputFolder);
    results.push({ file: filename, saved: saveInfo.saved, path: saveInfo.path });
    await new Promise((resolve) => setTimeout(resolve, batchDelay));
  }

  return results;
}
