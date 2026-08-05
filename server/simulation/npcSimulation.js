import crypto from 'node:crypto';

export const SIMULATION_SPEC = 'lra.simulation/v1';
export const WORLD_SYSTEMS_SPEC = 'narrative-engine.world-systems/v1';

export function createSimulationState({ actors = [], clock, systems } = {}) {
  const normalizedActors = normalizeActors(actors);
  return {
    spec: SIMULATION_SPEC,
    revision: 0,
    clock: normalizeClock(clock),
    actors: normalizedActors,
    systems: normalizeWorldSystems(systems),
    backstageEvents: [],
    settings: {
      autoAdvanceMinutes: 0,
      maxBackstageEvents: 300,
      rosterInitialized: normalizedActors.length > 0
    }
  };
}

export function ensureSimulationMemory(memory, { characterCard, groupMembers, characterPresets, worldSystems } = {}) {
  const next = structuredClone(memory && typeof memory === 'object' ? memory : {});
  const existing = next.simulation && typeof next.simulation === 'object'
    ? next.simulation
    : createSimulationState();
  const seedActors = buildActorSeeds({ characterCard, groupMembers, characterPresets });
  const actors = normalizeActors(existing.actors);
  const systems = hasWorldSystemContent(existing.systems)
    ? normalizeWorldSystems(existing.systems)
    : normalizeWorldSystems(worldSystems);
  const rosterInitialized = existing.settings?.rosterInitialized === true
    || actors.length > 0
    || normalizeInteger(existing.revision, 0) > 0;
  if (!rosterInitialized) {
    const knownIds = new Set(actors.map((actor) => actor.id));
    for (const seed of seedActors) {
      if (!knownIds.has(seed.id)) {
        actors.push(seed);
        knownIds.add(seed.id);
      }
    }
  }

  next.simulation = {
    spec: SIMULATION_SPEC,
    revision: normalizeInteger(existing.revision, 0),
    clock: normalizeClock(existing.clock),
    actors,
    systems,
    backstageEvents: normalizeBackstageEvents(existing.backstageEvents),
    settings: {
      autoAdvanceMinutes: clampInteger(existing.settings?.autoAdvanceMinutes, 0, 1440, 0),
      maxBackstageEvents: clampInteger(existing.settings?.maxBackstageEvents, 50, 2000, 300),
      rosterInitialized: rosterInitialized || seedActors.length > 0
    }
  };
  return next;
}

export function normalizeActors(input) {
  const actors = [];
  const usedIds = new Set();
  for (const [index, value] of (Array.isArray(input) ? input : []).entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const name = String(value.name || '').trim().slice(0, 80);
    if (!name) continue;
    let id = normalizeActorId(value.id || slugify(name) || `npc-${index + 1}`);
    if (!id) id = `npc-${index + 1}`;
    let suffix = 2;
    const baseId = id;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    actors.push({
      id,
      name,
      role: String(value.role || '').trim().slice(0, 160),
      enabled: value.enabled !== false,
      location: String(value.location || '').trim().slice(0, 160),
      status: String(value.status || 'idle').trim().slice(0, 240),
      goals: uniqueStrings(value.goals, 12, 240),
      publicKnowledge: uniqueStrings(value.publicKnowledge || value.knowledge?.public, 30, 500),
      privateKnowledge: uniqueStrings(value.privateKnowledge || value.knowledge?.private, 30, 500),
      relationships: normalizeRelationships(value.relationships),
      schedule: normalizeSchedule(value.schedule),
      agenda: normalizeAgenda(value.agenda),
      metadata: normalizeMetadata(value.metadata)
    });
  }
  return actors;
}

