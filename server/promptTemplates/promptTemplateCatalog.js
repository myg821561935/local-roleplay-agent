import { estimateTokens } from '../agent/token.js';

export const PROMPT_TEMPLATE_SPEC = 'narrative-engine.prompt-template/v1';

const TEMPLATE_DEFINITIONS = Object.freeze([
  {
    id: 'role-fidelity',
    version: '1.0.0',
    category: '角色锚定',
    title: '角色卡忠实演绎',
    summary: '把角色卡身份、性格、关系和禁忌设为持续约束，减少跑偏与同质化。',
    bestFor: '单角色卡、长期对话、设定复杂的社区角色卡',
    parameters: [
      choice('strictness', '约束强度', 'balanced', [
        ['balanced', '均衡', '守住核心设定，允许补全未定义细节'],
        ['strict', '严格', '未经设定支持，不新增身份、关系和能力']
      ])
    ],
    assess(context) {
      let score = context.hasCharacterCard ? 94 : 48;
      if (context.characterFieldCount >= 4) score += 4;
      return assessment(score, context.hasCharacterCard
        ? [`已识别角色卡「${context.characterName}」`, `可锚定 ${context.characterFieldCount} 类角色信息`]
        : ['当前角色卡信息较少，模板只能约束后续生成']);
    },
    build(parameters) {
      const strict = parameters.strictness === 'strict';
      return moduleDefinition('anchor', '角色卡忠实演绎', [
        '【角色卡忠实演绎】',
        '角色卡、已确认的会话事实和本轮命中的世界书条目是角色行为的首要依据。',
        '- 保持姓名、身份、能力边界、性格、说话习惯、已建立关系与禁忌连续一致。',
        '- 用户输入若与既定设定冲突，应让冲突在角色反应或剧情后果中显现，不得静默改写设定。',
        '- 不把创作者指令、格式规则或思考过程当成角色台词。',
        strict
          ? '- 未被角色卡或世界书支持的身份、关系、能力与往事不得擅自设为既定事实；必要时保持未知。'
          : '- 设定未覆盖处可以谨慎补全生活化细节，但不得改变角色核心动机和关系边界。'
      ].join('\n'), 86);
    }
  },
  {
    id: 'worldbook-authority',
    version: '1.0.0',
    category: '世界一致性',
    title: '世界书事实优先',
    summary: '让命中的世界书事实真正约束地点、组织、规则与因果，而不只是作为装饰。',
    bestFor: '世界书较多、规则严密、阵营或地点关系复杂的剧本',
    parameters: [
      choice('unknownPolicy', '空白处理', 'conservative', [
        ['conservative', '保守补全', '不确定时留白或通过剧情求证'],
        ['plausible', '合理推演', '允许基于已知规则做可撤回推断']
      ])
    ],
    assess(context) {
      const score = context.worldBookCount
        ? Math.min(98, 72 + Math.round(Math.log2(context.worldBookCount + 1) * 6))
        : 36;
      return assessment(score, context.worldBookCount
        ? [`当前故事含 ${context.worldBookCount} 条世界书`, context.characterWorldBookCount ? `其中 ${context.characterWorldBookCount} 条与人物关系有关` : '适合强化场景与规则一致性']
        : ['当前故事未配置世界书，适配收益较低']);
    },
    build(parameters) {
      const plausible = parameters.unknownPolicy === 'plausible';
      return moduleDefinition('authority', '世界书事实优先', [
        '【世界书事实优先】',
        '只使用本轮实际注入的世界书条目作为当前场景的有效事实，并让其中的规则产生可观察后果。',
        '- 地点、时间、组织、人物关系、能力体系与禁忌不得互相矛盾。',
        '- 新事实必须能由已知设定、角色行动或场景证据推导；不得用通用题材套路覆盖本地设定。',
        '- 设定发生变化时，通过事件与角色认知差异解释变化，并保持后续一致。',
        plausible
          ? '- 对空白处可做符合现有因果的暂定推演，但应保留被后续事实修正的空间。'
          : '- 对空白处保持克制；优先通过观察、询问或事件揭示，不把猜测写成既定事实。'
      ].join('\n'), 84);
    }
  },
  {
    id: 'scene-progression',
    version: '1.0.0',
    category: '剧情推进',
    title: '长篇连续推进',
    summary: '每轮完成一个有起伏的剧情段落，避免只回复一两句后反复等待用户推动。',
    bestFor: '正文叙事、调查、冒险与需要持续推进的长对话',
    parameters: [
      choice('length', '段落体量', 'long', [
        ['balanced', '适中', '完成 2 个推进单元并留下落点'],
        ['long', '长篇', '完成 3 至 4 个推进单元和一次局势变化']
      ]),
      choice('pace', '推进节奏', 'balanced', [
        ['slow', '舒缓', '重视氛围、细节和关系反应'],
        ['balanced', '均衡', '行动、对话与环境变化并重'],
        ['fast', '紧凑', '更快触发事件、阻力和结果']
      ])
    ],
    assess(context) {
      const responseLength = context.responseLength;
      const score = responseLength === 'compact' ? 70 : responseLength === 'long' ? 96 : 90;
      return assessment(score, [
        `当前会话输出档位：${responseLengthLabel(responseLength)}`,
        context.messageCount > 8 ? `已有 ${context.messageCount} 条消息，适合强化连续性` : '适合从开局建立完整剧情节拍'
      ]);
    },
    build(parameters) {
      const long = parameters.length === 'long';
      const pace = {
        slow: '节奏舒缓：增加感官细节、停顿、潜台词与关系反应，但仍要发生可感知的变化。',
        fast: '节奏紧凑：尽快出现行动、阻力、选择或结果，删去重复解释。',
        balanced: '节奏均衡：行动、对话、环境反馈与心理反应共同推进。'
      }[parameters.pace];
      return moduleDefinition('progression', '长篇连续推进', [
        '【长篇连续推进】',
        `每次正文回复应形成一个完整的小场景，至少完成 ${long ? '3 至 4' : '2'} 个连续推进单元，而不是只复述用户动作或停在开头。`,
        '- 推进单元应包含“行动或对话 → 环境/他人反馈 → 新信息或局势变化”。',
        '- 让配角主动观察、判断和行动；用户没有明确指令时，世界仍会按人物动机继续运转。',
        '- 结尾落在具体的新态势、可回应的话语或自然选择点，不使用空泛的“接下来怎么办”。',
        `- ${pace}`,
        '- 服从实际输出预算；接近预算时优先完成当前节拍并给出清晰落点，不截断在半句话中。'
      ].join('\n'), 78);
    }
  },
  {
    id: 'living-dialogue',
    version: '1.0.0',
    category: '人物互动',
    title: '自然对话与活人感',
    summary: '减少说明书式对白，让角色根据关系、情绪和处境主动回应。',
    bestFor: '恋爱、日常、轻小说、陪伴与高频角色互动',
    parameters: [
      choice('dialogueDensity', '对白密度', 'balanced', [
        ['low', '少量', '以行动和氛围为主，对白点到为止'],
        ['balanced', '均衡', '对白、动作与潜台词相互支撑'],
        ['high', '偏高', '更多来回交流，但避免问答机式轮替']
      ])
    ],
    assess(context) {
      let score = context.hasCharacterCard ? 88 : 62;
      if (/恋爱|女仆|日常|校园|现代|陪伴/.test(context.genreText)) score += 8;
      return assessment(score, context.hasCharacterCard
        ? [`角色「${context.characterName}」可作为稳定说话主体`, '适合强化情绪、动作与潜台词']
        : ['缺少完整角色卡时，角色差异主要依赖当前上下文']);
    },
    build(parameters) {
      const density = {
        low: '对白保持精炼，更多用动作、目光、停顿和环境反馈承载情绪。',
        high: '可以安排多轮自然对话，但每句都应改变情绪、关系、信息或行动。',
        balanced: '对白与动作、表情、潜台词交替出现，避免连续大段说明。'
      }[parameters.dialogueDensity];
      return moduleDefinition('dialogue', '自然对话与活人感', [
        '【自然对话与活人感】',
        '- 每个角色只知道其身份与经历允许知道的事，并以自己的目标、情绪和关系距离回应。',
        '- 避免客服腔、总结腔、连续反问和把设定直接背给用户；信息应从言行与场景中自然显露。',
        '- 角色可以犹豫、误解、保留、转移话题或主动提出具体行动，但不能无理由反复拒绝推进。',
        `- ${density}`,
        '- 不替用户决定关键选择、内心结论或未声明的台词。'
      ].join('\n'), 74);
    }
  },
  {
    id: 'ensemble-cast',
    version: '1.0.0',
    category: '群像调度',
    title: '多角色群像调度',
    summary: '管理多人在场、信息差和轮流聚焦，避免所有 NPC 说成同一种声音。',
    bestFor: '场景容器卡、群聊卡、势力剧本与人物关系较多的世界书',
    parameters: [
      choice('focus', '镜头分配', 'focused', [
        ['focused', '主次分明', '每轮聚焦 1 至 2 人，其余保持在场反应'],
        ['rotating', '轮换群像', '按动机和事件自然轮换发言与行动者']
      ])
    ],
    assess(context) {
      let score = 44;
      if (context.groupMemberCount > 1) score += 38;
      if (context.characterWorldBookCount > 2) score += 14;
      if (context.scenarioContainer) score += 12;
      return assessment(score, [
        context.groupMemberCount ? `已配置 ${context.groupMemberCount} 个互动角色` : '尚未配置显式群组成员',
        context.characterWorldBookCount ? `世界书含 ${context.characterWorldBookCount} 条人物关系条目` : '世界书人物关系条目较少'
      ]);
    },
    build(parameters) {
      const rotating = parameters.focus === 'rotating';
      return moduleDefinition('ensemble', '多角色群像调度', [
        '【多角色群像调度】',
        '- 先判断本轮实际在场人物；不让未在场角色无故插话，也不让在场角色凭空消失。',
        '- 每个角色依据自己的知识、关系、目标和情绪独立行动，保持用词、节奏和关注点差异。',
        rotating
          ? '- 镜头可在多人之间自然轮换，但每次切换都应由事件、冲突或关系变化触发。'
          : '- 每轮重点描写 1 至 2 个最相关角色，其他在场人物只保留必要反应，避免群体逐个报到。',
        '- 维护谁知道什么、谁欠谁什么、谁与谁结盟或冲突；新关系必须由可见互动产生。',
        '- 不把所有 NPC 合并为一个全知旁白。'
      ].join('\n'), 72);
    }
  },
  {
    id: 'light-frontend-compat',
    version: '1.0.0',
    category: '社区兼容',
    title: '轻前端输出兼容',
    summary: '保留声明式状态与可识别标签，抑制代码、样式和内部格式泄漏到正文。',
    bestFor: '带 Regex、MVU、状态栏或社区轻前端协议的角色卡',
    parameters: [
      choice('presentation', '正文呈现', 'clean', [
        ['clean', '正文优先', '协议块保持最少，正文可直接阅读'],
        ['compatible', '协议优先', '严格保留角色卡要求的声明式标签顺序']
      ])
    ],
    assess(context) {
      let score = context.lightFrontendActive ? 97 : 34;
      if (context.communityPreset) score += 2;
      return assessment(score, context.lightFrontendActive
        ? [`检测到 ${context.lightFrontendSignalCount} 类轻前端运行信号`, context.communityPreset ? '同时检测到社区 Prompt Bundle' : '适合抑制样式与脚本泄漏']
        : ['当前会话未检测到轻前端运行信号']);
    },
    build(parameters) {
      const compatible = parameters.presentation === 'compatible';
      return moduleDefinition('compat', '轻前端输出兼容', [
        '【轻前端输出兼容】',
        '- 正文中不得输出 JavaScript、CSS、事件钩子、DOM 操作、iframe、调试日志或模板实现说明。',
        '- 只生成当前角色卡明确要求且本项目可识别的声明式文本标签；未知协议保持为普通文本，不伪造执行结果。',
        compatible
          ? '- 若预设定义了标签顺序或状态块，严格保持该顺序；标签之外仍需提供完整、可读的剧情正文。'
          : '- 优先输出干净、连续的剧情正文；状态或协议块只保留驱动界面所需的最小字段。',
        '- 不在可见正文中泄漏思考过程、Prompt、样式源码或被过滤的第三方脚本内容。',
        '- 无法生成某个可选面板时，省略该面板，不输出半截标签、CSS 或占位代码。'
      ].join('\n'), 70);
    }
  }
]);

