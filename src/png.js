import { preserveVariables, restoreVariables } from './utils.js';
import { translateText } from './translateProviders.js';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export function parsePNGChunks(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const signature = new Uint8Array(arrayBuffer.slice(0, 8));

  for (let i = 0; i < 8; i += 1) {
    if (signature[i] !== PNG_SIGNATURE[i]) {
      throw new Error('No es un PNG válido');
    }
  }

  const chunks = [];
  let offset = 8;

  while (offset < view.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const dataBytes = new Uint8Array(arrayBuffer.slice(dataStart, dataEnd));
    const crc = view.getUint32(dataEnd);

    chunks.push({
      offset,
      length,
      type,
      dataBytes,
      crc,
    });

    offset = dataEnd + 4;
  }

  return chunks;
}

export function findPNGChunk(chunks, chunkType) {
  return chunks.find((chunk) => chunk.type === chunkType) || null;
}

export function findTextChunk(chunks, textKey) {
  return chunks.find((chunk) => {
    if (chunk.type !== 'tEXt') {
      return false;
    }

    const raw = new TextDecoder('latin1').decode(chunk.dataBytes);
    const [key] = raw.split('\x00', 1);
    return key === textKey;
  }) || null;
}

export function utf8ToString(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

export function stringToUtf8(str) {
  return new TextEncoder().encode(str);
}

export function buildTextChunkBytes(key, value) {
  const keyBytes = new TextEncoder().encode(key);
  const valueBytes = new TextEncoder().encode(value);
  const chunk = new Uint8Array(keyBytes.length + 1 + valueBytes.length);
  chunk.set(keyBytes, 0);
  chunk[keyBytes.length] = 0;
  chunk.set(valueBytes, keyBytes.length + 1);
  return chunk;
}

export function crc32(bytes) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let j = 0; j < 8; j += 1) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      t[i] = c >>> 0;
    }
    return t;
  })());

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function buildPNG(chunks) {
  const chunksBuffers = [PNG_SIGNATURE];
  let totalLength = PNG_SIGNATURE.length;

  chunks.forEach((chunk) => {
    const lengthBuffer = new Uint8Array(4);
    const lengthView = new DataView(lengthBuffer.buffer);
    lengthView.setUint32(0, chunk.dataBytes.length);

    const typeBuffer = new Uint8Array([
      chunk.type.charCodeAt(0),
      chunk.type.charCodeAt(1),
      chunk.type.charCodeAt(2),
      chunk.type.charCodeAt(3),
    ]);

    const crcBuffer = new Uint8Array(4);
    const crcView = new DataView(crcBuffer.buffer);
    const crcValue = crc32(new Uint8Array([...typeBuffer, ...chunk.dataBytes]));
    crcView.setUint32(0, crcValue);

    chunksBuffers.push(lengthBuffer, typeBuffer, chunk.dataBytes, crcBuffer);
    totalLength += 4 + 4 + chunk.dataBytes.length + 4;
  });

  const output = new Uint8Array(totalLength);
  let position = 0;
  chunksBuffers.forEach((bufferPart) => {
    output.set(bufferPart, position);
    position += bufferPart.length;
  });

  return output.buffer;
}

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