export function normalizeWorldSystems(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    spec: WORLD_SYSTEMS_SPEC,
    topology: {
      nodes: normalizeSystemRecords(source.topology?.nodes, 240),
      edges: normalizeSystemEdges(source.topology?.edges, 400),
      currentNodeId: String(source.topology?.currentNodeId || '').slice(0, 160)
    },
    population: {
      profiles: normalizePopulationProfiles(source.population?.profiles, 160),
      scheduleRules: normalizeSystemRecords(source.population?.scheduleRules, 80)
    },
    factions: {
      entities: normalizeSystemRecords(source.factions?.entities, 120),
      relations: normalizeFactionRelations(source.factions?.relations, 240)
    },
    calendar: {
      name: String(source.calendar?.name || '').slice(0, 120),
      era: String(source.calendar?.era || '').slice(0, 120),
      dayLabel: String(source.calendar?.dayLabel || '').slice(0, 120),
      rules: normalizeSystemRecords(source.calendar?.rules, 80)
    },
    economy: {
      currencies: uniqueStrings(source.economy?.currencies, 30, 80),
      markets: normalizeSystemRecords(source.economy?.markets, 80),
      rules: normalizeSystemRecords(source.economy?.rules, 100)
    },
    cultivation: {
      paths: normalizeSystemRecords(source.cultivation?.paths, 100),
      scales: uniqueStrings(source.cultivation?.scales, 40, 80),
      backlash: normalizeSystemRecords(source.cultivation?.backlash, 40),
      rules: normalizeSystemRecords(source.cultivation?.rules, 120)
    },
    source: {
      entryCount: clampInteger(source.source?.entryCount, 0, 100000, 0),
      mappedCount: clampInteger(source.source?.mappedCount, 0, 100000, 0)
    }
  };
}

export function advanceSimulationClock(simulationInput, { minutes = 60, reason = 'manual', now = () => new Date() } = {}) {
  const simulation = normalizeSimulation(simulationInput);
  const safeMinutes = clampInteger(minutes, 1, 10080, 60);
  const startAbsolute = toAbsoluteMinute(simulation.clock);
  const endAbsolute = startAbsolute + safeMinutes;
  const effects = [];
  const events = [];

  for (const actor of simulation.actors) {
    if (!actor.enabled) continue;
    for (const schedule of actor.schedule) {
      for (const occurrence of scheduleOccurrences(schedule, startAbsolute, endAbsolute)) {
        const before = { location: actor.location, status: actor.status };
        if (schedule.location) actor.location = schedule.location;
        if (schedule.activity) actor.status = schedule.activity;
        const event = {
          id: `backstage-${crypto.randomUUID()}`,
          timestamp: now().toISOString(),
          absoluteMinute: occurrence,
          actorId: actor.id,
          actorName: actor.name,
          visibility: schedule.visibility,
          summary: `${actor.name}${schedule.location ? `前往${schedule.location}` : ''}${schedule.activity ? `，${schedule.activity}` : ''}`,
          reason: String(reason || 'schedule').slice(0, 240)
        };
        events.push(event);
        effects.push({
          actionId: schedule.id,
          type: 'schedule.trigger',
          path: `simulation.actors.${actor.id}`,
          before,
          after: { location: actor.location, status: actor.status },
          visibility: schedule.visibility
        });
      }
    }
  }

  simulation.clock = fromAbsoluteMinute(endAbsolute);
  simulation.backstageEvents.push(...events);
  const maxEvents = simulation.settings.maxBackstageEvents;
  simulation.backstageEvents = simulation.backstageEvents.slice(-maxEvents);

  effects.unshift({
    actionId: 'clock',
    type: 'clock.advance',
    path: 'simulation.clock',
    before: fromAbsoluteMinute(startAbsolute),
    after: structuredClone(simulation.clock),
    visibility: 'public'
  });
  return { simulation, effects, events, minutes: safeMinutes };
}

export function projectSimulation(simulationInput, { director = false } = {}) {
  const simulation = normalizeSimulation(simulationInput);
  const actors = simulation.actors.map((actor) => {
    const projected = structuredClone(actor);
    if (!director) {
      delete projected.privateKnowledge;
      projected.schedule = projected.schedule.filter((entry) => entry.visibility === 'public');
      projected.agenda = projected.agenda.filter((entry) => entry.visibility === 'public');
    }
    return projected;
  });
  return {
    ...simulation,
    actors,
    systems: projectWorldSystems(simulation.systems, { director }),
    backstageEvents: simulation.backstageEvents.filter((event) => director || event.visibility === 'public')
  };
}

