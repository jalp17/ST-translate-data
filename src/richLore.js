/**
 * Extrae el lore de las cartas de Tipsy que lo guardan dentro de un <script>.
 *
 * POR QUE HACE FALTA
 *
 * Algunas cartas de Tipsy (Guillotinea, Contracted to the Ice Queen) no guardan
 * el lore en el texto: lo montan como un visor interactivo. El `tagline`
 * trae <section>/<nav> y 11 botones de carrusel y paginacion, y guarda las
 * paginas de lore en un <script>:
 *
 *     <script>
 *       const lorePages = [{"label":"WORLD","title":"...","body":"<p>...</p>"}, ...]
 *       ...logica del carrusel...
 *     </script>
 *
 * Dos cosas hacen que eso no llegue a SillyTavern:
 *
 * 1. ST sanea el mensaje con DOMPurify, y `script` no esta en la lista blanca:
 *    el bloque desaparece entero. Verificado.
 * 2. Aunque sobreviviera, la pagina depende de JS para paginar. Los <button>
 *    pasan el sanitizado pero quedan inertes: ST les quita `onclick` por
 *    seguridad, asi que no hacen nada al pulsarlos.
 *
 * QUE HACEMOS
 *
 * - Se recupera el array `lorePages` del <script> y se convierte a bloques
 *   <details><summary>, que son HTML puro: sobreviven al sanitizado y el
 *   plegado lo hace el navegador sin una linea de JS. El lector recorre el
 *   lore desplegandolo, que es lo mas cerca que puede quedar del botonero.
 * - El contenido tambien va al `character_book` de la tarjeta, que es donde ST
 *   guarda de verdad el lore: asi el modelo lo consulta por palabras clave en
 *   lugar de llevarlo siempre en el prompt.
 */

/** Extrae el array `lorePages` de los <script> de un tagline. */
export function extractLorePages(tagline) {
  if (!tagline || typeof tagline !== 'string') return [];

  const paginas = [];
  // Se recorren los <script> porque some lo definen con o sin punto y coma
  for (const m of tagline.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const codigo = m[1];
    const i = codigo.search(/\b(?:const|let|var)?\s*lorePages\s*=\s*\[/);
    if (i < 0) continue;

    const inicio = codigo.indexOf('[', i);
    // se empareja el balanceo de corchetes respetando cadenas y escapes
    let nivel = 0;
    let fin = -1;
    let enCadena = false;
    let comilla = '';
    for (let k = inicio; k < codigo.length; k++) {
      const c = codigo[k];
      if (enCadena) {
        if (c === '\\') { k++; continue; }
        if (c === comilla) enCadena = false;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { enCadena = true; comilla = c; continue; }
      if (c === '[') nivel++;
      else if (c === ']') {
        nivel--;
        if (nivel === 0) { fin = k; break; }
      }
    }
    if (fin < 0) continue;

    try {
      const arr = JSON.parse(codigo.slice(inicio, fin + 1));
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (p && typeof p === 'object' && (p.body || p.title || p.label)) {
            paginas.push({
              label: String(p.label ?? '').trim(),
              title: String(p.title ?? '').trim(),
              body: String(p.body ?? '').trim(),
            });
          }
        }
      }
    } catch {
      // el array no es JSON valido: se sigue con lo que haya
    }
  }

  // se deduplica por titulo, por si el mismo lore aparece en varios scripts
  const vistas = new Set();
  return paginas.filter((p) => {
    const clave = p.title || p.label;
    if (!clave || vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

/**
 * Convierte las paginas de lore en bloques plegables.
 * @returns {string} HTML con <details> por pagina
 */
export function lorePagesToDetails(paginas) {
  if (!paginas?.length) return '';
  const partes = paginas.map((p) => {
    const etiqueta = p.label && p.title && p.label !== p.title
      ? `<b>${p.label}</b> · ${p.title}`
      : (p.title || p.label);
    return [
      '<details class="sttd-lore">',
      `<summary>${etiqueta}</summary>`,
      `<div class="sttd-lore-body">${p.body}</div>`,
      '</details>',
    ].join('\n');
  });
  return partes.join('\n\n');
}

/**
 * Convierte las paginas de lore en entradas de `character_book`.
 *
 * Cada pagina se registra con su label como palabra clave para que ST la
 * active sola cuando el tema aparece, y ninguna es constante: así el lore
 * cuesta tokens solo cuando es relevante y no en cada envio.
 *
 * @param {Array} paginas
 * @param {string} nombreLibro
 */
export function lorePagesToBook(paginas, nombreLibro) {
  if (!paginas?.length) return null;

  const keywordsDe = (p) => {
    const base = [p.label, p.title].filter(Boolean);
    // el titulo suele traer el nombre propio ("The World of Aureth"): se
    // trocean para que "Aureth" tambien active la entrada
    const palabras = String(p.title || '')
      .replace(/^(the|a|an)\s+/i, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 3);
    return [...new Set([...base, ...palabras.slice(0, 4)])].slice(0, 10);
  };

  return {
    name: nombreLibro,
    entries: paginas.map((p, i) => ({
      keys: keywordsDe(p),
      keysecondary: [],
      comment: p.title || p.label || `Lore ${i + 1}`,
      content: (p.label ? `[${p.label}]\n` : '') + (p.title ? `${p.title}\n` : '') + p.body,
      constant: false,
      selective: false,
      order: 100 + i,
      position: 0,
      disable: false,
      addMemo: true,
      excludeRecursion: false,
      preventRecursion: false,
      delayUntilRecursion: false,
      probability: 100,
      useProbability: true,
      depth: 4,
      selectLogic: 0,
      caseSensitive: null,
      matchWholeWords: null,
      useGroupScoring: null,
      groupOverride: null,
      scanDepth: null,
      caseSensitiveMatch: null,
      automationId: '',
      role: 0,
      vectorized: false,
      sticky: 0,
      cooldown: 0,
      delay: 0,
    })),
    extensions: {},
  };
}