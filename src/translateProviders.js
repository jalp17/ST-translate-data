import {
  buildTranslatePrompt,
  buildJsonHeaders,
  fetchJson,
  parseOpenAIResponse,
  parseGenericCompletionResponse,
} from './utils.js';

export const DEFAULT_ENDPOINTS = {
  st_backend: '(Usa la conexión activa de SillyTavern)',
  openai: 'https://api.openai.com/v1/chat/completions',
  local_koboldcpp: 'http://127.0.0.1:5000/api/v1/generate',
  llama_cpp: 'http://127.0.0.1:8080/v1/completions',
  ollama: 'http://127.0.0.1:11434/api/completions',
  llm_studio: 'http://127.0.0.1:8080/api/v1/generate',
  openrouter: 'https://openrouter.ai/v1/chat/completions',
  electron_hub: 'http://127.0.0.1:3000/generate',
  google_aistudio: 'https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText',
  google_translate: 'https://translation.googleapis.com/language/translate/v2',
};

export const DEFAULT_TRANSLATION_PROVIDER = 'st_backend';
export const SUPPORTED_TRANSLATION_PROVIDERS = [
  'st_backend',
  'openai',
  'local_koboldcpp',
  'llama_cpp',
  'ollama',
  'llm_studio',
  'openrouter',
  'electron_hub',
  'google_aistudio',
  'google_translate',
];

/**
 * Traduce usando el backend de SillyTavern (generateQuietPrompt).
 * Usa la conexión/API key configurada en ST — las credenciales nunca salen del servidor.
 * Esto arregla el problema de CORS y de API keys inaccesibles desde el navegador.
 */
export async function translateWithSTBackend(text, sourceLang, targetLang) {
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const ctx = globalThis.SillyTavern?.getContext?.();
  if (!ctx?.generateQuietPrompt) {
    throw new Error('Backend de SillyTavern no disponible. Usa otro proveedor o recarga ST completamente.');
  }
  const result = await ctx.generateQuietPrompt({ quietPrompt: prompt });
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error('ST backend devolvió una respuesta vacía.');
  }
  return result.trim();
}

export async function translateText(text, sourceLang, targetLang, providerConfig = { provider: DEFAULT_TRANSLATION_PROVIDER }) {
  const provider = providerConfig.provider || DEFAULT_TRANSLATION_PROVIDER;

  switch (provider) {
    case 'st_backend':
      return translateWithSTBackend(text, sourceLang, targetLang);
    case 'openai':
      return translateWithOpenAI(text, sourceLang, targetLang, providerConfig);
    case 'local_koboldcpp':
      return translateWithKoboldCPP(text, sourceLang, targetLang, providerConfig);
    case 'llama_cpp':
      return translateWithLlamaCpp(text, sourceLang, targetLang, providerConfig);
    case 'ollama':
      return translateWithOllama(text, sourceLang, targetLang, providerConfig);
    case 'llm_studio':
      return translateWithLLMStudio(text, sourceLang, targetLang, providerConfig);
    case 'openrouter':
      return translateWithOpenRouter(text, sourceLang, targetLang, providerConfig);
    case 'electron_hub':
      return translateWithElectronHub(text, sourceLang, targetLang, providerConfig);
    case 'google_aistudio':
      return translateWithGoogleAIStudio(text, sourceLang, targetLang, providerConfig);
    case 'google_translate':
      return translateWithGoogleTranslate(text, sourceLang, targetLang, providerConfig);
    default:
      console.warn(`Proveedor de traducción desconocido: ${provider}. Usando OpenAI por defecto.`);
      return translateWithOpenAI(text, sourceLang, targetLang, providerConfig);
  }
}

async function translateWithOpenAI(text, sourceLang, targetLang, providerConfig) {
  const apiKey = providerConfig.apiKey;
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.openai;
  const model = providerConfig.model || 'gpt-3.5-turbo';
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'Eres un traductor preciso. Conserva literales y placeholders sin cambiarlos.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: providerConfig.temperature ?? 0.2,
    max_tokens: providerConfig.maxTokens || 1200,
  };

  try {
    const result = await fetchJson(apiUrl, {
      method: 'POST',
      headers: buildJsonHeaders(apiKey),
      body: JSON.stringify(body),
    });
    return parseOpenAIResponse(result);
  } catch (error) {
    if (error.message.includes('401')) {
      throw new Error(`OpenAI: API key inválida o expirada. Verifica tu clave en el perfil o configuración.`);
    }
    if (error.message.includes('429')) {
      throw new Error(`OpenAI: Límite de uso excedido. Espera o actualiza tu plan.`);
    }
    if (error.message.includes('model')) {
      throw new Error(`OpenAI: Modelo '${model}' no disponible. Verifica el modelo seleccionado.`);
    }
    throw new Error(`Error con OpenAI: ${error.message}`);
  }
}