export function renderSimulationPrompt(memory, { targetSpeaker } = {}) {
  const simulation = normalizeSimulation(memory?.simulation);
  if (!simulation.actors.length && !hasWorldSystemContent(simulation.systems)) return '';
  const lines = [
    '# 结构化世界状态',
    `时间：${simulation.clock.label}（修订 ${simulation.revision}）`,
    '以下资料来自安全转换后的世界书与当前模拟状态。它们是叙事约束，不代表原卡的 JavaScript 或 EJS 已执行。',
    '世界演化必须通过世界状态、角色日程、动作协议与事件账本落地；以下“私有”内容不得直接向用户泄露。'
  ];
  const target = String(targetSpeaker || '').trim();
  const enabledActors = simulation.actors.filter((item) => item.enabled);
  const orderedActors = target
    ? [...enabledActors.filter((item) => item.name === target), ...enabledActors.filter((item) => item.name !== target)]
    : enabledActors;
  for (const actor of orderedActors.slice(0, 16)) {
    const privateFacts = actor.privateKnowledge.slice(0, 8).join('；');
    const agenda = actor.agenda.filter((item) => item.status === 'active').slice(0, 4).map((item) => item.title).join('；');
    lines.push([
      `## ${actor.name}${target && actor.name === target ? '（当前发言）' : ''}`,
      actor.role ? `身份：${actor.role}` : '',
      actor.location ? `位置：${actor.location}` : '',
      actor.status ? `状态：${actor.status}` : '',
      actor.goals.length ? `目标：${actor.goals.join('；')}` : '',
      actor.publicKnowledge.length ? `公开已知：${actor.publicKnowledge.slice(0, 8).join('；')}` : '',
      privateFacts ? `私有已知：${privateFacts}` : '',
      agenda ? `幕后议程：${agenda}` : ''
    ].filter(Boolean).join('\n'));
  }
  appendWorldSystemsPrompt(lines, simulation.systems);
  return lines.join('\n\n');
}

function buildActorSeeds({ characterCard, groupMembers, characterPresets } = {}) {
  const inputs = [];
  if (characterCard?.name) inputs.push(characterCard);
  if (Array.isArray(groupMembers)) inputs.push(...groupMembers);
  if (Array.isArray(characterPresets)) {
    for (const preset of characterPresets) inputs.push(preset.characterCard || preset);
  }
  const actors = normalizeActors(inputs.map((value) => ({
    id: value.id || slugify(value.name),
    name: value.name,
    role: value.role,
    enabled: value.enabled,
    location: value.location || value.extensions?.location,
    status: value.status || 'idle',
    goals: value.goals || value.extensions?.goals,
    publicKnowledge: value.publicKnowledge || value.extensions?.publicKnowledge,
    privateKnowledge: value.privateKnowledge || value.extensions?.privateKnowledge,
    relationships: value.relationships || value.extensions?.relationships,
    schedule: value.schedule || value.extensions?.schedule,
    agenda: value.agenda || value.extensions?.agenda,
    metadata: { source: value.id ? 'content-pack' : 'character-card' }
  })));
  const knownNames = new Set();
  return actors.filter((actor) => {
    const nameKey = actor.name.trim().toLocaleLowerCase('zh-CN');
    if (knownNames.has(nameKey)) return false;
    knownNames.add(nameKey);
    return true;
  });
}

function normalizeSimulation(input) {
  const source = input && typeof input === 'object' ? input : createSimulationState();
  return {
    spec: SIMULATION_SPEC,
    revision: normalizeInteger(source.revision, 0),
    clock: normalizeClock(source.clock),
    actors: normalizeActors(source.actors),
    systems: normalizeWorldSystems(source.systems),
    backstageEvents: normalizeBackstageEvents(source.backstageEvents),
    settings: {
      autoAdvanceMinutes: clampInteger(source.settings?.autoAdvanceMinutes, 0, 1440, 0),
      maxBackstageEvents: clampInteger(source.settings?.maxBackstageEvents, 50, 2000, 300),
      rosterInitialized: source.settings?.rosterInitialized === true
        || normalizeActors(source.actors).length > 0
        || normalizeInteger(source.revision, 0) > 0
    }
  };
}

function appendWorldSystemsPrompt(lines, systemsInput) {
  const systems = normalizeWorldSystems(systemsInput);
  appendSystemRecordPrompt(lines, '地点拓扑', systems.topology.nodes, 12);
  appendSystemRecordPrompt(lines, 'NPC 与日程规则', systems.population.profiles, 10);
  appendSystemRecordPrompt(lines, '势力演化', systems.factions.entities, 10);
  appendSystemRecordPrompt(lines, '历法与天候', systems.calendar.rules, 8);
  appendSystemRecordPrompt(lines, '经济规则', systems.economy.rules, 8);
  appendSystemRecordPrompt(lines, '修行与反噬', systems.cultivation.rules, 10);
  if (systems.economy.currencies.length) lines.push(`经济单位：${systems.economy.currencies.join('、')}`);
  if (systems.cultivation.scales.length) lines.push(`不可逆/状态刻度：${systems.cultivation.scales.join('、')}`);
}

