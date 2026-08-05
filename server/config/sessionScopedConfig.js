export function buildSessionScopedConfig(globalConfig = {}, session = {}) {
  const sessionConfig = isPlainObject(session?.config) ? session.config : {};
  const hasScopedNarrative = isPlainObject(sessionConfig.characterCard)
    && Array.isArray(sessionConfig.promptModules)
    && Array.isArray(sessionConfig.worldBook);
  return {
    ...globalConfig,
    promptModules: Array.isArray(sessionConfig.promptModules)
      ? sessionConfig.promptModules
      : globalConfig.promptModules,
    worldBook: Array.isArray(sessionConfig.worldBook)
      ? sessionConfig.worldBook
      : globalConfig.worldBook,
    characterCard: isPlainObject(sessionConfig.characterCard)
      ? sessionConfig.characterCard
      : globalConfig.characterCard,
    characterPresets: Array.isArray(sessionConfig.characterPresets)
      ? sessionConfig.characterPresets
      : hasScopedNarrative ? [] : globalConfig.characterPresets,
    groupMembers: Array.isArray(sessionConfig.groupMembers)
      ? sessionConfig.groupMembers
      : hasScopedNarrative ? [] : globalConfig.groupMembers,
    worldSystems: isPlainObject(sessionConfig.worldSystems)
      ? sessionConfig.worldSystems
      : hasScopedNarrative ? {} : globalConfig.worldSystems,
    persona: isPlainObject(sessionConfig.persona)
      ? sessionConfig.persona
      : globalConfig.persona,
    lightFrontend: isPlainObject(sessionConfig.lightFrontend)
      ? sessionConfig.lightFrontend
      : isPlainObject(globalConfig.lightFrontend)
        ? globalConfig.lightFrontend
        : {}
  };
}

export function buildEditableSessionConfig(globalConfig = {}, session = {}) {
  const sessionConfig = isPlainObject(session?.config) ? session.config : {};
  const scoped = buildSessionScopedConfig(globalConfig, session);
  return {
    ...sessionConfig,
    characterCard: scoped.characterCard,
    characterPresets: scoped.characterPresets,
    groupMembers: scoped.groupMembers,
    worldSystems: scoped.worldSystems,
    promptModules: scoped.promptModules,
    worldBook: scoped.worldBook,
    persona: scoped.persona,
    lightFrontend: scoped.lightFrontend
  };
}

export function hasCompleteSessionConfig(value) {
  return isPlainObject(value)
    && isPlainObject(value.characterCard)
    && Array.isArray(value.promptModules)
    && Array.isArray(value.worldBook)
    && isPlainObject(value.persona)
    && isPlainObject(value.lightFrontend);
}

export function materializeSessionOwnedConfig(value = {}) {
  const config = isPlainObject(value) ? structuredClone(value) : {};
  return {
    ...config,
    characterCard: isPlainObject(config.characterCard) ? config.characterCard : {},
    promptModules: Array.isArray(config.promptModules) ? config.promptModules : [],
    worldBook: Array.isArray(config.worldBook) ? config.worldBook : [],
    persona: isPlainObject(config.persona) ? config.persona : {},
    lightFrontend: isPlainObject(config.lightFrontend) ? config.lightFrontend : {}
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
