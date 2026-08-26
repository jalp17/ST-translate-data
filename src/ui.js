import { DEFAULT_ENDPOINTS } from './translateProviders.js';
import { populateForm, bindAutoSave } from './ui/settings.js';

export { populateForm, bindAutoSave } from './ui/settings.js';

export async function initializeExtensionPanel() {
  const tryRenderSettings = async () => {
    const ST = globalThis.SillyTavern;
    if (!ST?.getContext) {
      return false;
    }

    const context = ST.getContext();
    if (!context || typeof context.renderExtensionTemplateAsync !== 'function') {
      return false;
    }

    const target = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!target) {
      return false;
    }

    try {
      const currentScript = document.currentScript || document.querySelector('script[src*="script.js"]');
      const scriptSrc = currentScript?.src;
      const extensionNameMatch = scriptSrc ? scriptSrc.match(/\/scripts\/extensions\/(.+?)\/dist\/script\.js$/) : null;
      const extensionName = extensionNameMatch ? extensionNameMatch[1] : null;

      let settingsHtml = null;
      if (extensionName) {
        try {
          settingsHtml = await context.renderExtensionTemplateAsync(extensionName, 'settings');
        } catch (error) {
          console.warn('ST-Universal-Translator: renderExtensionTemplateAsync failed', error);
        }
      }

      if (!settingsHtml && scriptSrc) {
        const baseUrl = scriptSrc.replace(/\/[^/]*$/, '/');
        const fallbackUrl = new URL('../settings.html', baseUrl).href;
        try {
          const settingsResponse = await fetch(fallbackUrl);
          if (settingsResponse.ok) {
            settingsHtml = await settingsResponse.text();
          }
        } catch {
          // ignore fallback failure
        }
      }

      if (settingsHtml) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = settingsHtml;
        while (wrapper.firstChild) {
          target.appendChild(wrapper.firstChild);
        }
        attachTranslatorSettingsEvents();
        populateForm();
        bindAutoSave();
      }
    } catch (error) {
      console.warn('ST-Universal-Translator: error al cargar el panel de configuración', error);
    }

    return true;
  };

  const context = globalThis.SillyTavern?.getContext?.();
  if (context?.eventSource && context?.event_types) {
    let rendered = false;
    const onAppReady = async () => {
      if (rendered) return;
      const success = await tryRenderSettings();
      if (success) {
        rendered = true;
        context.eventSource.off(context.event_types.APP_READY, onAppReady);
      } else {
        setTimeout(onAppReady, 1000);
      }
    };
    context.eventSource.on(context.event_types.APP_READY, onAppReady);
    onAppReady();
  } else {
    const poll = async () => {
      const ready = await tryRenderSettings();
      if (!ready) {
        setTimeout(poll, 1000);
      }
    };
    poll();
  }
}