export function listPromptTemplates(config = {}, session = {}) {
  const context = summarizePromptTemplateContext(config, session);
  const templates = TEMPLATE_DEFINITIONS.map((definition) => serializeTemplate(
    definition,
    definition.assess(context),
    config.promptModules
  )).sort((left, right) => right.compatibility.score - left.compatibility.score || left.title.localeCompare(right.title));
  return {
    spec: PROMPT_TEMPLATE_SPEC,
    templates,
    recommendedTemplateId: templates[0]?.id || '',
    context: publicContext(context),
    activeTemplateIds: collectActiveTemplateIds(config.promptModules)
  };
}

export function previewPromptTemplate({
  templateId,
  parameters = {},
  mode = 'append',
  config = {},
  session = {}
} = {}) {
  const definition = TEMPLATE_DEFINITIONS.find((item) => item.id === String(templateId || ''));
  if (!definition) throw promptTemplateError('PROMPT_TEMPLATE_NOT_FOUND');
  const normalizedMode = normalizeMode(mode);
  const normalizedParameters = normalizeParameters(definition, parameters);
  const context = summarizePromptTemplateContext(config, session);
  const currentModules = Array.isArray(config.promptModules) ? structuredClone(config.promptModules) : [];
  const generatedModules = definition.build(normalizedParameters).map((item) => materializeModule(
    definition,
    normalizedParameters,
    item
  ));
  const merged = mergeTemplateModules(currentModules, generatedModules, normalizedMode);
  const compatibility = definition.assess(context);
  const warnings = buildWarnings({ definition, context, mode: normalizedMode, currentModules, merged });
  const currentTokens = estimatePromptModules(currentModules);
  const nextTokens = estimatePromptModules(merged.promptModules);
  return {
    spec: PROMPT_TEMPLATE_SPEC,
    template: serializeTemplate(definition, compatibility, currentModules),
    parameters: normalizedParameters,
    mode: normalizedMode,
    modules: generatedModules,
    promptModules: merged.promptModules,
    changes: {
      added: merged.added,
      updated: merged.updated,
      removedTemplateModules: merged.removedTemplateModules,
      preserved: merged.promptModules.length - generatedModules.length,
      currentModuleCount: currentModules.length,
      nextModuleCount: merged.promptModules.length,
      estimatedTokenDelta: nextTokens - currentTokens,
      estimatedTokens: nextTokens
    },
    warnings,
    activeTemplateIds: collectActiveTemplateIds(merged.promptModules)
  };
}

