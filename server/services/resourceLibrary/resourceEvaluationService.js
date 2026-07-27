import {
  aggregateResourceEvaluations,
  detectExecutionRisks,
  evaluateResourceCandidate,
  estimateResourceTokens
} from '../../resources/resourceEvaluator.js';

export class ResourceEvaluationService {
  evaluate(candidate, options = {}) {
    return evaluateResourceCandidate(candidate, options);
  }

  aggregate(diagnostics = []) {
    return aggregateResourceEvaluations(diagnostics);
  }

  detectExecutionRisks(value) {
    return detectExecutionRisks(value);
  }

  estimateTokens(value) {
    return estimateResourceTokens(value);
  }
}
