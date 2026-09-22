/**
 * Helper para acceder al contexto de SillyTavern de forma segura.
 * Se usa para obtener personajes, lorebooks y API keys desde el runtime de ST
 * sin depender de window.* ni de heurísticas frágiles.
 */

let cachedContext = null;

export function getSTContext() {
  if (cachedContext) {
    return cachedContext;
  }

  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx) {
    throw new Error(
      'SillyTavern context no disponible. ' +
      'Asegúrate de que la extensión se carga después de que ST haya inicializado.'
    );
  }

  cachedContext = ctx;
  return ctx;
}

export function clearSTContextCache() {
  cachedContext = null;
}
