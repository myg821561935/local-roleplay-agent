import { writeJson } from '../lib/http.js';
import {
  sanitizeProviderTestError,
  testProviderConnection
} from '../services/providerTestService.js';
import {
  ApiError,
  readRequestJson,
  validateMutatingRequest
} from './http.js';

export async function handleProviderRoutes({
  req,
  res,
  url,
  configService,
  providerClient,
  fetchImpl,
  resolveProviderSecrets,
  isPlainObject
}) {
  if (req.method === 'PUT' && url.pathname === '/api/providers') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const providers = await resolveProviderSecrets({ configService, incoming: body });
    await configService.saveProviders(providers);
    writeJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/providers/test') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    if (!isPlainObject(body.provider)) throw new ApiError(400, 'PROVIDER_TEST_INVALID_CONFIG');
    const resolved = await resolveProviderSecrets({
      configService,
      incoming: { activeProviderId: body.provider.id || '', providers: [body.provider] }
    });
    const provider = resolved.providers?.[0];
    try {
      const result = await testProviderConnection({ provider, providerClient, fetchImpl });
      writeJson(res, 200, { result });
    } catch (error) {
      const detail = sanitizeProviderTestError(error, provider);
      const statusCode = error.message === 'PROVIDER_TEST_TIMEOUT' ? 504 : 502;
      throw new ApiError(statusCode, 'PROVIDER_TEST_FAILED', detail);
    }
    return true;
  }

  return false;
}
