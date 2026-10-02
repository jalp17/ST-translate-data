/**
 * Aplana el CSS de una carta de documento completo a estilos `style="..."`
 * por elemento, para que sobreviva al sandbox de SillyTavern.
 *
 * POR QUE EXISTE
 *
 * ST acota el CSS de un mensaje al prefijo `.mes_text` (decodeStyleTags en
 * public/scripts/chats.js:551). Ese prefijo se antepone como combinador de
 * descendencia a TODO selector, de modo que los de nivel documento pasan a ser
 * selectores imposibles:
 *
 *   :root  ->  .mes_text :root     no casa nunca
 *   body   ->  .mes_text body      no casa nunca
 *
 * Las cartas de Tipsy que son un documento HTML entero (Three Days on the
 * Widow Ranch, parte de Guillotinea, Contracted to the Ice Queen) describen
 * todo el diseño con `:root`, `body` y clases. Al importarlas, ST las deja sin
 * estilo: llega el texto pero el diseño desaparece.
 *
 * La salida no depende de CSS en tiempo de render sino de atributos `style`
 * inline, que ST sí conserva intactos: DOMPurify los permite y ningún hook los
 * toca. Es el mismo enfoque que usan los exporters de correo electronico.
 *
 * LIMITACIONES (deliberadas)
 *
 * - Se resuelven `var(--x)` con las definiciones de `:root`.
 * - No se resuelven `@media`, `:hover`, `:nth-*`, pseudo-elementos `::before`
 *   ni layout dinamico de flex/grid. No se aplican: se descartan.
 * - Los combinadores `>` y hermanos se tratan como descendencia, que es el
 *   caso mayoritario en estas cartas.
 * - Para ordenar la cascada se usa una especificidad aproximada (ids/clases/
 *   tipos). No pretende ser un navegador, solo resolver estas hojas.
 */

/**
 * Solo propiedades de PINTURA, nunca de maquetacion.
 *
 * Es una decision deliberada: las cartas de documento completo definen su
 * layout con `position`, `transform`, `display:flex/grid` y dimensiones que no
 * se pueden reproducir aqui (ST descarta los `flex-basis`, `grid-*`, `@media`
 * y las relaciones entre hermanos). Si se inlinean esas propiedades el
 * resultado no es "algo parecido" sino texto solapado e ilegible, que es peor
 * que no aplicar nada. Pintando solo, el resultado degrada a un documento
 * legible con sus colores y sus tipografias.
 *
 * Lo que se conserva: color de fondo y de texto, tipografia, interlineado,
 * separacion de letras, alineacion, decoration, transformada de mayusculas,
 * bordes, radio, sombra de caja, opacidad, padding y margen, y el ancho maximo
 * para que las imagenes no se desborden.
 */
const PROPIEDADES_INLINEABLES = [
  'color', 'background-color', 'background-image', 'background-position',
  'background-size', 'background-repeat', 'background-clip', 'background-origin',
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-decoration', 'text-transform', 'text-indent',
  'text-shadow', 'vertical-align', 'white-space',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-radius', 'border-color', 'border-width', 'border-style',
  'box-shadow', 'opacity', 'padding', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-bottom',
  'max-width', 'overflow-wrap', 'word-break',
];

/** Normaliza `:root` / `html` para que apunten a la raiz del fragmento. */
function normalizarRaiz(selector) {
  return selector.replace(/^:root\b/i, 'html');
}

/**
 * Especificidad aproximada: ids pesan 10000, clases y pseudo-clases 100, y
 * los nombres de etiqueta 1.
 */
function especificidad(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const clases = (selector.match(/\.[\w-]+/g) || []).length
    + (selector.match(/:(?!:)[\w-]+/g) || []).length;
  const tipos = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + clases * 100 + tipos;
}

/**
 * Parsea CSS con el parser del navegador (insertando un <style> temporal) en
 * vez de improvisar un parser propio.
 *
 * IMPORTANTE: el elemento se deja en el documento hasta que el llamante haya
 * terminado. Si se quita antes, las CSSStyleDeclaration de sus reglas se
 * invalidan y `rule.style` pasa a ser undefined.
 *
 * @returns {{reglas: Array, limpiar: Function}}
 */