export function collectActiveTemplateIds(promptModules = []) {
  return [...new Set((Array.isArray(promptModules) ? promptModules : [])
    .map((module) => String(module?.extensions?.promptTemplate?.templateId || '').trim())
    .filter(Boolean))];
}

function choice(id, label, defaultValue, options) {
  return {
    id,
    label,
    type: 'choice',
    defaultValue,
    options: options.map(([value, optionLabel, description]) => ({ value, label: optionLabel, description }))
  };
}

function assessment(score, reasons) {
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

function moduleDefinition(key, title, content, order) {
  return [{ key, title, content, order }];
}

function normalizeMode(mode) {
  return String(mode || '') === 'replace' ? 'replace' : 'append';
}

function normalizeParameters(definition, parameters) {
  const source = parameters && typeof parameters === 'object' && !Array.isArray(parameters) ? parameters : {};
  return Object.fromEntries(definition.parameters.map((parameter) => {
    const value = String(source[parameter.id] ?? parameter.defaultValue);
    const allowed = new Set(parameter.options.map((option) => option.value));
    return [parameter.id, allowed.has(value) ? value : parameter.defaultValue];
  }));
}

function materializeModule(definition, parameters, module) {
  return {
    id: `prompt-template:${definition.id}:${module.key}`,
    title: module.title,
    enabled: true,
    role: 'system',
    position: 'relative',
    order: module.order,
    source: 'prompt-template-center',
    content: module.content,
    extensions: {
      promptTemplate: {
        spec: PROMPT_TEMPLATE_SPEC,
        templateId: definition.id,
        templateVersion: definition.version,
        category: definition.category,
        parameters
      }
    }
  };
}

function mergeTemplateModules(currentModules, generatedModules, mode) {
  const generatedById = new Map(generatedModules.map((module) => [module.id, module]));
  const generatedTemplateId = generatedModules[0]?.extensions?.promptTemplate?.templateId || '';
  let added = generatedModules.length;
  let updated = 0;
  let removedTemplateModules = 0;
  const preserved = [];

  for (const module of currentModules) {
    const managedTemplateId = String(module?.extensions?.promptTemplate?.templateId || '');
    const replacement = generatedById.get(module?.id);
    if (replacement) {
      preserved.push(replacement);
      generatedById.delete(module.id);
      added -= 1;
      updated += 1;
      continue;
    }
    if (mode === 'replace' && managedTemplateId && managedTemplateId !== generatedTemplateId) {
      removedTemplateModules += 1;
      continue;
    }
    preserved.push(module);
  }

  return {
    promptModules: [...preserved, ...generatedById.values()],
    added,
    updated,
    removedTemplateModules
  };
}

function serializeTemplate(definition, compatibility, promptModules = []) {
  const active = collectActiveTemplateIds(promptModules).includes(definition.id);
  return {
    id: definition.id,
    version: definition.version,
    category: definition.category,
    title: definition.title,
    summary: definition.summary,
    bestFor: definition.bestFor,
    parameters: structuredClone(definition.parameters),
    compatibility,
    active
  };
}

function summarizePromptTemplateContext(config, session) {
  const characterCard = isRecord(config.characterCard) ? config.characterCard : {};
  const worldBook = Array.isArray(config.worldBook) ? config.worldBook : [];
  const promptModules = Array.isArray(config.promptModules) ? config.promptModules : [];
  const groupMembers = Array.isArray(config.groupMembers) ? config.groupMembers : [];
  const characterName = String(characterCard.name || characterCard.data?.name || '').trim() || '未命名角色';
  const characterFields = [
    characterName && characterName !== '未命名角色',
    characterCard.description || characterCard.data?.description,
    characterCard.personality || characterCard.data?.personality,
    characterCard.scenario || characterCard.data?.scenario,
    characterCard.firstMessage || characterCard.first_mes || characterCard.data?.first_mes,
    characterCard.systemPrompt || characterCard.system_prompt || characterCard.data?.system_prompt
  ].filter(Boolean).length;
  const lightFrontend = isRecord(config.lightFrontend) ? config.lightFrontend : {};
  const lightSignals = [
    Array.isArray(lightFrontend.regexTransforms) && lightFrontend.regexTransforms.length,
    Array.isArray(lightFrontend.panels) && lightFrontend.panels.length,
    isRecord(lightFrontend.mvu) && Object.keys(lightFrontend.mvu).length,
    isRecord(session?.memory?.lightFrontendState) && Object.keys(session.memory.lightFrontendState).length
  ].filter(Boolean).length;
  const genreText = [
    characterCard.tags,
    characterCard.data?.tags,
    characterCard.scenario,
    characterCard.data?.scenario,
    session?.memory?.narrativeState?.lockedGenre,
    session?.title
  ].flat().filter(Boolean).join(' ');
  return {
    characterName,
    hasCharacterCard: characterFields >= 2,
    characterFieldCount: characterFields,
    worldBookCount: worldBook.length,
    characterWorldBookCount: worldBook.filter((entry) => /character|人物|关系|npc/i.test(`${entry?.type || ''} ${entry?.title || ''}`)).length,
    groupMemberCount: groupMembers.length,
    promptModuleCount: promptModules.length,
    communityPreset: promptModules.some((module) => Boolean(module?.extensions?.sillyTavernPreset)),
    lightFrontendActive: lightSignals > 0,
    lightFrontendSignalCount: lightSignals,
    scenarioContainer: /scenario.container|场景容器|群像|多人/i.test(JSON.stringify(characterCard.extensions || {})),
    responseLength: ['compact', 'balanced', 'long'].includes(session?.settings?.responseLength)
      ? session.settings.responseLength
      : 'balanced',
    messageCount: Array.isArray(session?.messages) ? session.messages.length : 0,
    genreText
  };
}

function publicContext(context) {
  return {
    characterName: context.characterName,
    hasCharacterCard: context.hasCharacterCard,
    worldBookCount: context.worldBookCount,
    groupMemberCount: context.groupMemberCount,
    promptModuleCount: context.promptModuleCount,
    communityPreset: context.communityPreset,
    lightFrontendActive: context.lightFrontendActive,
    responseLength: context.responseLength,
    messageCount: context.messageCount
  };
}

function buildWarnings({ definition, context, mode, currentModules, merged }) {
  const warnings = [];
  if (definition.id === 'role-fidelity' && !context.hasCharacterCard) {
    warnings.push('当前角色卡信息较少，建议先完善角色描述、性格或场景。');
  }
  if (definition.id === 'worldbook-authority' && !context.worldBookCount) {
    warnings.push('当前故事没有世界书；应用后不会凭空生成世界设定。');
  }
  if (definition.id === 'ensemble-cast' && context.groupMemberCount < 2 && context.characterWorldBookCount < 2) {
    warnings.push('当前人物关系素材较少，群像模板的收益有限。');
  }
  if (definition.id === 'light-frontend-compat' && !context.lightFrontendActive) {
    warnings.push('未检测到轻前端协议；普通文字卡通常不需要此模板。');
  }
  if (mode === 'replace' && collectActiveTemplateIds(currentModules).length) {
    warnings.push(`将移除 ${merged.removedTemplateModules} 个旧模板中心模块；角色卡与社区预设模块会保留。`);
  }
  if (merged.promptModules.length > 30) {
    warnings.push(`应用后共有 ${merged.promptModules.length} 个 Prompt 模块；运行时会按预算筛选，建议检查是否存在重复社区模块。`);
  }
  return warnings;
}

function estimatePromptModules(modules) {
  return (Array.isArray(modules) ? modules : []).reduce((total, module) => (
    total + estimateTokens(`${module?.title || ''}\n${module?.content || ''}`)
  ), 0);
}

function responseLengthLabel(value) {
  return { compact: '精简', balanced: '均衡', long: '长篇' }[value] || '均衡';
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function promptTemplateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