function appendSystemRecordPrompt(lines, title, records, limit) {
  const visible = records.filter((record) => record.visibility !== 'director').slice(0, limit);
  const director = records.filter((record) => record.visibility === 'director').slice(0, Math.max(0, limit - visible.length));
  const selected = [...visible, ...director];
  if (!selected.length) return;
  lines.push([
    `## ${title}`,
    ...selected.map((record) => `- ${record.name}${record.summary ? `：${record.summary}` : ''}${record.visibility === 'director' ? '（私有）' : ''}`)
  ].join('\n'));
}

function projectWorldSystems(input, { director }) {
  const systems = normalizeWorldSystems(input);
  if (director) return systems;
  const publicRecords = (records) => records.filter((record) => record.visibility !== 'director');
  return {
    ...systems,
    topology: { ...systems.topology, nodes: publicRecords(systems.topology.nodes) },
    population: {
      ...systems.population,
      profiles: publicRecords(systems.population.profiles),
      scheduleRules: publicRecords(systems.population.scheduleRules)
    },
    factions: { ...systems.factions, entities: publicRecords(systems.factions.entities) },
    calendar: { ...systems.calendar, rules: publicRecords(systems.calendar.rules) },
    economy: {
      ...systems.economy,
      markets: publicRecords(systems.economy.markets),
      rules: publicRecords(systems.economy.rules)
    },
    cultivation: {
      ...systems.cultivation,
      paths: publicRecords(systems.cultivation.paths),
      backlash: publicRecords(systems.cultivation.backlash),
      rules: publicRecords(systems.cultivation.rules)
    }
  };
}

function hasWorldSystemContent(input) {
  const systems = normalizeWorldSystems(input);
  return systems.topology.nodes.length > 0
    || systems.population.profiles.length > 0
    || systems.factions.entities.length > 0
    || systems.calendar.rules.length > 0
    || systems.economy.rules.length > 0
    || systems.cultivation.rules.length > 0;
}

function normalizeSystemRecords(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const name = String(entry.name || entry.title || '').trim().slice(0, 120);
    if (!name) return null;
    return {
      id: String(entry.id || `system-${index + 1}`).slice(0, 160),
      name,
      summary: String(entry.summary || entry.description || '').trim().slice(0, 500),
      sourceEntryId: String(entry.sourceEntryId || '').slice(0, 160),
      constant: entry.constant === true,
      priority: clampInteger(entry.priority, -100000, 100000, 50),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizePopulationProfiles(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry, index) => {
    const [record] = normalizeSystemRecords([entry], 1);
    if (!record) return null;
    return {
      ...record,
      id: String(entry.id || `population-${index + 1}`).slice(0, 160),
      schedules: normalizeScheduleSlots(entry.schedules)
    };
  }).filter(Boolean);
}

function normalizeScheduleSlots(input) {
  return (Array.isArray(input) ? input : []).slice(0, 24).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const at = normalizeTime(entry.at || entry.time);
    if (!at) return null;
    return {
      at,
      activity: String(entry.activity || entry.status || '').trim().slice(0, 160)
    };
  }).filter(Boolean);
}

