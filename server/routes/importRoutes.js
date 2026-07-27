import { exportCharacterCardPng } from '../character/characterCardExport.js';
import { importCharacterCardFromPayload } from '../character/characterCardImport.js';
import { writeJson } from '../lib/http.js';
import { listImportSources } from '../services/importSourceService.js';
import { readRequestJson, validateMutatingRequest } from './http.js';

export async function handleImportRoutes({
  req,
  res,
  url,
  assetService,
  configService,
  sessionService,
  resourceLibraryService,
  importSourceService,
  operations
}) {
  const {
    commitImport,
    previewImport,
    saveImportedCharacterPortrait
  } = operations;

  if (req.method === 'GET' && url.pathname === '/api/import-sources') {
    writeJson(res, 200, { sources: listImportSources() });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/import-sources/search') {
    const result = await importSourceService.search({
      source: url.searchParams.get('source') || 'chub',
      query: url.searchParams.get('q') || url.searchParams.get('query') || '',
      kind: url.searchParams.get('kind') || 'characters',
      limit: url.searchParams.get('limit') || undefined
    });
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/import/preview') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const preview = previewImport(body.payload ?? body);
    preview.inspection = await resourceLibraryService.inspectPreview(preview, body.source || {});
    writeJson(res, 200, { preview });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/import/commit') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await commitImport({
      assetService,
      configService,
      sessionService,
      resourceLibraryService,
      body
    });
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/import-sources/download') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const result = await importSourceService.download(body);
    writeJson(res, 200, result);
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/character-card/import') {
    validateMutatingRequest(req);
    const body = await readRequestJson(req);
    const imported = importCharacterCardFromPayload(body);
    const portrait = await saveImportedCharacterPortrait(assetService, body);
    if (portrait) imported.characterCard.portrait = portrait;
    const characterCard = await assetService.saveCharacter(imported.characterCard);
    let worldBook = [];
    if (imported.worldBook?.length) {
      const wbAsset = await assetService.saveWorldBook(
        null,
        `${characterCard.name}的设定集`,
        imported.worldBook
      );
      worldBook = wbAsset.entries;
    }
    writeJson(res, 200, { characterCard, worldBook });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/character-card/export') {
    const config = await configService.getAll();
    const characterCard = config.characterCard;
    const worldBook = config.worldBook;
    const basePortrait = await assetService.readCharacterPortrait(characterCard?.portrait?.assetId);
    const png = exportCharacterCardPng(characterCard, worldBook, basePortrait);
    const filename = `${encodeURIComponent(characterCard?.name || 'character')}.png`;
    res.writeHead(200, {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': png.length
    });
    res.end(png);
    return true;
  }

  return false;
}