async function translateWithKoboldCPP(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.local_koboldcpp;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    prompt,
    max_length: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
    top_p: providerConfig.top_p ?? 0.9,
    repetition_penalty: providerConfig.repetition_penalty ?? 1.1,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });

  if (typeof result.output === 'string') {
    return result.output.trim();
  }
  if (Array.isArray(result.output)) {
    return result.output.join('').trim();
  }
  if (result?.results?.length) {
    return result.results.join('').trim();
  }

  return parseGenericCompletionResponse(result);
}

async function translateWithLlamaCpp(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.llama_cpp;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'llama',
    prompt,
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });
  return parseGenericCompletionResponse(result);
}

async function translateWithOllama(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.ollama;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'llama2',
    prompt,
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
    stream: false,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });

  if (result?.completion) {
    return result.completion.trim();
  }
  return parseGenericCompletionResponse(result);
}

async function translateWithLLMStudio(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.llm_studio;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'text-davinci-003',
    prompt,
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });
  return parseGenericCompletionResponse(result);
}

async function translateWithOpenRouter(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.openrouter;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    model: providerConfig.model || 'gpt-4',
    messages: [
      { role: 'system', content: 'Eres un traductor preciso.' },
      { role: 'user', content: prompt },
    ],
    temperature: providerConfig.temperature ?? 0.2,
    max_tokens: providerConfig.maxTokens || 1200,
  };

  try {
    const result = await fetchJson(apiUrl, {
      method: 'POST',
      headers: buildJsonHeaders(providerConfig.apiKey),
      body: JSON.stringify(body),
    });
    return parseOpenAIResponse(result);
  } catch (error) {
    if (error.message.includes('401')) {
      throw new Error(`OpenRouter: API key inválida. Verifica tu clave.`);
    }
    if (error.message.includes('429')) {
      throw new Error(`OpenRouter: Límite de uso excedido. Espera o verifica tu plan.`);
    }
    if (error.message.includes('model')) {
      throw new Error(`OpenRouter: Modelo '${providerConfig.model || 'gpt-4'}' no disponible. Verifica el modelo.`);
    }
    throw new Error(`Error con OpenRouter: ${error.message}`);
  }
}

async function translateWithElectronHub(text, sourceLang, targetLang, providerConfig) {
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.electron_hub;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    prompt,
    model: providerConfig.model || 'default',
    max_tokens: providerConfig.maxTokens || 1024,
    temperature: providerConfig.temperature ?? 0.2,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(providerConfig.apiKey),
    body: JSON.stringify(body),
  });

  return parseGenericCompletionResponse(result);
}

async function translateWithGoogleAIStudio(text, sourceLang, targetLang, providerConfig) {
  const model = providerConfig.model || 'models/text-bison-001';
  const apiKey = providerConfig.apiKey;
  const baseUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.google_aistudio;
  const apiUrl = apiKey && !baseUrl.includes('?') ? `${baseUrl}?key=${encodeURIComponent(apiKey)}` : baseUrl;
  const prompt = buildTranslatePrompt(text, sourceLang, targetLang);
  const body = {
    prompt: { text: prompt },
    temperature: providerConfig.temperature ?? 0.2,
    max_output_tokens: providerConfig.maxTokens || 1024,
  };

  const result = await fetchJson(apiUrl, {
    method: 'POST',
    headers: buildJsonHeaders(),
    body: JSON.stringify(body),
  });
  return parseGenericCompletionResponse(result);
}

