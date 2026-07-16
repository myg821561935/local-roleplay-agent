import crypto from 'node:crypto';

export const SIMULATION_SPEC = 'lra.simulation/v1';

export function createSimulationState({ actors = [], clock } = {}) {
  const normalizedActors = normalizeActors(actors);
  return {
    spec: SIMULATION_SPEC,
    revision: 0,
    clock: normalizeClock(clock),
    actors: normalizedActors,
    backstageEvents: [],
    settings: {
      autoAdvanceMinutes: 0,
      maxBackstageEvents: 300,
      rosterInitialized: normalizedActors.length > 0
    }
  };
}

export function ensureSimulationMemory(memory, { characterCard, groupMembers, characterPresets } = {}) {
  const next = structuredClone(memory && typeof memory === 'object' ? memory : {});
  const existing = next.simulation && typeof next.simulation === 'object'
    ? next.simulation
    : createSimulationState();
  const seedActors = buildActorSeeds({ characterCard, groupMembers, characterPresets });
  const actors = normalizeActors(existing.actors);
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
    backstageEvents: simulation.backstageEvents.filter((event) => director || event.visibility === 'public')
  };
}

export function renderSimulationPrompt(memory, { targetSpeaker } = {}) {
  const simulation = normalizeSimulation(memory?.simulation);
  if (!simulation.actors.length) return '';
  const lines = [
    '# 世界时钟与 NPC 状态',
    `时间：${simulation.clock.label}（修订 ${simulation.revision}）`,
    '以下“私有”内容只用于保持角色动机与信息边界，不得直接向用户泄露；只能通过可观察行为、调查或角色主动透露进入正文。'
  ];
  const target = String(targetSpeaker || '').trim();
  for (const actor of simulation.actors.filter((item) => item.enabled).slice(0, 16)) {
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
