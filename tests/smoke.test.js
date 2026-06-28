import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

test('createApp returns a request handler', () => {
  const app = createApp({ rootDir: process.cwd() });
  assert.equal(typeof app, 'function');
});
