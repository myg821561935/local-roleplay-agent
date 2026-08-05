import { writeJson } from '../lib/http.js';
import { ApiError, readRequestJson, validateMutatingRequest } from './http.js';

const MIGRATION_PATH = '/api/session-config-migrations/incomplete';

export async function handleSessionConfigMigrationRoutes({
  req,
  res,
  url,
  sessionConfigMigrationService
}) {
  if (url.pathname === MIGRATION_PATH && req.method === 'GET') {
    writeJson(res, 200, { plan: await sessionConfigMigrationService.inspect() });
    return true;
  }

  if (url.pathname === `${MIGRATION_PATH}/migrate` && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      const result = await sessionConfigMigrationService.migrate({
        expectedPlanId: String(body.expectedPlanId || ''),
        confirmMigration: body.confirmMigration === true
      });
      writeJson(res, 200, result);
    } catch (error) {
      if (error.code === 'SESSION_CONFIG_MIGRATION_CONFIRMATION_REQUIRED'
        || error.code === 'SESSION_CONFIG_MIGRATION_PLAN_CHANGED') {
        throw new ApiError(409, error.code);
      }
      throw error;
    }
    return true;
  }

  return false;
}
