import {
  DECLARATIVE_LIFECYCLE_BUDGETS,
  DECLARATIVE_LIFECYCLE_EVENTS,
  isAllowedLifecyclePath,
  normalizeDeclarativeLifecycle
} from './lifecyclePolicy.js';
import {
  MVU_PATCH_SPEC,
  applyMvuPatchEnvelope,
  normalizeMvuPatchEnvelope
} from './mvuProtocol.js';

export class DeclarativeLifecycleError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.name = 'DeclarativeLifecycleError';
    this.code = code;
    this.detail = detail;
  }
}

export function executeDeclarativeLifecycle({
  runtime = {},
  event,
  currentState = {},
  executions = 1
} = {}) {
  if (!DECLARATIVE_LIFECYCLE_EVENTS.includes(event)) {
    throw new DeclarativeLifecycleError('LIFECYCLE_EVENT_UNSUPPORTED', String(event || ''));
  }
  if (!Number.isInteger(executions) || executions < 1
    || executions > DECLARATIVE_LIFECYCLE_BUDGETS.maxExecutionsPerEvent) {
    throw new DeclarativeLifecycleError('LIFECYCLE_EXECUTION_BUDGET_EXCEEDED');
  }

  const normalizationDiagnostics = [];
  const lifecycle = normalizeDeclarativeLifecycle(runtime.lifecycle || {}, normalizationDiagnostics);
  const operations = lifecycle.events[event] || [];
  if (!operations.length) {
    if (normalizationDiagnostics.length) {
      return rollbackResult(currentState, event, normalizationDiagnostics[0]?.code);
    }
    return {
      state: structuredClone(currentState),
      envelopes: [],
      report: { event, status: 'skipped', executions: 0, changes: 0 }
    };
  }
  if (normalizationDiagnostics.length) {
    return rollbackResult(currentState, event, normalizationDiagnostics[0]?.code);
  }

  const totalChanges = operations.length * executions;
  if (totalChanges > DECLARATIVE_LIFECYCLE_BUDGETS.maxChangesPerTurn) {
    throw new DeclarativeLifecycleError('LIFECYCLE_CHANGE_BUDGET_EXCEEDED', String(totalChanges));
  }

  const original = structuredClone(currentState);
  let next = structuredClone(currentState);
  const envelopes = [];

  try {
    for (let index = 0; index < executions; index += 1) {
      for (const operation of operations) {
        if (!DECLARATIVE_LIFECYCLE_BUDGETS.allowedPatchOperations.includes(operation.op)) {
          throw new DeclarativeLifecycleError('LIFECYCLE_OPERATION_BLOCKED', operation.op);
        }
        if (!isAllowedLifecyclePath(operation.path, next.values)) {
          throw new DeclarativeLifecycleError('LIFECYCLE_STATE_PATH_BLOCKED', operation.path);
        }
      }
      const envelope = normalizeMvuPatchEnvelope({
        spec: MVU_PATCH_SPEC,
        expectedRevision: Number(next.revision || 0),
        summary: `${event} 声明式状态更新`,
        operations
      });
      const applied = applyMvuPatchEnvelope(next, envelope);
      next = applied.state;
      envelopes.push(applied.envelope);
    }
  } catch (error) {
    return {
      state: original,
      envelopes: [],
      report: {
        event,
        status: 'rolled-back',
        executions: 0,
        changes: 0,
        error: {
          code: String(error?.code || error?.message || 'LIFECYCLE_EXECUTION_FAILED'),
          detail: String(error?.detail || '')
        }
      }
    };
  }

  return {
    state: next,
    envelopes,
    report: {
      event,
      status: 'applied',
      executions,
      changes: totalChanges
    }
  };
}

function rollbackResult(currentState, event, code) {
  return {
    state: structuredClone(currentState),
    envelopes: [],
    report: {
      event,
      status: 'rolled-back',
      executions: 0,
      changes: 0,
      error: {
        code: String(code || 'LIFECYCLE_NORMALIZATION_FAILED'),
        detail: ''
      }
    }
  };
}
