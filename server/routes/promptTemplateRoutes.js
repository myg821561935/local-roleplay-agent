import { buildEditableSessionConfig } from '../config/sessionScopedConfig.js';
import { writeJson } from '../lib/http.js';
import {
  listPromptTemplates,
  previewPromptTemplate
} from '../promptTemplates/promptTemplateCatalog.js';
import { ApiError, readRequestJson, validateMutatingRequest } from './http.js';

const TEMPLATE_PATH = '/api/prompt-templates';

export async function handlePromptTemplateRoutes({
  req,
  res,
  url,
  configService,
  sessionService
}) {
  if (url.pathname === TEMPLATE_PATH && req.method === 'GET') {
    const session = await getSession(sessionService, url.searchParams.get('sessionId') || 'main');
    const config = buildEditableSessionConfig(await configService.getAll(), session);
    writeJson(res, 200, listPromptTemplates(config, session));
    return true;
  }

  if (url.pathname === `${TEMPLATE_PATH}/preview` && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const session = await getSession(sessionService, body.sessionId || 'main');
    const config = buildEditableSessionConfig(await configService.getAll(), session);
    writeJson(res, 200, createPreview(body, config, session));
    return true;
  }

  if (url.pathname === `${TEMPLATE_PATH}/apply` && req.method === 'POST') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const session = await getSession(sessionService, body.sessionId || 'main');
    const config = buildEditableSessionConfig(await configService.getAll(), session);
    const preview = createPreview(body, config, session);
    session.config = config;
    session.config.promptModules = preview.promptModules;
    session.updatedAt = new Date().toISOString();
    await sessionService.saveSession(session);
    writeJson(res, 200, {
      promptModules: preview.promptModules,
      preview,
      templates: listPromptTemplates(session.config, session).templates
    });
    return true;
  }

  return false;
}

function createPreview(body, config, session) {
  try {
    return previewPromptTemplate({
      templateId: body.templateId,
      parameters: body.parameters,
      mode: body.mode,
      config,
      session
    });
  } catch (error) {
    if (error.code === 'PROMPT_TEMPLATE_NOT_FOUND') {
      throw new ApiError(404, error.code);
    }
    throw error;
  }
}

async function getSession(sessionService, sessionId) {
  try {
    return await sessionService.getSession(sessionId);
  } catch (error) {
    if (error.message === 'Invalid session id') throw new ApiError(400, 'INVALID_SESSION_ID');
    throw error;
  }
}
