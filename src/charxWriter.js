/**
 * Generador de tarjetas CharX para SillyTavern.
 *
 * CharX es un contenedor ZIP con:
 *   - card.json  → la tarjeta (chara_card_v2/v3) con un array data.assets
 *   - avatar.png → imagen principal
 *   - <assets>   → imágenes referenciadas desde data.assets[].uri
 *
 * SillyTavern lo importa en src/endpoints/characters.js:importFromCharX(), que
 * usa CharXParser (src/charx.js) y explode los assets en disco:
 *   type 'icon'         → avatar de la tarjeta
 *   type 'expression'   → sprite en characters/<Personaje>/
 *   type 'emotion'      → idem
 *   type 'background'   → fondo
 *   resto               → user/images/<Personaje>/
 *
 * Ventaja frente al PNG suelto: todo queda dentro del archivo, sin URLs
 * externas que puedan romperse ni bloqueo por 'forbid_external_media'.
 *
 * El prefijo de URI es 'embeded://' (con una 'e' de menos) porque así lo
 * escribió RisuAI, que inventó el formato; ST acepta también 'embedded://'
 * y '__asset:'.
 */

const ASSET_URI_PREFIX = 'embeded://';

/* ------------------------------------------------------------------ */
/*  CRC32 (necesario para las cabeceras ZIP)                           */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/*  Utilidades de bytes                                                */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return encoder.encode(String(data));
}

function writeU16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeU32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Escribe una entrada ZIP sin comprimir (método "store").
 * @returns {{nameBytes: Uint8Array, local: Uint8Array, crc: number, size: number}}
 */
function buildLocalFileEntry(name, payload) {
  const nameBytes = encoder.encode(name);
  const size = payload.length;
  const crc = crc32(payload);

  // 30 bytes de cabecera fija + nombre + datos
  const local = new Uint8Array(30 + nameBytes.length + size);
  const view = new DataView(local.buffer);

  writeU32(view, 0, 0x04034b50);   // firma de local file header
  writeU16(view, 4, 20);            // versión necesaria
  writeU16(view, 6, 0x0800);        // flags: nombres en UTF-8
  writeU16(view, 8, 0);             // método: store (sin compresión)
  writeU16(view, 10, 0);            // hora
  writeU16(view, 12, 0);            // fecha
  writeU32(view, 14, crc);
  writeU32(view, 18, size);         // tamaño comprimido
  writeU32(view, 22, size);         // tamaño original
  writeU16(view, 26, nameBytes.length);
  writeU16(view, 28, 0);            // sin extra field

  local.set(nameBytes, 30);
  local.set(payload, 30 + nameBytes.length);

  return { nameBytes, local, crc, size };
}

/* ------------------------------------------------------------------ */
/*  Construcción del ZIP                                               */
/* ------------------------------------------------------------------ */

/**
 * Crea un archivo ZIP (store) a partir de una lista de {name, data}.
 * @param {Array<{name: string, data: Uint8Array|ArrayBuffer|string}>} files
 * @returns {Blob}
 */
