export const CUSTOM_MODEL_VALUE = '__custom_model__';

export const PROVIDER_PRESETS = [
  {
    id: 'custom',
    label: '自定义',
    kind: 'openai-compatible',
    baseUrl: '',
    model: '',
    models: [],
    headers: {}
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-4.1-mini'],
    headers: {}
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'],
    headers: {}
  },
  {
    id: 'qwen',
    label: '通义千问',
    kind: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    headers: {}
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi',
    kind: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    headers: {}
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    kind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B-Instruct-2507',
      'moonshotai/Kimi-K2-Instruct'
    ],
    headers: {}
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
      'deepseek/deepseek-chat'
    ],
    headers: {}
  },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    models: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.1:8b', 'deepseek-r1:7b'],
    headers: {}
  },
  {
    id: 'lmstudio',
    label: 'LM Studio 本地',
    kind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    models: ['local-model', 'qwen2.5-7b-instruct', 'llama-3.1-8b-instruct', 'deepseek-r1-distill-qwen-7b'],
    headers: {}
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    kind: 'anthropic',
    baseUrl: '',
    model: 'claude-sonnet-5',
    models: ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    headers: {}
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: '',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    headers: {}
  }
];

export function createProviderSettingsController({
  els,
  prettyJson,
  setStatus
}) {
  function getProviderPreset(presetId) {
    return PROVIDER_PRESETS.find((item) => item.id === presetId);
  }

  function normalizeProviderKind(kind) {
    const value = String(kind || 'openai-compatible').toLowerCase();
    return ['openai-compatible', 'anthropic', 'gemini'].includes(value)
      ? value
      : 'openai-compatible';
  }

  function resolveProviderPreset(provider) {
    const presetId = String(provider?.preset || '').trim();
    if (PROVIDER_PRESETS.some((preset) => preset.id === presetId)) return presetId;

    const baseUrl = String(provider?.baseUrl || '').replace(/\/+$/, '').toLowerCase();
    const kind = normalizeProviderKind(provider?.kind);
    const matched = PROVIDER_PRESETS.find((preset) => (
      preset.id !== 'custom'
      && preset.kind === kind
      && String(preset.baseUrl || '').replace(/\/+$/, '').toLowerCase() === baseUrl
    ));
    return matched?.id || (kind === 'anthropic' ? 'anthropic' : (kind === 'gemini' ? 'gemini' : 'custom'));
  }

  function syncProviderModelCustomField() {
    const custom = els.providerModel.value === CUSTOM_MODEL_VALUE;
    els.providerModelCustomRow.classList.toggle('is-hidden', !custom);
    if (custom && !els.providerModelCustom.value.trim()) {
      els.providerModelCustom.placeholder = 'model-name';
    }
  }

  function resolveSelectedProviderModel() {
    if (els.providerModel.value === CUSTOM_MODEL_VALUE) {
      return els.providerModelCustom.value.trim();
    }
    return els.providerModel.value.trim();
  }

  function renderProviderPresetOptions() {
    if (!els.providerPreset || els.providerPreset.options.length > 1) return;
    els.providerPreset.innerHTML = '';
    PROVIDER_PRESETS.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      els.providerPreset.append(option);
    });
  }

  function renderProviderModelOptions(presetId, currentModel = '') {
    if (!els.providerModel) return;
    const preset = getProviderPreset(presetId);
    const modelNames = Array.isArray(preset?.models) ? preset.models : [];
    const current = String(currentModel || '').trim();
    const hasCurrent = current && modelNames.includes(current);

    els.providerModel.innerHTML = '';
    modelNames.forEach((model) => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      els.providerModel.append(option);
    });

    const customOption = document.createElement('option');
    customOption.value = CUSTOM_MODEL_VALUE;
    customOption.textContent = '自定义模型...';
    els.providerModel.append(customOption);

    els.providerModel.value = hasCurrent ? current : CUSTOM_MODEL_VALUE;
    els.providerModelCustom.value = hasCurrent ? '' : current;
    syncProviderModelCustomField();
  }

  function applyProviderPreset(presetId) {
    const preset = getProviderPreset(presetId);
    renderProviderModelOptions(presetId, resolveSelectedProviderModel());
    if (!preset || preset.id === 'custom') return;

    const currentId = els.providerId.value.trim();
    els.providerKind.value = preset.kind;
    if (!currentId || currentId === 'local' || PROVIDER_PRESETS.some((item) => item.id === currentId)) {
      els.providerId.value = preset.id;
    }
    els.providerBaseUrl.value = preset.baseUrl;
    renderProviderModelOptions(presetId, preset.model);
    els.providerHeaders.value = prettyJson(preset.headers || {});
    setStatus(els.providerStatus, `已套用 ${preset.label} 模板`, 'ok');
  }

  return {
    applyProviderPreset,
    getProviderPreset,
    normalizeProviderKind,
    renderProviderModelOptions,
    renderProviderPresetOptions,
    resolveProviderPreset,
    resolveSelectedProviderModel,
    syncProviderModelCustomField
  };
}