async function translateWithGoogleTranslate(text, sourceLang, targetLang, providerConfig) {
  const apiKey = providerConfig.apiKey;
  const apiUrl = providerConfig.apiUrl || DEFAULT_ENDPOINTS.google_translate;

  if (!apiKey && !providerConfig.apiUrl) {
    throw new Error('Google Translate requiere apiKey o apiUrl personalizada');
  }

  const body = {
    q: text,
    target: targetLang,
    format: 'text',
  };

  if (sourceLang !== 'auto') {
    body.source = sourceLang;
  }

  try {
    const result = await fetchJson(apiUrl, {
      method: 'POST',
      headers: buildJsonHeaders(),
      body: JSON.stringify(body),
    });

    if (!result?.data?.translations?.length || !result.data.translations[0].translatedText) {
      throw new Error('Respuesta inválida de Google Translate');
    }

    return result.data.translations[0].translatedText.trim();
  } catch (error) {
    if (error.message.includes('401')) {
      throw new Error(`Google Translate: API key inválida. Verifica tu clave.`);
    }
    if (error.message.includes('403')) {
      throw new Error(`Google Translate: Acceso denegado. Verifica permisos o cuota.`);
    }
    if (error.message.includes('400')) {
      throw new Error(`Google Translate: Solicitud inválida. Verifica idiomas o texto.`);
    }
    throw new Error(`Error con Google Translate: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Model fetching per provider
// ---------------------------------------------------------------------------

const MODEL_CACHE_KEY = 'stTranslateModelCache';
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const PROVIDER_MODEL_ENDPOINTS = {
  st_backend: null,     // los modelos vienen del backend ST, no listable directo
  openai: {
    url: (apiUrl) => apiUrl?.replace(/\/chat\/completions$/, '/models') ?? 'https://api.openai.com/v1/models',
    map: (data) => (data?.data ?? []).map((m) => m.id),
  },
  openrouter: {
    url: () => 'https://openrouter.ai/api/v1/models',
    map: (data) => (data?.data ?? []).map((m) => m.id),
  },
  ollama: {
    url: (apiUrl) => `${(apiUrl || DEFAULT_ENDPOINTS.ollama).replace(/\/api\/.*/, '')}/api/tags`,
    map: (data) => (data?.models ?? []).map((m) => m.name),
  },
  local_koboldcpp: {
    url: (apiUrl) => `${(apiUrl || DEFAULT_ENDPOINTS.local_koboldcpp).replace(/\/api\/v1\/generate$/, '')}/v1/models`,
    map: (data) => (data?.data ?? []).map((m) => m.id),
  },
  llama_cpp: {
    url: (apiUrl) => `${(apiUrl || DEFAULT_ENDPOINTS.llama_cpp).replace(/\/v1\/completions$/, '')}/v1/models`,
    map: (data) => (data?.data ?? []).map((m) => m.id),
  },
  llm_studio: {
    url: (apiUrl) => `${(apiUrl || DEFAULT_ENDPOINTS.llm_studio).replace(/\/api\/v1\/generate$/, '')}/v1/models`,
    map: (data) => (data?.data ?? []).map((m) => m.id),
  },
  google_aistudio: {
    url: (apiUrl, apiKey) => `https://generativelanguage.googleapis.com/v1beta/models${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`,
    map: (data) => (data?.models ?? []).map((m) => m.name),
  },
  google_translate: null,   // no tiene lista de modelos pública accesible
  electron_hub: null,       // modelo genérico, sin endpoint de modelos
};

/**
 * Obtiene la lista de modelos disponible para el proveedor indicado.
 * Lee la cache de extensionSettings; si está fresca (< 5 min) la devuelve.
 * En caso contrario hace fetch al endpoint del proveedor.
 *
 * @param {string} provider - Valor de `SUPPORTED_TRANSLATION_PROVIDERS`
 * @param {{ apiKey?: string, apiUrl?: string }} opts
 * @returns {Promise<string[]>}
 */
export async function getModelsForProvider(provider, { apiKey, apiUrl } = {}) {
  const cached = readModelsCache(provider);
  if (cached) {
    return cached;
  }

  const endpoint = PROVIDER_MODEL_ENDPOINTS[provider];
  if (!endpoint) {
    // Proveedor sin endpoint de modelos → lista vacía, el usuario escribe a mano
    return [];
  }

  const url = endpoint.url(apiUrl, apiKey);
  let models = [];

  try {
    const headers = endpoint.buildHeaders
      ? endpoint.buildHeaders(apiKey)
      : (provider === 'openai' || provider === 'openrouter' || provider === 'local_koboldcpp' || provider === 'llama_cpp' || provider === 'llm_studio')
        ? buildJsonHeaders(apiKey)
        : {};

    const data = await fetchJson(url, { headers });
    models = endpoint.map(data) ?? [];
  } catch (err) {
    console.warn(`getModelsForProvider: ${provider} error fetching models`, err);
    models = [];
  }

  writeModelsCache(provider, models);
  return models;
}

function readModelsCache(provider) {
  try {
    const ctx = globalThis.SillyTavern?.getContext?.();
    const cache = ctx?.extensionSettings?.stTranslate?.[MODEL_CACHE_KEY] ?? {};
    const entry = cache[provider];
    if (!entry || !Array.isArray(entry.models) || !entry.models.length) {
      return null;
    }
    if (Date.now() - entry.ts > MODEL_CACHE_TTL) {
      return null;
    }
    console.debug(`getModelsForProvider: ${provider} using cached models (${entry.models.length})`);
    return entry.models;
  } catch {
    return null;
  }
}

function writeModelsCache(provider, models) {
  try {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (!ctx?.extensionSettings) return;
    if (!ctx.extensionSettings.stTranslate) {
      ctx.extensionSettings.stTranslate = {};
    }
    if (!ctx.extensionSettings.stTranslate[MODEL_CACHE_KEY]) {
      ctx.extensionSettings.stTranslate[MODEL_CACHE_KEY] = {};
    }
    ctx.extensionSettings.stTranslate[MODEL_CACHE_KEY][provider] = {
      ts: Date.now(),
      models,
    };
    ctx.saveSettingsDebounced?.();
  } catch {
    // ignorar fallo de escritura de cache
  }
}