export function buildZip(files) {
  const entries = files.map((f) => buildLocalFileEntry(f.name, toBytes(f.data)));
  const totalLocal = entries.reduce((sum, e) => sum + e.local.length, 0);

  // Offset real del inicio de cada local header dentro del ZIP
  let runningOffset = 0;
  for (const e of entries) {
    e.localOffset = runningOffset;
    runningOffset += e.local.length;
  }

  // Directorio central: 46 bytes fijos + el nombre de cada entrada
  const centralSize = entries.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0);
  const central = new Uint8Array(centralSize);
  const centralView = new DataView(central.buffer);
  let centralOffset = 0;

  entries.forEach((e, i) => {
    writeU32(centralView, centralOffset, 0x02014b50);   // firma de central directory
    writeU16(centralView, centralOffset + 4, 20);        // versión creador
    writeU16(centralView, centralOffset + 6, 20);        // versión necesaria
    writeU16(centralView, centralOffset + 8, 0x0800);    // flags UTF-8
    writeU16(centralView, centralOffset + 10, 0);        // método store
    writeU16(centralView, centralOffset + 12, 0);        // hora
    writeU16(centralView, centralOffset + 14, 0);        // fecha
    writeU32(centralView, centralOffset + 16, e.crc);
    writeU32(centralView, centralOffset + 20, e.size);
    writeU32(centralView, centralOffset + 24, e.size);
    writeU16(centralView, centralOffset + 28, e.nameBytes.length);
    writeU16(centralView, centralOffset + 30, 0);        // extra
    writeU16(centralView, centralOffset + 32, 0);        // comentario
    writeU16(centralView, centralOffset + 34, 0);        // nº de disco
    writeU16(centralView, centralOffset + 36, 0);        // atributos internos
    writeU32(centralView, centralOffset + 38, 0);        // atributos externos
    writeU32(centralView, centralOffset + 42, e.localOffset);
    central.set(e.nameBytes, centralOffset + 46);
    centralOffset += 46 + e.nameBytes.length;
  });

  // End of central directory
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  writeU32(eocdView, 0, 0x06054b50);      // firma EOCD
  writeU16(eocdView, 4, 0);                // nº de discos
  writeU16(eocdView, 6, 0);                // disco donde está el directorio
  writeU16(eocdView, 8, entries.length);
  writeU16(eocdView, 10, entries.length);
  writeU32(eocdView, 12, central.length);
  writeU32(eocdView, 16, totalLocal);      // offset del directorio central
  writeU16(eocdView, 20, 0);               // sin comentario

  return new Blob([...entries.map((e) => e.local), central, eocd], {
    type: 'application/zip',
  });
}

/* ------------------------------------------------------------------ */
/*  CharX                                                              */
/* ------------------------------------------------------------------ */

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/apng': 'apng',
};

function extensionFor(mime, url) {
  const fromMime = EXT_BY_MIME[(mime || '').toLowerCase()];
  if (fromMime) return fromMime;
  const match = String(url || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : 'png';
}

function safeAssetName(name, fallback) {
  const cleaned = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/**
 * Construye un archivo .charx autocontenido.
 *
 * @param {object} card Tarjeta chara_card_v2 (se le añade data.assets)
 * @param {Blob} avatarBlob Imagen principal del personaje
 * @param {Array<{name: string, type: string, blob: Blob, url?: string}>} [assets]
 *        Assets adicionales. type ∈ 'expression' | 'emotion' | 'background' | 'misc'
 * @returns {Promise<Blob>}
 */
export async function buildCharacterCardCharX(card, avatarBlob, assets = []) {
  if (!card?.data) {
    throw new Error('Se requiere una tarjeta con campo data');
  }
  if (!avatarBlob) {
    throw new Error('Se requiere una imagen de avatar');
  }

  const files = [];

  // 1) Avatar, como asset type 'icon' con name 'main' (así lo prioriza
  //    pickCharXIconAsset en charx.js)
  const avatarExt = extensionFor(avatarBlob.type, 'avatar');
  const avatarPath = `assets/avatar.${avatarExt}`;
  files.push({ name: avatarPath, data: await avatarBlob.arrayBuffer() });

  const assetsMeta = [
    {
      name: 'main',
      type: 'icon',
      ext: avatarExt,
      uri: `${ASSET_URI_PREFIX}${avatarPath}`,
    },
  ];

  // 2) Assets adicionales
  let index = 0;
  for (const asset of assets) {
    if (!asset?.blob) continue;
    index += 1;

    const ext = extensionFor(asset.blob.type, asset.url);
    const type = asset.type || 'misc';
    const base = safeAssetName(asset.name, `${type}_${index}`);

    // Los sprites usan guiones (no guiones bajos) porque el extractor de
    // etiquetas de ST los separa por guion; ver getCharXAssetBaseName en
    // src/charx.js.
    const fileBase = type === 'expression' || type === 'emotion'
      ? base.replace(/_/g, '-')
      : base;
    const path = `assets/${fileBase}.${ext}`;

    files.push({ name: path, data: await asset.blob.arrayBuffer() });
    assetsMeta.push({
      name: asset.name || fileBase,
      type,
      ext,
      uri: `${ASSET_URI_PREFIX}${path}`,
    });
  }

  // 3) card.json con el array de assets
  const cardWithAssets = {
    ...card,
    data: {
      ...card.data,
      assets: assetsMeta,
    },
  };
  files.unshift({ name: 'card.json', data: JSON.stringify(cardWithAssets, null, 2) });

  return buildZip(files);
}
