export function preserveVariables(text) {
  if (typeof text !== 'string' || !text.length) {
    return { text, tokenMap: [] };
  }

  const tokenMap = [];
  const normalizedText = text.replace(/{{\s*([^\s{][^{}]*?)\s*}}/g, (match) => {
    const token = `__VAR_${tokenMap.length}__`;
    tokenMap.push({ token, placeholder: match });
    return token;
  });

  return { text: normalizedText, tokenMap };
}

export function restoreVariables(text, tokenMap) {
  if (typeof text !== 'string' || !tokenMap?.length) {
    return text;
  }

  return tokenMap.reduce((current, item) => current.replaceAll(item.token, item.placeholder), text);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildTranslatePrompt(text, sourceLang, targetLang) {
  const fromLabel = sourceLang === 'auto' ? 'el idioma original' : `de ${sourceLang}`;
  return `Traduce el siguiente texto ${fromLabel} a ${targetLang}. Conserva exactamente todas las variables y tokens internos como __VAR_0__, __VAR_1__, {{char}}, {{user}}, {{worldinfo}}, {{roleplay}} y similares sin alterarlos. Solo devuelve el texto traducido y no agregues explicaciones.

Texto:
${text}`;
}

export function buildJsonHeaders(apiKey, extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function fetchJson(url, init = {}, timeoutMs = 30000) {
  let response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    response = await fetch(url, {
      mode: 'cors',
      cache: 'no-cache',
      credentials: 'omit',
      signal: controller.signal,
      ...init,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error(`fetchJson timeout calling ${url} after ${timeoutMs}ms`);
      throw new Error(`Timeout al llamar a ${url} después de ${timeoutMs}ms. Verifica la conectividad o aumenta el tiempo de espera.`);
    }
    console.error(`fetchJson network error calling ${url}:`, error);
    const corsMessage = error instanceof TypeError && /fetch|NetworkError|CORS|cross-origin/i.test(error.message)
      ? ' Error de CORS: el endpoint bloquea solicitudes desde el navegador. Considera usar el proxy backend de SillyTavern (generar a través de ST) o un servidor con CORS habilitado.'
      : '';
    throw new Error(`Error de red al llamar a ${url}: ${error.message}.${corsMessage}`);
  }

  clearTimeout(timeoutId);
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();

  if (!response.ok) {
    let message = bodyText;
    try {
      const bodyJson = JSON.parse(bodyText);
      message = bodyJson.error?.message || JSON.stringify(bodyJson);
    } catch {
      // Use plain text message.
    }
    console.error(`fetchJson HTTP error calling ${url}: ${response.status} ${response.statusText}`, message);

    if (response.status === 401) {
      throw new Error(`Error de autenticación (401) al llamar a ${url}: Verifica la API key. ${message}`);
    }
    if (response.status === 429) {
      throw new Error(`Límite de tasa excedido (429) al llamar a ${url}: Espera un momento antes de reintentar. ${message}`);
    }
    if (response.status >= 500) {
      throw new Error(`Error del servidor (500+) al llamar a ${url}: El servicio puede estar caído. ${message}`);
    }

    throw new Error(`Error en la llamada a ${url}: ${response.status} ${response.statusText} - ${message}`);
  }

  if (contentType.includes('application/json')) {
    return JSON.parse(bodyText);
  }

  return bodyText;
}

export function parseOpenAIResponse(result) {
  if (!result?.choices?.length) {
    throw new Error('Respuesta de OpenAI inválida');
  }

  const choice = result.choices[0];
  if (choice.message?.content) {
    return choice.message.content.trim();
  }
  if (typeof choice.text === 'string') {
    return choice.text.trim();
  }

  throw new Error('No se pudo leer la respuesta de OpenAI');
}

export function parseGenericCompletionResponse(result) {
  if (result?.output) {
    if (Array.isArray(result.output)) {
      return result.output.map((item) => (typeof item === 'string' ? item : item.text)).join('');
    }
    if (typeof result.output === 'string') {
      return result.output.trim();
    }
  }

  if (result?.choices?.length) {
    const choice = result.choices[0];
    if (choice.message?.content) {
      return choice.message.content.trim();
    }
    if (typeof choice.text === 'string') {
      return choice.text.trim();
    }
  }

  if (result?.completion) {
    return result.completion.trim();
  }

  if (result?.results?.length && result.results[0]?.content?.length) {
    return result.results[0].content.map((item) => item.text || '').join('').trim();
  }

  if (result?.candidates?.length && typeof result.candidates[0].output === 'string') {
    return result.candidates[0].output.trim();
  }

  throw new Error('No se pudo analizar la respuesta del modelo');
}

export function getFileName(file) {
  if (!file) {
    return `translated-${Date.now()}.png`;
  }
  return file.name || `translated-${Date.now()}.png`;
}

export async function saveBlobToDisk(blob, filename, folderPath) {
  const normalizedFolder = folderPath?.toString().trim();
  const normalizedFilename = filename.replace(/[/\\]/g, '_');

  if (normalizedFolder && typeof window.saveBlobToPath === 'function') {
    const filePath = `${normalizedFolder.replace(/[/\\]$/, '')}/${normalizedFilename}`;
    await window.saveBlobToPath(blob, filePath);
    return { saved: true, path: filePath };
  }

  if (normalizedFolder && typeof window.saveBlob === 'function') {
    await window.saveBlob(blob, normalizedFilename, normalizedFolder);
    return { saved: true, path: `${normalizedFolder.replace(/[/\\]$/, '')}/${normalizedFilename}` };
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = normalizedFilename;
  link.click();
  URL.revokeObjectURL(url);
  return { saved: false, path: normalizedFilename };
}
