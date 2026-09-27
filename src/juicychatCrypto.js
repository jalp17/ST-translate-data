/**
 * Cifrado de peticiones/responses de JuicyChat.
 *
 * Extraído del APK oficial (`jadx_out/sources/com/zq/juicy_common/util/AESUtil.java`).
 * El sitio envuelve todo el tráfico /yume/api/* con AES-128-CBC + doble Base64:
 *
 * - Request:  {"requestData": Base64( AES( Base64(utf8_bytes) ) )}
 * - Response: {"responseData": Base64( AES( Base64(utf8_bytes) ) )}
 *   (la API descifra outer-Base64, luego AES, luego inner-Base64 → string UTF-8)
 *
 * Los valores key/IV/secretkey son públicos (están hardcodeados en la app Android
 * oficial publicada durante años), así que esto no es un bypass criptográfico.
 */

const KEY_STR = "yume1aJ83ZbPpkwb"; // 16 bytes
const IV_STR = "yume2024cccydnzc";  // 16 bytes, fijo
export const JUICYCHAT_SECRET_KEY = "a76946fd72g1bc4d9797de189ec4af6808";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

let cachedKeyPromise = null;

function getKey() {
  if (!cachedKeyPromise) {
    cachedKeyPromise = crypto.subtle.importKey(
      "raw",
      ENCODER.encode(KEY_STR),
      { name: "AES-CBC", length: 128 },
      false,
      ["encrypt", "decrypt"]
    );
  }
  return cachedKeyPromise;
}

/** utf-8 string → Base64 */
function utf8ToB64(text) {
  const bytes = ENCODER.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Base64 → utf-8 string */
function b64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return DECODER.decode(bytes);
}

/**
 * Cifra texto plano como en el APK de JuicyChat.
 *
 * @param {string} plainText JSON string
 * @returns {Promise<string>} Base64( AES( Base64(plainText) ) )
 */
export async function juicyEncrypt(plainText) {
  const key = await getKey();
  const inner = ENCODER.encode(utf8ToB64(plainText)); // Base64(utf8)
  const cipherText = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: ENCODER.encode(IV_STR) },
    key,
    inner
  );
  const bytes = new Uint8Array(cipherText);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Descifra un valor responseData de JuicyChat.
 *
 * @param {string} encryptedB64 Valor tal cual del campo responseData
 * @returns {Promise<string>} plaintext UTF-8 (normalmente un JSON string)
 */
export async function juicyDecrypt(encryptedB64) {
  const key = await getKey();
  const outer = atob(encryptedB64);
  const cipherBytes = Uint8Array.from(outer, (c) => c.charCodeAt(0));
  const innerB64 = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ENCODER.encode(IV_STR) },
    key,
    cipherBytes
  );
  const innerStr = DECODER.decode(innerB64);
  return b64ToUtf8(innerStr.trim());
}
