import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportUploadService } from '../server/services/importUploadService.js';

test('staged binary imports preserve bytes and expose only bounded metadata', () => {
  const service = new ImportUploadService({ now: () => 1_000, ttlMs: 5_000 });
  const bytes = Buffer.from([0, 1, 2, 255]);

  const staged = service.stage({
    fileName: '九渊.png',
    mimeType: 'image/png',
    bytes,
    source: { site: 'local-file' }
  });
  const loaded = service.get(staged.uploadId);

  assert.equal(staged.size, bytes.length);
  assert.equal(staged.fileName, '九渊.png');
  assert.deepEqual(loaded.payload.data, bytes);
  assert.notEqual(loaded.payload.data, bytes);
  assert.deepEqual(loaded.source, { site: 'local-file' });
});

test('staged binary imports enforce size and expiration limits', () => {
  let now = 1_000;
  const service = new ImportUploadService({
    now: () => now,
    maxUploadBytes: 3,
    ttlMs: 10
  });

  assert.throws(
    () => service.stage({ bytes: Buffer.alloc(4) }),
    (error) => error.code === 'IMPORT_SOURCE_FILE_TOO_LARGE'
  );

  const staged = service.stage({ bytes: Buffer.from([1, 2, 3]) });
  now = 1_011;
  assert.equal(service.get(staged.uploadId), null);
});