export function attachTranslatorSettingsEvents() {
  if (window.STTranslatorSettingsAttached) {
    return;
  }

  const pngInput = document.getElementById('pngInput');
  const pngDropZone = document.getElementById('pngDropZone');
  const selectedFileName = document.getElementById('selectedFileName');
  const translatePngButton = document.getElementById('translatePngButton');
  const translateImageBatchButton = document.getElementById('translateImageBatchButton');
  const translateLorebookButton = document.getElementById('translateLorebookButton');
  const translateSelectedCharactersButton = document.getElementById('translateSelectedCharactersButton');
  const refreshCharacterListButton = document.getElementById('refreshCharacterListButton');
  const selectAllCharactersButton = document.getElementById('selectAllCharactersButton');
  const clearCharacterSelectionButton = document.getElementById('clearCharacterSelectionButton');
  const characterSearch = document.getElementById('characterSearch');
  const pngBatchInput = document.getElementById('pngBatchInput');
  const pngBatchDropZone = document.getElementById('pngBatchDropZone');
  const selectedBatchCount = document.getElementById('selectedBatchCount');
  const outputFolderInput = document.getElementById('outputFolder');
  const characterBatchSelect = document.getElementById('characterBatchSelect');
  const sourceLangSelect = document.getElementById('sourceLang');
  const targetLangSelect = document.getElementById('targetLang');
  const providerSelect = document.getElementById('providerSelect');
  const modelInput = document.getElementById('modelInput');
  const modelSelect = document.getElementById('modelSelect');
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const apiKeyLoadButton = document.getElementById('apiKeyLoadButton');
  const refreshProfilesButton = document.getElementById('refreshProfilesButton');
  const connectionModeSelect = document.getElementById('connectionModeSelect');
  const useProfileProviderCheckbox = document.getElementById('useProfileProvider');
  const apiKeyProfileSelect = document.getElementById('apiKeyProfileSelect');
  const statusDetailsText = document.getElementById('statusDetailsText');
  const apiKeyStatusText = document.getElementById('apiKeyStatusText');
  const providerStatusText = document.getElementById('providerStatusText');
  const progressBar = document.getElementById('translationProgress');
  const statusText = document.getElementById('statusText');
  const batchDelayInput = document.getElementById('batchDelay');
  const lorebookSelect = document.getElementById('lorebookSelect');
  const refreshLorebookListButton = document.getElementById('refreshLorebookListButton');
  const lorebookStatusText = document.getElementById('lorebookStatusText');

  if (!pngInput || !translatePngButton || !translateImageBatchButton || !translateLorebookButton || !translateSelectedCharactersButton || !refreshCharacterListButton || !characterBatchSelect || !sourceLangSelect || !targetLangSelect || !providerSelect || !modelInput || !apiUrlInput || !apiKeyInput || !apiKeyLoadButton || !refreshProfilesButton || !connectionModeSelect || !useProfileProviderCheckbox || !apiKeyProfileSelect || !statusDetailsText || !progressBar || !statusText || !batchDelayInput || !lorebookSelect || !refreshLorebookListButton) {
    return;
  }

  window.STTranslatorSettingsAttached = true;
  console.debug('ST Translator: attaching settings events');

  let savedConnectionProfiles = [];
  const MODEL_SUGGESTIONS = {
    openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o', 'gpt-3.5-turbo-0613', 'gpt-4-0613'],
    local_koboldcpp: ['llama', 'llama2', 'mistral', 'kobold-70b'],
    llama_cpp: ['llama', 'llama2', 'meta-llama/Llama-2-7b-chat', 'llama-3'],
    ollama: ['llama2', 'mistral', 'gpt-4o', 'gpt-4'],
    llm_studio: ['text-davinci-003', 'gpt-4', 'gpt-4o'],
    openrouter: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4o'],
    electron_hub: ['default'],
    google_aistudio: ['models/text-bison-001', 'models/chat-bison-001'],
    google_translate: [],
  };

  function normalizeProviderKey(value) {
    if (!value || typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.toLowerCase().trim();
    if (normalized === 'oai') return 'openai';
    if (normalized.includes('openai')) return 'openai';
    if (normalized.includes('openrouter')) return 'openrouter';
    if (normalized.includes('ollama')) return 'ollama';
    if (normalized.includes('kcpp') || normalized.includes('kobold')) return 'local_koboldcpp';
    if (normalized.includes('llama.cpp') || normalized.includes('llama_cpp') || normalized.includes('llama cpp')) return 'llama_cpp';
    if (normalized.includes('llm studio') || normalized.includes('llm_studio')) return 'llm_studio';
    if (normalized.includes('electron hub') || normalized.includes('electron_hub')) return 'electron_hub';
    if (normalized.includes('google ai') || normalized.includes('google_aistudio')) return 'google_aistudio';
    if (normalized.includes('google translate') || normalized.includes('translate.googleapis.com')) return 'google_translate';
    return undefined;
  }

  function guessProviderFromUrl(url) {
    if (!url || typeof url !== 'string') {
      return undefined;
    }

    const normalized = url.toLowerCase();
    if (normalized.includes('openai.com/v1')) return 'openai';
    if (normalized.includes('openrouter.ai')) return 'openrouter';
    if (normalized.includes('127.0.0.1:11434') || normalized.includes('/api.completions') || normalized.includes('/api/completions')) return 'ollama';
    if (normalized.includes('127.0.0.1:8080/v1/completions') || normalized.includes('llama_cpp')) return 'llama_cpp';
    if (normalized.includes('127.0.0.1:5000/api/v1/generate') || normalized.includes('kobold')) return 'local_koboldcpp';
    if (normalized.includes('generativelanguage.googleapis.com')) return 'google_aistudio';
    if (normalized.includes('translation.googleapis.com')) return 'google_translate';
    if (normalized.includes('127.0.0.1:8080/api/v1/generate')) return 'llm_studio';
    return undefined;
  }

  function updateProviderStatusMessage() {
    const provider = providerSelect.value;
    const endpoint = apiUrlInput.value.trim();
    const defaultEndpoint = DEFAULT_ENDPOINTS[provider] || '';
    const statusElement = document.getElementById('providerStatusText');
    if (!statusElement) {
      return;
    }

    if (!endpoint) {
      statusElement.textContent = `Uso endpoint predeterminado para ${provider}: ${defaultEndpoint}`;
      return;
    }

    const providerFromUrl = guessProviderFromUrl(endpoint);
    if (providerFromUrl && providerFromUrl !== provider) {
      statusElement.textContent = `Advertencia: el endpoint parece pertenecer a ${providerFromUrl}, pero el proveedor seleccionado es ${provider}.`; 
      return;
    }

    statusElement.textContent = `Endpoint configurado para ${provider}.`;
  }

  function updateModelSuggestionList(provider) {
    console.log('ST Translator: updating model suggestions for provider', provider);
    const suggestions = MODEL_SUGGESTIONS[provider] || [];
    const listElement = document.getElementById('modelSuggestions');
    const selectElement = document.getElementById('modelSelect');
    if (listElement) {
      listElement.innerHTML = '';
      suggestions.forEach((model) => {
        const option = document.createElement('option');
        option.value = model;
        listElement.appendChild(option);
      });
    }

    if (selectElement) {
      selectElement.innerHTML = '';
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'Selecciona un modelo...';
      selectElement.appendChild(defaultOption);
      suggestions.forEach((model) => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        selectElement.appendChild(option);
      });
      selectElement.disabled = suggestions.length === 0;
    }

    if (!modelInput.value.trim()) {
      modelInput.placeholder = suggestions.length ? `Ej: ${suggestions[0]}` : 'Escriba el modelo';
    }
  }

  function buildProviderConfig() {
    const provider = providerSelect.value;
    const config = {
      provider,
      apiKey: apiKeyInput.value.trim() || undefined,
      apiUrl: apiUrlInput.value.trim() || undefined,
      model: modelInput.value.trim() || undefined,
    };
    console.log('ST Translator: initial provider config', config);

    const mode = connectionModeSelect.value;
    if (mode === 'st_global') {
      const inferred = getInferredSTProfile();
      if (inferred) {
        console.log('ST Translator: using inferred ST profile', inferred);
        if (inferred.apiKey) config.apiKey = inferred.apiKey;
        if (inferred.apiUrl) config.apiUrl = inferred.apiUrl;
        if (inferred.provider) config.provider = inferred.provider;
        if (inferred.model) config.model = inferred.model;
      }
    }

    if (mode === 'saved_profile' || useProfileProviderCheckbox.checked) {
      const profileIndex = apiKeyProfileSelect.value;
      if (profileIndex) {
        const profile = savedConnectionProfiles[Number(profileIndex)];
        if (profile) {
          if (profile.apiKey) config.apiKey = profile.apiKey;
          if (profile.apiUrl) config.apiUrl = profile.apiUrl;

          const rawProvider = profile.provider || profile.api || profile.service || profile.type || profile.backend || profile.engine || profile.modelProvider || profile.providerType || profile.connectionType || profile.provider_name || profile.api_type;
          const resolvedProvider = normalizeProviderKey(rawProvider) || guessProviderFromUrl(profile.apiUrl);
          console.log('ST Translator: resolved provider from profile override', resolvedProvider, 'from rawProvider', rawProvider);
          if (resolvedProvider && Array.from(providerSelect.options).some((option) => option.value === resolvedProvider)) {
            config.provider = resolvedProvider;
          } else if (profile.provider) {
            console.warn('ST Translator: profile provider not compatible', profile.provider);
          }

          if (profile.model) {
            config.model = profile.model;
          }
        }
      }
    }

    console.log('ST Translator: final provider config', config);
    return config;
  }

  function validateProviderConfig(config) {
    console.log('ST Translator: validating provider config', config);
    if (!config.provider) {
      throw new Error('Debe seleccionar un proveedor de traducción.');
    }

    if (config.provider === 'openai' && !config.apiKey) {
      throw new Error('OpenAI requiere una API key válida en el campo correspondiente o desde el perfil de conexión.');
    }

    if (config.provider === 'openrouter' && config.apiUrl?.includes('api.openai.com')) {
      throw new Error('Proveedor OpenRouter no puede usar el endpoint de OpenAI. Cambie el endpoint o seleccione el proveedor OpenAI.');
    }

    if (config.provider === 'google_translate' && !config.apiKey && !config.apiUrl) {
      throw new Error('Google Translate requiere clave API o un endpoint personalizado.');
    }

    return config;
  }

  function handleTranslationError(error, fallbackMessage) {
    console.error('Traducción fallida:', error);
    const message = error?.message || fallbackMessage || 'Error desconocido durante la traducción.';
    statusText.textContent = message;
    updateProgress(0);

    // Mostrar alerta para errores críticos
    if (message.includes('API key inválida') || message.includes('autenticación') || message.includes('401')) {
      alert(`Error de autenticación: ${message}`);
    } else if (message.includes('Límite de') || message.includes('429')) {
      alert(`Límite excedido: ${message}`);
    } else if (message.includes('Timeout') || message.includes('red')) {
      alert(`Error de conexión: ${message}`);
    } else if (message.includes('servidor') || message.includes('500')) {
      alert(`Error del servidor: ${message}`);
    }
  }

  function setCharacterList(characters) {
    characterBatchSelect.innerHTML = '';
    if (!characters?.length) {
      const option = document.createElement('option');
      option.textContent = 'No se encontraron personajes disponibles';
      option.disabled = true;
      characterBatchSelect.appendChild(option);
      return;
    }

    characters.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      characterBatchSelect.appendChild(option);
    });
  }

  async function refreshCharacterList() {
    const characters = window.STUniversalTranslator?.getAvailableCharacters?.() || [];
    setCharacterList(characters);
    statusText.textContent = characters.length
      ? `${characters.length} personajes disponibles` : 'No hay personajes disponibles';
  }

  function updateProgress(value, message) {
    progressBar.style.width = `${value}%`;
    if (message) {
      statusText.textContent = message;
    }
  }

  function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return null;
    }

    const apiKey = profile.apiKey || profile.key || profile.token || profile.accessToken || profile.secret || profile.secretKey || profile['secret-id'];
    const apiUrl = profile.apiUrl || profile.endpoint || profile.baseUrl || profile.url || profile.api_url || profile['api-url'];
    const rawProvider = profile.provider || profile.api || profile.service || profile.type || profile.backend || profile.engine || profile.modelProvider || profile.providerType || profile.connectionType || profile.provider_name || profile.api_type;
    const provider = normalizeProviderKey(rawProvider) || guessProviderFromUrl(apiUrl) || rawProvider;
    const model = profile.model || profile.modelName || profile.model_id || profile.modelId || profile.defaultModel || profile.default_model;
    const name = profile.name || profile.label || profile.title || profile.id || profile.uuid || profile.nameLabel || 'Perfil desconocido';

    if (!apiKey && !apiUrl && !provider) {
      return null;
    }

    return { name, apiKey, apiUrl, provider, model };
  }

  function getInferredSTProfile() {
    const candidates = [
      window.SillyTavern?.connectionManager?.activeProfile,
      window.SillyTavern?.connectionManager?.selectedProfile,
      window.SillyTavern?.connectionManager?.currentProfile,
      window.SillyTavern?.connectionManager?.profile,
      window.SillyTavern?.connectionManager?.connection,
      window.SillyTavern?.connectionManager?.currentConnection,
      window.SillyTavern?.getConnectionManager?.()?.activeProfile,
      window.SillyTavern?.getConnectionManager?.()?.selectedProfile,
      window.SillyTavern?.getConnectionManager?.()?.currentProfile,
      window.SillyTavern?.getContext?.()?.extensionSettings?.connectionManager?.activeProfile,
      window.SillyTavern?.getContext?.()?.extensionSettings?.connectionManager?.selectedProfile,
      window.SillyTavern?.getContext?.()?.extensionSettings?.connectionManager?.currentProfile,
      window.SillyTavern?.getContext?.()?.connectionManager?.activeProfile,
      window.SillyTavern?.getContext?.()?.connectionManager?.selectedProfile,
      window.SillyTavern?.getContext?.()?.connectionManager?.currentProfile,
      window.SillyTavern?.getContext?.()?.connectionManager?.profiles,
      window.SillyTavern?.connectionManager?.profiles,
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      if (Array.isArray(candidate) && candidate.length) {
        const profile = normalizeProfile(candidate[0]);
        if (profile) {
          return profile;
        }
      }
      if (typeof candidate === 'object') {
        const profile = normalizeProfile(candidate);
        if (profile) {
          return profile;
        }
      }
    }

    return null;
  }

  function updateStatusDetails() {
    const mode = connectionModeSelect.value;
    const provider = providerSelect.value;
    const endpoint = apiUrlInput.value.trim() || DEFAULT_ENDPOINTS[provider] || 'sin endpoint';
    const manualKey = apiKeyInput.value.trim() ? 'campo manual' : 'no disponible';
    const selectedProfile = savedConnectionProfiles[Number(apiKeyProfileSelect.value)];
    const inferredProfile = getInferredSTProfile();

    let sourceText = `Modo: ${mode === 'manual' ? 'Manual' : mode === 'saved_profile' ? 'Perfil guardado' : 'Configuración ST global'}. `;

    if (mode === 'saved_profile') {
      if (selectedProfile) {
        sourceText += `Perfil seleccionado: ${selectedProfile.name}. `;
      } else {
        sourceText += 'No se ha seleccionado perfil. ';
      }
    }

    if (mode === 'st_global') {
      if (inferredProfile) {
        sourceText += `Perfil ST detectado: ${inferredProfile.name}. `;
      } else {
        sourceText += 'No se detectó perfil ST. ';
      }
    }

    const keySource = mode === 'saved_profile' && selectedProfile?.apiKey
      ? 'perfil guardado'
      : mode === 'st_global' && inferredProfile?.apiKey
        ? 'configuración ST global'
        : manualKey;

    const providerSource = mode === 'saved_profile' && selectedProfile?.provider
      ? selectedProfile.provider
      : mode === 'st_global' && inferredProfile?.provider
        ? inferredProfile.provider
        : provider;

    statusDetailsText.textContent = `${sourceText}Proveedor usado: ${providerSource}. API key: ${keySource}. Endpoint: ${endpoint}.`;
  }

  function updateApiKeyStatus() {
    const key = apiKeyInput.value.trim();
    apiKeyStatusText.textContent = key ? 'Configurada' : 'No configurada';
  }

  async function updateLorebookList() {
    lorebookSelect.innerHTML = '';
    const lorebooks = window.STUniversalTranslator?.getAvailableLorebooks?.() || [];
    if (!lorebooks.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No se encontraron lorebooks';
      option.disabled = true;
      lorebookSelect.appendChild(option);
      lorebookStatusText.textContent = 'No hay lorebooks disponibles en el entorno.';
      return;
    }

    lorebooks.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      lorebookSelect.appendChild(option);
    });

    lorebookStatusText.textContent = `${lorebooks.length} lorebook(s) disponible(s). Se traducirán las entradas del seleccionado.`;
  }

  function filterCharacters(query) {
    const term = (query || '').toLowerCase().trim();
    const options = Array.from(characterBatchSelect.options);
    options.forEach((option) => {
      const text = option.textContent.toLowerCase();
      option.style.display = text.includes(term) ? '' : 'none';
    });
  }

  function setupDragAndDrop(dropZone, input, onFiles) {
    if (!dropZone || !input) return;

    const handleFiles = (files) => {
      if (!files?.length) return;
      input.files = files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    dropZone.addEventListener('click', () => input.click());

    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(event.dataTransfer?.files || []);
      handleFiles(files);
    });

    if (onFiles) {
      input.addEventListener('change', () => {
        onFiles(Array.from(input.files || []));
      });
    }
  }

  async function findSavedApiKeyProfiles() {
    console.log('ST Translator: finding saved API key profiles');
    const candidates = [];
    const contextProfiles = window.SillyTavern?.getContext?.()?.extensionSettings?.connectionManager?.profiles;
    if (Array.isArray(contextProfiles)) {
      console.log('ST Translator: found profiles from SillyTavern context', contextProfiles);
    }
    const sources = [
      window.SillyTavern?.connectionManager?.profiles,
      window.SillyTavern?.connectionManager?.getProfiles,
      window.SillyTavern?.getConnectionManager?.()?.profiles,
      window.SillyTavern?.getConnectionProfiles,
      window.SillyTavern?.getConnections,
      window.SillyTavern?.connectionProfiles,
      window.SillyTavern?.connections,
      window.getConnectionProfiles,
      window.getConnections,
      window.connectionProfiles,
      window.connections,
    ];
    if (Array.isArray(contextProfiles)) {
      candidates.push(...contextProfiles);
    }

    for (const source of sources) {
      try {
        let value;
        console.log('ST Translator: checking profile source', source);
        if (typeof source === 'function') {
          const boundSource = source.bind(window.SillyTavern || window);
          value = await boundSource();
        } else {
          value = source;
        }

        if (!value) {
          console.log('ST Translator: profile source returned empty', source);
          continue;
        }
        console.log('ST Translator: profile source value type', typeof value, value);
        if (Array.isArray(value)) {
          candidates.push(...value);
          continue;
        }
        if (typeof value === 'object') {
          candidates.push(value);
          continue;
        }
      } catch {
        // ignore unsupported source
      }
    }

    const normalizedProfiles = candidates
      .map(normalizeProfile)
      .filter((profile) => profile && (profile.apiKey || profile.apiUrl));
    console.log('ST Translator: normalized saved profiles', normalizedProfiles);
    return normalizedProfiles;
  }

  function populateApiKeyProfiles(profiles) {
    console.log('ST Translator: populating profile dropdown', profiles);
    savedConnectionProfiles = profiles;
    apiKeyProfileSelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = profiles.length ? 'Seleccione un perfil de conexión' : 'No hay perfiles de conexión guardados';
    defaultOption.disabled = !profiles.length;
    defaultOption.selected = true;
    apiKeyProfileSelect.appendChild(defaultOption);

    profiles.forEach((profile, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      const providerInfo = profile.provider ? ` - ${profile.provider}` : '';
      const modelInfo = profile.model ? ` (${profile.model})` : '';
      option.textContent = `${profile.name}${providerInfo}${modelInfo}`;
      apiKeyProfileSelect.appendChild(option);
    });

    apiKeyProfileSelect.disabled = !profiles.length;
    apiKeyLoadButton.disabled = !profiles.length;
    refreshProfilesButton.disabled = false; // Siempre habilitado para refrescar
  }

  function applyProfileProviderSettings(profile) {
    console.log('ST Translator: applying profile settings', profile);
    const normalizedProvider = normalizeProviderKey(profile.provider || profile.api) || guessProviderFromUrl(profile.apiUrl);
    console.log('ST Translator: normalized provider from profile', normalizedProvider);
    if (normalizedProvider && Array.from(providerSelect.options).some((option) => option.value === normalizedProvider)) {
      providerSelect.value = normalizedProvider;
    }
    if (profile.apiUrl) {
      apiUrlInput.value = profile.apiUrl;
    }
    if (profile.model) {
      modelInput.value = profile.model;
    }
    updateModelSuggestionList(providerSelect.value);
  }

  function updateConnectionModeUI() {
    const mode = connectionModeSelect.value;
    const useProfileMode = mode === 'saved_profile';
    const useGlobalMode = mode === 'st_global';

    apiKeyProfileSelect.disabled = !useProfileMode;
    refreshProfilesButton.disabled = !useProfileMode;
    apiKeyLoadButton.disabled = !useProfileMode;
    useProfileProviderCheckbox.disabled = !(mode === 'manual' || useProfileMode);

    if (useGlobalMode) {
      providerSelect.disabled = false;
      apiUrlInput.disabled = false;
      modelInput.disabled = false;
    }

    updateStatusDetails();
  }

  function applyProfileSelection() {
    const profileIndex = apiKeyProfileSelect.value;
    console.log('ST Translator: profile selection changed', profileIndex);
    if (!profileIndex) {
      updateProviderStatusMessage();
      return;
    }

    const profile = savedConnectionProfiles[Number(profileIndex)];
    console.log('ST Translator: selected saved profile', profile);
    if (!profile) {
      return;
    }

    if (profile.apiKey) {
      apiKeyInput.value = profile.apiKey;
    }

    if (useProfileProviderCheckbox.checked) {
      applyProfileProviderSettings(profile);
    }

    updateModelSuggestionList(providerSelect.value);
    updateProviderStatusMessage();
  }

  apiKeyProfileSelect.addEventListener('change', applyProfileSelection);
  connectionModeSelect.addEventListener('change', () => {
    updateConnectionModeUI();
    if (connectionModeSelect.value === 'saved_profile') {
      applyProfileSelection();
    } else {
      updateStatusDetails();
    }
  });
  useProfileProviderCheckbox.addEventListener('change', applyProfileSelection);
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      if (modelSelect.value) {
        modelInput.value = modelSelect.value;
      }
      updateStatusDetails();
    });
  }
  apiKeyLoadButton.addEventListener('click', () => {
    const profileIndex = apiKeyProfileSelect.value;
    if (!profileIndex) {
      statusText.textContent = 'Seleccione primero un perfil de conexión para cargar la clave.';
      return;
    }

    const profile = savedConnectionProfiles[Number(profileIndex)];
    if (!profile?.apiKey) {
      statusText.textContent = 'El perfil seleccionado no tiene una API key guardada.';
      return;
    }

    apiKeyInput.value = profile.apiKey;
    statusText.textContent = 'Clave API cargada desde el perfil seleccionado.';

    if (useProfileProviderCheckbox.checked) {
      applyProfileProviderSettings(profile);
    }
  });

  refreshProfilesButton.addEventListener('click', async () => {
    statusText.textContent = 'Refrescando perfiles de conexión...';
    try {
      const profiles = await findSavedApiKeyProfiles();
      populateApiKeyProfiles(profiles);
      statusText.textContent = `Perfiles refrescados: ${profiles.length} encontrados.`;
    } catch (error) {
      console.error('Error refrescando perfiles:', error);
      statusText.textContent = 'Error al refrescar perfiles.';
    }
  });

  const importStGlobalConfigButton = document.getElementById('importStGlobalConfigButton');
  const refreshGlobalStatusButton = document.getElementById('refreshGlobalStatusButton');

  if (importStGlobalConfigButton) {
    importStGlobalConfigButton.addEventListener('click', () => {
      const inferred = getInferredSTProfile();
      if (!inferred) {
        statusText.textContent = 'No se pudo detectar la configuración ST global.';
        return;
      }

      if (inferred.provider && Array.from(providerSelect.options).some((option) => option.value === inferred.provider)) {
        providerSelect.value = inferred.provider;
      }
      if (inferred.apiUrl) {
        apiUrlInput.value = inferred.apiUrl;
      }
      if (inferred.model) {
        modelInput.value = inferred.model;
      }
      if (inferred.apiKey) {
        apiKeyInput.value = inferred.apiKey;
      }

      connectionModeSelect.value = 'st_global';
      updateModelSuggestionList(providerSelect.value);
      updateProviderStatusMessage();
      updateApiKeyStatus();
      updateConnectionModeUI();
      updateStatusDetails();
      statusText.textContent = 'Configuración ST global importada.';
    });
  }

  if (refreshGlobalStatusButton) {
    refreshGlobalStatusButton.addEventListener('click', () => {
      updateStatusDetails();
      updateApiKeyStatus();
      statusText.textContent = 'Estado global actualizado.';
    });
  }

  let lastProviderSelection = providerSelect.value;

  function updateApiSettingsForProvider(provider, previousProvider) {
    const defaultUrl = DEFAULT_ENDPOINTS[provider] || '';
    const currentUrl = apiUrlInput.value.trim();
    apiUrlInput.placeholder = defaultUrl;

    if (!currentUrl || currentUrl === DEFAULT_ENDPOINTS[previousProvider]) {
      apiUrlInput.value = defaultUrl;
    }
  }

  providerSelect.addEventListener('change', () => {
    const newProvider = providerSelect.value;
    console.log('ST Translator: provider selection changed from', lastProviderSelection, 'to', newProvider);
    updateApiSettingsForProvider(newProvider, lastProviderSelection);
    updateModelSuggestionList(newProvider);
    updateProviderStatusMessage();
    updateStatusDetails();
    lastProviderSelection = newProvider;
    console.log('Proveedor seleccionado:', newProvider, 'URL actual:', apiUrlInput.value);
  });

  apiUrlInput.addEventListener('input', () => {
    updateProviderStatusMessage();
    updateStatusDetails();
  });

  updateApiSettingsForProvider(providerSelect.value);
  updateModelSuggestionList(providerSelect.value);
  updateProviderStatusMessage();
  updateConnectionModeUI();
  updateStatusDetails();

  let translatorSelectedFile = null;

  findSavedApiKeyProfiles().then(populateApiKeyProfiles).catch(() => {
    populateApiKeyProfiles([]);
  });
  pngInput.addEventListener('change', (event) => {
    translatorSelectedFile = event.target.files?.[0] || null;
    statusText.textContent = translatorSelectedFile ? `Archivo seleccionado: ${translatorSelectedFile.name}` : 'Listo';
  });

  translatePngButton.addEventListener('click', async () => {
    if (!translatorSelectedFile) {
      statusText.textContent = 'Seleccione primero un PNG válido.';
      return;
    }

    updateProgress(10, 'Preparando traducción del PNG...');

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('ST Translator: starting PNG translation', providerConfig);
      console.log('Iniciando traducción de PNG con configuración:', providerConfig);
      const translatedBlob = await window.STUniversalTranslator.translateCharacterCard(
        translatorSelectedFile,
        sourceLangSelect.value,
        targetLangSelect.value,
        providerConfig
      );

      updateProgress(100, 'Traducción completada. Descargando archivo.');
      const url = URL.createObjectURL(translatedBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `translated-${translatorSelectedFile.name}`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción del PNG.');
    }
  });

  translateImageBatchButton.addEventListener('click', async () => {
    const files = Array.from(pngBatchInput.files || []);
    if (!files.length) {
      statusText.textContent = 'Seleccione al menos una imagen PNG para el lote.';
      return;
    }

    updateProgress(10, 'Iniciando traducción de lote de imágenes...');

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('ST Translator: starting image batch translation', providerConfig);
      console.log('Iniciando traducción de lote de imágenes con configuración:', providerConfig);
      const results = await window.STUniversalTranslator.translateImageBatch(
        files,
        sourceLangSelect.value,
        targetLangSelect.value,
        outputFolderInput.value.trim(),
        providerConfig,
        Number(batchDelayInput.value || 500)
      );

      statusText.textContent = `Traducción de lote completada (${results.length} imágenes).`;
      console.log('Image batch results:', results);
      updateProgress(100);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción de lote.');
    }
  });

  translateLorebookButton.addEventListener('click', async () => {
    updateProgress(5, 'Iniciando traducción de lorebook...');
    const selectedLorebookId = lorebookSelect.value;
    if (!selectedLorebookId) {
      statusText.textContent = 'Seleccione un lorebook de la lista.';
      updateProgress(0);
      return;
    }

    const lorebooks = window.STUniversalTranslator?.getAvailableLorebooks?.() || [];
    const selectedLorebook = lorebooks.find((item) => item.id === selectedLorebookId)?.data;

    if (!selectedLorebook) {
      statusText.textContent = 'No se encontró el lorebook seleccionado.';
      updateProgress(0);
      return;
    }

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('ST Translator: starting lorebook translation', providerConfig);
      console.log('Iniciando traducción de lorebook con configuración:', providerConfig);
      const translatedLorebook = await window.STUniversalTranslator.translateLorebook(
        selectedLorebook,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        providerConfig
      );

      statusText.textContent = 'Lorebook traducido correctamente.';
      console.log('Translated lorebook:', translatedLorebook);
      updateProgress(100);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción del lorebook.');
    }
  });

  translateSelectedCharactersButton.addEventListener('click', async () => {
    updateProgress(5, 'Iniciando traducción de personajes seleccionados...');

    const selectedIds = Array.from(characterBatchSelect.selectedOptions).map((option) => option.value);
    if (!selectedIds.length) {
      statusText.textContent = 'Seleccione al menos un personaje de la lista.';
      updateProgress(0);
      return;
    }

    const availableCharacters = window.STUniversalTranslator?.getAvailableCharacters?.() || [];
    const selectedItems = availableCharacters
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => item.data);

    if (!selectedItems.length) {
      statusText.textContent = 'No se encontraron los personajes seleccionados.';
      updateProgress(0);
      return;
    }

    try {
      const providerConfig = validateProviderConfig(buildProviderConfig());
      console.log('ST Translator: starting character translation', providerConfig);
      console.log('Iniciando traducción de personajes con configuración:', providerConfig);
      const translatedCharacters = await window.STUniversalTranslator.translateCharacters(
        selectedItems,
        sourceLangSelect.value,
        targetLangSelect.value,
        Number(batchDelayInput.value || 500),
        providerConfig
      );

      if (window.setCurrentCharacters) {
        window.setCurrentCharacters(translatedCharacters);
      } else if (window.setCurrentCharacter) {
        window.setCurrentCharacter(translatedCharacters);
      }

      statusText.textContent = 'Personajes seleccionados traducidos correctamente.';
      console.log('Translated characters:', translatedCharacters);
      updateProgress(100);
    } catch (error) {
      handleTranslationError(error, 'Error durante la traducción de personajes seleccionados.');
    }
  });

  setupDragAndDrop(pngDropZone, pngInput, (files) => {
    const file = files[0];
    if (file) {
      selectedFileName.textContent = `Archivo: ${file.name}`;
      statusText.textContent = `PNG seleccionado: ${file.name}`;
    }
  });

  setupDragAndDrop(pngBatchDropZone, pngBatchInput, (files) => {
    selectedBatchCount.textContent = `${files.length} archivo(s) seleccionado(s)`;
    statusText.textContent = files.length ? `Lote: ${files.length} imágenes` : 'Listo';
  });

  if (characterSearch) {
    characterSearch.addEventListener('input', () => filterCharacters(characterSearch.value));
  }

  if (selectAllCharactersButton) {
    selectAllCharactersButton.addEventListener('click', () => {
      Array.from(characterBatchSelect.options).forEach((option) => {
        option.selected = true;
      });
      statusText.textContent = 'Todos los personajes seleccionados.';
    });
  }

  if (clearCharacterSelectionButton) {
    clearCharacterSelectionButton.addEventListener('click', () => {
      Array.from(characterBatchSelect.options).forEach((option) => {
        option.selected = false;
      });
      statusText.textContent = 'Selección limpiada.';
    });
  }

  if (refreshLorebookListButton) {
    refreshLorebookListButton.addEventListener('click', async () => {
      statusText.textContent = 'Refrescando lorebooks...';
      try {
        await updateLorebookList();
        statusText.textContent = 'Lorebooks refrescados.';
      } catch (error) {
        console.error('Error refrescando lorebooks:', error);
        statusText.textContent = 'Error al refrescar lorebooks.';
      }
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', updateApiKeyStatus);
  }

  if (typeof window.STUniversalTranslator?.getAvailableCharacters === 'function') {
    refreshCharacterList();
  } else {
    statusText.textContent = 'Listo';
  }

  if (typeof window.STUniversalTranslator?.getAvailableLorebooks === 'function') {
    updateLorebookList();
  }
}
