import { writeJson } from '../lib/http.js';
import { ApiError, readRequestJson, validateMutatingRequest } from './http.js';

const REPAIR_PATH = '/api/reference-repairs/orphans';

export async function handleReferenceRepairRoutes({
  req,
  res,
  url,
  referenceRepairService
}) {
  if (url.pathname === REPAIR_PATH && req.method === 'GET') {
    writeJson(res, 200, { plan: await referenceRepairService.inspect() });
    return true;
  }

  if (url.pathname === `${REPAIR_PATH}/repair` && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    try {
      const result = await referenceRepairService.repair({
        expectedPlanId: String(body.expectedPlanId || ''),
        confirmRepair: body.confirmRepair === true
      });
      writeJson(res, 200, result);
    } catch (error) {
      if (error.code === 'REFERENCE_REPAIR_CONFIRMATION_REQUIRED'
        || error.code === 'REFERENCE_REPAIR_PLAN_CHANGED') {
        throw new ApiError(409, error.code);
      }
      throw error;
    }
    return true;
  }

  return false;
}
