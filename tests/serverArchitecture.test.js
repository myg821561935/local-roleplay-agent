import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('server entry delegates bounded API areas to route modules', async () => {
  const app = await readFile('server/app.js', 'utf8');
  const routeModules = [
    'chatRoutes',
    'importRoutes',
    'mcpRoutes',
    'providerRoutes',
    'resourceLibraryRoutes',
    'storyProjectRoutes'
  ];

  for (const moduleName of routeModules) {
    assert.match(app, new RegExp(`from './routes/${moduleName}\\.js'`));
  }

  assert.match(app, /handleImportRoutes\(\{/);
  assert.match(app, /handleStoryProjectRoutes\(\{/);
  assert.doesNotMatch(app, /url\.pathname === '\/api\/import\/preview'/);
  assert.doesNotMatch(app, /url\.pathname === '\/api\/story-projects'/);
  assert.ok(app.split('\n').length < 2200, 'server/app.js should remain an orchestration entry');
});

test('route modules own their endpoint families', async () => {
  const [imports, stories, resources] = await Promise.all([
    readFile('server/routes/importRoutes.js', 'utf8'),
    readFile('server/routes/storyProjectRoutes.js', 'utf8'),
    readFile('server/routes/resourceLibraryRoutes.js', 'utf8')
  ]);

  assert.match(imports, /\/api\/import\/preview/);
  assert.match(imports, /\/api\/character-card\/import/);
  assert.match(stories, /\/api\/story-projects/);
  assert.match(resources, /\/api\/resource-library\/resources/);
});