function normalizeSystemEdges(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const from = String(entry.from || '').slice(0, 160);
    const to = String(entry.to || '').slice(0, 160);
    if (!from || !to) return null;
    return {
      from,
      to,
      relation: String(entry.relation || entry.type || 'connected').slice(0, 80),
      cost: clampInteger(entry.cost, 0, 1000000, 1),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizeFactionRelations(input, limit) {
  return (Array.isArray(input) ? input : []).slice(0, limit).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const from = String(entry.from || '').slice(0, 160);
    const to = String(entry.to || '').slice(0, 160);
    if (!from || !to) return null;
    return {
      from,
      to,
      stance: clampInteger(entry.stance, -100, 100, 0),
      reason: String(entry.reason || '').slice(0, 300),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizeClock(input) {
  const day = clampInteger(input?.day, 1, 999999, 1);
  const minuteOfDay = clampInteger(input?.minuteOfDay ?? input?.minute, 0, 1439, 480);
  return { day, minuteOfDay, label: formatClock(day, minuteOfDay) };
}

function fromAbsoluteMinute(value) {
  const absolute = Math.max(0, normalizeInteger(value, 0));
  const day = Math.floor(absolute / 1440) + 1;
  const minuteOfDay = absolute % 1440;
  return { day, minuteOfDay, label: formatClock(day, minuteOfDay) };
}

function toAbsoluteMinute(clock) {
  return (Math.max(1, clock.day) - 1) * 1440 + clock.minuteOfDay;
}

function formatClock(day, minuteOfDay) {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const minutes = String(minuteOfDay % 60).padStart(2, '0');
  return `第${day}日 ${hours}:${minutes}`;
}

function scheduleOccurrences(schedule, startAbsolute, endAbsolute) {
  const occurrences = [];
  const minute = parseTime(schedule.at);
  if (minute === null) return occurrences;
  const startDay = Math.floor(startAbsolute / 1440) + 1;
  const endDay = Math.floor(endAbsolute / 1440) + 1;
  for (let day = startDay; day <= endDay; day += 1) {
    const weekday = ((day - 1) % 7) + 1;
    if (schedule.days.length && !schedule.days.includes(weekday)) continue;
    const absolute = (day - 1) * 1440 + minute;
    if (absolute > startAbsolute && absolute <= endAbsolute) occurrences.push(absolute);
  }
  return occurrences;
}

function normalizeSchedule(input) {
  return (Array.isArray(input) ? input : []).slice(0, 48).map((entry, index) => {
    if (!entry || typeof entry !== 'object') return null;
    const at = normalizeTime(entry.at || entry.time);
    if (!at) return null;
    return {
      id: normalizeActorId(entry.id || `schedule-${index + 1}`),
      at,
      days: (Array.isArray(entry.days) ? entry.days : []).map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
      location: String(entry.location || '').trim().slice(0, 160),
      activity: String(entry.activity || entry.status || '').trim().slice(0, 240),
      visibility: normalizeVisibility(entry.visibility)
    };
  }).filter(Boolean);
}

function normalizeAgenda(input) {
  return (Array.isArray(input) ? input : []).slice(0, 30).map((entry, index) => {
    if (typeof entry === 'string') {
      return { id: `agenda-${index + 1}`, title: entry.slice(0, 240), priority: 50, status: 'active', visibility: 'private' };
    }
    if (!entry || typeof entry !== 'object') return null;
    const title = String(entry.title || entry.goal || '').trim().slice(0, 240);
    if (!title) return null;
    return {
      id: normalizeActorId(entry.id || `agenda-${index + 1}`),
      title,
      priority: clampInteger(entry.priority, 0, 100, 50),
      status: ['active', 'blocked', 'completed', 'failed'].includes(entry.status) ? entry.status : 'active',
      visibility: normalizeVisibility(entry.visibility || 'private')
    };
  }).filter(Boolean);
}

function normalizeRelationships(input) {
  return (Array.isArray(input) ? input : []).slice(0, 50).map((entry) => {
    if (!entry || typeof entry !== 'object') return null;
    const targetId = normalizeActorId(entry.targetId || entry.target);
    if (!targetId) return null;
    return {
      targetId,
      trust: clampInteger(entry.trust, -100, 100, 0),
      tension: clampInteger(entry.tension, -100, 100, 0),
      lastReason: String(entry.lastReason || entry.reason || '').trim().slice(0, 300)
    };
  }).filter(Boolean);
}

function normalizeBackstageEvents(input) {
  return (Array.isArray(input) ? input : []).slice(-2000).filter((entry) => entry && typeof entry === 'object').map((entry) => ({
    id: String(entry.id || `backstage-${crypto.randomUUID()}`),
    timestamp: String(entry.timestamp || new Date().toISOString()),
    absoluteMinute: normalizeInteger(entry.absoluteMinute, 0),
    actorId: String(entry.actorId || ''),
    actorName: String(entry.actorName || ''),
    visibility: normalizeVisibility(entry.visibility),
    summary: String(entry.summary || '').slice(0, 500),
    reason: String(entry.reason || '').slice(0, 240)
  }));
}

function normalizeMetadata(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input).slice(0, 20).map(([key, value]) => [String(key).slice(0, 64), String(value).slice(0, 240)]));
}

function uniqueStrings(input, maxItems, maxLength) {
  return [...new Set((Array.isArray(input) ? input : []).map((item) => String(item || '').trim().slice(0, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeActorId(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.:\-\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function slugify(value) {
  return normalizeActorId(value) || `npc-${crypto.randomUUID()}`;
}

function normalizeTime(value) {
  const minute = parseTime(value);
  if (minute === null) return '';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function parseTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function normalizeVisibility(value) {
  const visibility = String(value || 'public').trim().toLowerCase();
  return ['public', 'private', 'director'].includes(visibility) ? visibility : 'public';
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}
