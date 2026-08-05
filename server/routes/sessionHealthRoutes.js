import { writeJson } from '../lib/http.js';
import { ApiError } from './http.js';

export async function handleSessionHealthRoutes({
  req,
  res,
  sessionId,
  subPath,
  sessionHealthService
}) {
  if (subPath !== 'health' || req.method !== 'GET') return false;
  try {
    writeJson(res, 200, { health: await sessionHealthService.inspect(sessionId) });
    return true;
  } catch (error) {
    if (error.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw error;
  }
}