function indexarCss(css, doc) {
  const estilo = doc.createElement('style');
  estilo.textContent = css;
  doc.head.appendChild(estilo);
  const reglas = [];
  for (const r of estilo.sheet?.cssRules || []) {
    if (r.selectorText) reglas.push({ selector: r.selectorText, estilo: r.style });
  }
  return { reglas, limpiar: () => estilo.remove() };
}

/** Resuelve `var(--x, fallback)` contra un mapa de variables. */
function resolverVars(valor, variables) {
  let salida = valor;
  for (let i = 0; i < 6 && salida.includes('var('); i++) {
    salida = salida.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/, (_, nombre, fallback) => {
      const v = variables.get(nombre);
      return v !== undefined ? v : (fallback || '');
    });
  }
  return salida.trim();
}

/** Quita pseudo-clases y atributos, dejando solo el selector de etiqueta/clase. */
function selectorSimple(selector) {
  return selector
    .replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s*>\s*/g, ' ')
    .trim();
}

/** Comprueba si la regla aplica al elemento, subiendo por la ascendencia. */
function aplica(regla, elemento) {
  if (!regla.elementos) return false;
  if (regla.elementos.includes(elemento)) return true;
  if (!regla.propietaria) {
    let padre = elemento.parentElement;
    while (padre) {
      if (regla.elementos.includes(padre)) return true;
      padre = padre.parentElement;
    }
  }
  return false;
}

/**
 * Aplana el CSS de un documento a estilos inline.
 *
 * @param {string} html documento que contiene uno o varios bloques <style>
 * @param {Document} doc documento del navegador, usado para parsear y clonar
 * @returns {string} html con estilos inline y sin bloques <style>
 */
export function inlineCssFromHtml(html, doc) {
  if (!html || typeof html !== 'string') return html;

  const bloques = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  if (!bloques.length) return html;

  const texto = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const plantilla = doc.createElement('div');
  plantilla.innerHTML = texto;
  if (!plantilla.firstElementChild) return texto;

// Un solo <style> para toda la hoja: se mantiene en el documento hasta el
  // final porque sus reglas se leen durante el inlining.
  const { reglas: todas, limpiar } = indexarCss(bloques.join('\n'), doc);

  // 1) variables declaradas en :root (una pasada, sin anidamiento)
  const variables = new Map();
  for (const r of todas) {
    if (!/^:root\b/i.test(r.selector.trim())) continue;
    for (const prop of r.estilo) {
      const val = resolverVars(r.estilo.getPropertyValue(prop), variables);
      if (val) variables.set(prop, val);
    }
  }

  // 2) reglas planas, divididas por selector y ordenadas por cascada
  const reglas = [];
  let orden = 0;
  for (const r of todas) {
    const esRaiz = /^(html|body|:root)\b/i.test(r.selector.trim());
    for (const sel of r.selector.split(',')) {
      const limpio = sel.trim();
      if (!limpio) continue;
      reglas.push({
        selector: esRaiz ? normalizarRaiz(limpio) : limpio,
        estilo: r.estilo,
        orden: orden++,
      });
    }
  }
  reglas.sort((a, b) => especificidad(a.selector) - especificidad(b.selector) || a.orden - b.orden);

  // 3) resolver a que elementos apunta cada regla
  for (const r of reglas) {
    const simple = selectorSimple(r.selector);
    if (!simple || /^html$/i.test(simple)) continue;
    r.elementos = [];
    for (const parte of simple.split(/\s+/).filter(Boolean)) {
      if (/^html$/i.test(parte)) continue;
      try {
        for (const el of plantilla.querySelectorAll(parte)) r.elementos.push(el);
      } catch {
        // selector no soportado por querySelector: se ignora esa parte
      }
    }
  }

  // 4) cascada final por elemento
  for (const el of plantilla.querySelectorAll('*')) {
    const ganadoras = new Map();
    for (const r of reglas) {
      if (!aplica(r, el)) continue;
      for (const prop of PROPIEDADES_INLINEABLES) {
        const val = r.estilo.getPropertyValue(prop);
        if (!val) continue;
        const resuelta = resolverVars(val, variables);
        if (!resuelta) continue;
        ganadoras.set(prop, resuelta);
      }
    }
    if (!ganadoras.size) continue;
    const declarations = [...ganadoras].map(([prop, val]) => `${prop}: ${val}`);
    el.setAttribute('style', declarations.join('; '));
  }

  limpiar();
  return plantilla.innerHTML;
}