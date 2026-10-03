/**
 * Incrusta en la tarjeta las tipografias web que el saludo declara.
 *
 * POR QUE
 *
 * Las cartas que son un documento HTML (Three Days on the Widow Ranch, y las
 * que usen Google Fonts) definen su tipografia asi:
 *
 *     <link href="https://fonts.googleapis.com/css2?family=Sancreek&...">
 *     .title { font-family: 'Sancreek', serif }
 *
 * Con el `font-family` puesto pero la fuente sin cargar, el navegador cae al
 * fallback y el texto sale en un serif genérico: el resultado se ve correcto en
 * estructura pero pierde la mitad del aire de la carta.
 *
 * Y la fuente no se puede dejar para que ST la cargue por su cuenta:
 *
 *  - DOMPurify borra los `<link>`: no llegan al DOM.
 *  - ST acota el CSS del mensaje a `.mes_text` y descarta los `@import`.
 *  - Ademas ST bloquea la media externa de los mensajes por defecto
 *    (`external_media_allowed`).
 *
 * La unica via es descargar los .woff2 y meterlos como data URI en reglas
 * `@font-face`, que si sobreviven al sanitizado (lo verificamos con `<style>`).
 *
 * COSTES
 *
 * Es opcional y va apagado por defecto porque pesa: cada familia son varios
 * .woff2. Limitandose a los subconjuntos `latin` y `latin-ext` (suficiente
 * para castellano e ingles) Sancreek + Crimson Text + Special Elite ocupan unos
 * 137 KB en base64. Se puede bajar mas con `subsets: ['latin']`.
 *
 * Las peticiones salen del navegador del usuario al importar, no del servidor.
 */

/** Subconjuntos de Google Fonts que nos interesan. */
const SUBSETES_POR_DEFECTO = ['latin', 'latin-ext'];

const AGENTE = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Extrae las familias del href de Google Fonts que hay en el HTML. */
export function googleFontsHref(html) {
  for (const m of String(html || '').matchAll(/<link[^>]*href="([^"]*fonts\.googleapis\.com\/css2?[^"]*)"[^>]*>/gi)) {
    return m[1].replace(/&amp;/g, '&');
  }
  return null;
}

/**
 * Nombres de las familias declaradas en `font-family` dentro del HTML, para
 * comprobar si hay algo que incrustar.
 */
export function declaredFontFamilies(html) {
  const out = new Set();
  for (const m of String(html || '').matchAll(/font-family:\s*([^;}]+)/g)) {
    for (const parte of m[1].split(',')) {
      const nombre = parte.trim().replace(/^["']|["']$/g, '');
      if (nombre && !/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+)$/i.test(nombre)) {
        out.add(nombre);
      }
    }
  }
  return [...out];
}

/** Convierte el nombre de la familia al formato del href de Google Fonts. */
function familiaAHref(nombre) {
  return nombre.replace(/\s+/g, '+');
}

/**
 * Descarga los .woff2 y devuelve las reglas `@font-face` listas para incrustar,
 * ya convertidas a data URI.
 *
 * @param {string[]} familias nombres tal como aparecen en `font-family`
 * @param {object} [opciones]
 * @param {string[]} [opciones.subsets] subconjuntos de unicode a conservar
 * @param {number} [opciones.timeout]
 * @returns {Promise<{css: string, bytes: number, ficheros: number, error?: string}>}
 */
export async function buildFontFaceCss(familias, opciones = {}) {
  const subsets = opciones.subsets || SUBSETES_POR_DEFECTO;
  const timeout = opciones.timeout ?? 30000;
  if (!familias?.length) return { css: '', bytes: 0, ficheros: 0 };

  const families = familias.map(familiaAHref).join('&family=');
  const url = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;

  const hoja = await fetch(url, { headers: { 'User-Agent': AGENTE }, signal: AbortSignal.timeout(timeout) });
  if (!hoja.ok) {
    return { css: '', bytes: 0, ficheros: 0, error: `Google Fonts respondio ${hoja.status}` };
  }
  const css = await hoja.text();

  // Cada @font-face viene precedido de un comentario /* latin */ que dice el
  // subconjunto. Se conservan solo los pedidos y se descartan los demas.
  const bloques = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
  const conservados = bloques.filter((m) => subsets.includes(m[1]));
  if (!conservados.length) {
    return { css: '', bytes: 0, ficheros: 0, error: 'ningun subconjunto coincide con los pedidos' };
  }

  let bytes = 0;
  let ficheros = 0;
  const reglas = [];
  for (const [, , bloque] of conservados) {
    const fuente = bloque.match(/url\((https:[^)]+)\)/);
    if (!fuente) continue;
    try {
      const res = await fetch(fuente[1], { signal: AbortSignal.timeout(timeout) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      bytes += buf.byteLength;
      ficheros += 1;
      reglas.push(bloque.replace(/url\(https:[^)]+\)/, `url(data:font/woff2;base64,${buf.toString('base64')})`));
    } catch {
      // si un fichero falla, se sigue con el resto
    }
  }

  if (!reglas.length) {
    return { css: '', bytes: 0, ficheros: 0, error: 'no se pudo descargar ninguna fuente' };
  }

  // Collapse por familia+peso+estilo: Google devuelve una regla por subconjunto
  // y solo nos quedamos con los que pedimos, pero aun asi pueden quedar
  // duplicados si una familia repite subconjunto.
  return { css: reglas.join('\n'), bytes, ficheros };
}

/**
 * Devuelve el HTML con las tipografias incrustadas: los `<link>` de Google
 * Fonts desaparecen y en su lugar aparece un `<style>` con los `@font-face`.
 *
 * @param {string} html
 * @param {object} [opciones] se pasa a buildFontFaceCss
 * @returns {Promise<string>}
 */
export async function embedWebFonts(html, opciones = {}) {
  const href = googleFontsHref(html);
  if (!href) return html;

  const familias = (opciones.familias?.length)
    ? opciones.familias
    : [...new Set([...href.matchAll(/family=([^&]+)/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, ' '))))];

  const { css, error } = await buildFontFaceCss(familias, opciones);
  if (!css) {
    console.warn('[ST-Translator] no se pudieron incrustar las tipografias:', error || 'sin reglas');
    return html;
  }

  // fuera los <link> de Google Fonts y los preconnect, dentro el @font-face
  let salida = String(html)
    .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/gi, '')
    .replace(/<link[^>]*rel="preconnect"[^>]*>/gi, '');

  const bloque = `<style>${css}</style>`;
  // pegado justo antes del primer <style> que ya traia la carta, o al principio
  const i = salida.indexOf('<style>');
  if (i >= 0) {
    salida = salida.slice(0, i) + bloque + salida.slice(i);
  } else {
    salida = bloque + salida;
  }
  return salida;
}