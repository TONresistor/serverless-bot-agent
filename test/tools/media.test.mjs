import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from '../helpers.mjs';
import { createSaveMediaTool } from '../../src/tools/media/save.js';
import {
  createMediaService,
  createMetadataService,
  normalizeMediaName,
} from '../../src/application/media.js';
import { createTelegramMedia } from '../../src/adapters/telegram/media.js';
import { createPinata } from '../../src/adapters/ipfs.js';
import { createWorkspaceRepository } from '../../src/adapters/sqlite/workspace.js';
import { MEDIA_MAX_BYTES } from '../../src/domain/workspace.js';

const photo = Uint8Array.from([0xff, 0xd8, 0xff, 0, 1, 254, 255]);
const imageCid = 'Qm' + 'a'.repeat(44),
  metadataCid = 'Qm' + 'b'.repeat(44);

test('save_media preserves reference names and saves binary content without returning it to the model', async () => {
  const f = await fixture(),
    workspace = f.repositories.workspace.port();
  const downloaded = [];
  const media = createMediaService({
    workspace,
    download: async (id) => {
      downloaded.push(id);
      return photo;
    },
  });
  const tool = createSaveMediaTool(media);
  for (const [name, path] of [
    ['duck.png', 'media/duck.png'],
    ['../../etc/passwd', 'media/passwd.jpg'],
    ['sub\\duck', 'media/duck.jpg'],
  ]) {
    assert.deepEqual(
      await tool.prepare(JSON.stringify({ file_id: ' PHOTO ', name }))({ operationId: name }),
      { saved: true, path, bytes: photo.length },
    );
  }
  assert.deepEqual(downloaded, ['PHOTO', 'PHOTO', 'PHOTO']);
  assert.deepEqual(await workspace.list(), {
    files: ['media/duck.jpg', 'media/duck.png', 'media/passwd.jpg'],
  });
  assert.deepEqual(await workspace.readMedia('media/duck.png'), photo);
  await assert.rejects(
    workspace.read('media/duck.png'),
    (error) => error.code === 'workspace_binary_file',
  );
  assert.equal(tool.effect, 'state_write');
  assert.equal(tool.metadata.exposure, 'search');
  assert.throws(() => tool.prepare('{"file_id":" ","name":"x"}'), /file_id/);
  for (const name of ['', '.', '..', '/', '\\'])
    assert.throws(() => normalizeMediaName(name), /filename/);
  await assert.rejects(
    createMediaService({
      workspace,
      download: async () => {
        throw new Error('download failed');
      },
    }).save('PHOTO', 'missing.png', {}),
    /download failed/,
  );
  assert.ok(!(await workspace.list()).files.includes('media/missing.png'));
});

test('native Telegram readers enforce the media size and reject textual or failed downloads', async () => {
  let requested;
  const direct = createTelegramMedia({
    getFileContent: async (id) => {
      requested = id;
      return photo;
    },
  });
  assert.deepEqual(await direct.download(' FILE '), photo);
  assert.equal(requested, 'FILE');
  let closed = false;
  const streamed = createTelegramMedia({
    getFileContent: null,
    getFileStream: async () =>
      (async function* () {
        try {
          yield new Uint8Array(MEDIA_MAX_BYTES);
          yield new Uint8Array(1);
          assert.fail('Read beyond the size limit.');
        } finally {
          closed = true;
        }
      })(),
  });
  await assert.rejects(streamed.download('FILE'), /5 MiB/);
  assert.equal(closed, true);
  assert.equal(
    (
      await createTelegramMedia({
        getFileContent: async () => new Uint8Array(MEDIA_MAX_BYTES),
      }).download('FILE')
    ).length,
    MEDIA_MAX_BYTES,
  );
  await assert.rejects(
    createTelegramMedia({
      getFileContent: async () => new Uint8Array(MEDIA_MAX_BYTES + 1),
    }).download('FILE'),
    /5 MiB/,
  );
  await assert.rejects(
    createTelegramMedia({ getFileContent: async () => 'not bytes' }).download('FILE'),
    /binary/,
  );
  await assert.rejects(
    createTelegramMedia({
      getFileContent: async () => {
        throw new Error('private provider detail');
      },
    }).download('FILE'),
    (error) => error.code === 'media_download' && !error.message.includes('private'),
  );
});

test('workspace media survives recreation, rejects expired writers and clears old content on type changes', async () => {
  const f = await fixture(),
    workspace = f.repositories.workspace.port();
  await workspace.write('media/logo.png', 'prior text');
  await workspace.writeMedia('media/logo.png', photo, 1);
  const row = await f.db.get(
    'SELECT content,content_kind,byte_count,revision FROM agent_workspace WHERE id=:id',
    { ':id': 'agent:media/logo.png' },
  );
  assert.deepEqual(row, {
    content: '',
    content_kind: 'binary',
    byte_count: photo.length,
    revision: 2,
  });
  assert.deepEqual(
    await createWorkspaceRepository(f.db, f.now).port().readMedia('media/logo.png'),
    photo,
  );
  const stale = f.repositories.workspace.port('agent', async () => {}, {
    chatId: '42',
    token: 'expired',
  });
  await assert.rejects(stale.writeMedia('media/logo.png', Uint8Array.of(99)), /changed/);
  assert.deepEqual(await workspace.readMedia('media/logo.png'), photo);
  await assert.rejects(
    workspace.writeMedia('media/logo.png', new Uint8Array(MEDIA_MAX_BYTES + 1)),
    /5 MiB/,
  );
  await assert.rejects(workspace.writeMedia('../logo.png', photo), /path/);
  await workspace.write('media/logo.png', 'replacement', 2);
  assert.equal((await workspace.read('media/logo.png')).content, 'replacement');
  assert.equal(
    (
      await f.db.get('SELECT content_bytes FROM agent_workspace WHERE id=:id', {
        ':id': 'agent:media/logo.png',
      })
    ).content_bytes,
    null,
  );
  await workspace.writeMedia('media/empty.jpg', new Uint8Array(0));
  assert.equal((await workspace.readMedia('media/empty.jpg')).length, 0);
});

test('5 MiB binary media round-trips every byte value through bounded SQL chunks', async () => {
  const f = await fixture(),
    bytes = new Uint8Array(MEDIA_MAX_BYTES);
  let appends = 0,
    reads = 0;
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  const bounded = {
    ...f.db,
    async run(query, params = {}) {
      for (const value of Object.values(params))
        if (value instanceof Uint8Array)
          assert.ok(
            value.byteLength <= 65536,
            'A SQL parameter exceeded the serialization budget.',
          );
      if (query.includes('content_bytes || :chunk')) appends++;
      return f.db.run(query, params);
    },
    async get(query, params) {
      const row = await f.db.get(query, params);
      for (const value of Object.values(row || {}))
        if (value instanceof Uint8Array)
          assert.ok(value.byteLength <= 65536, 'A SQL result exceeded the serialization budget.');
      if (query.includes('substr(content_bytes')) reads++;
      return row;
    },
  };
  const workspace = createWorkspaceRepository(bounded, f.now).port();
  assert.deepEqual(await workspace.writeMedia('media/full.bin', bytes, 0), {
    path: 'media/full.bin',
    bytes: MEDIA_MAX_BYTES,
  });
  assert.deepEqual(await workspace.readMedia('media/full.bin'), bytes);
  assert.equal(appends, 80);
  assert.equal(reads, 80);
  assert.deepEqual(await workspace.list(), { files: ['media/full.bin'] });
  assert.equal(
    (
      await f.db.get(
        "SELECT count(*) AS count FROM agent_workspace WHERE content_kind='binary_staging'",
      )
    ).count,
    0,
  );
});

test('interrupted staging keeps the old file visible and removes only its private staging row', async () => {
  const f = await fixture(),
    original = f.repositories.workspace.port();
  let appends = 0;
  await original.writeMedia('media/logo.png', photo);
  const interrupted = createWorkspaceRepository(
    {
      ...f.db,
      async run(query, params) {
        if (query.includes('content_bytes || :chunk')) {
          assert.deepEqual(await original.readMedia('media/logo.png'), photo);
          if (++appends === 2) throw new Error('interrupted upload');
        }
        return f.db.run(query, params);
      },
    },
    f.now,
  ).port();
  await assert.rejects(
    interrupted.writeMedia('media/logo.png', new Uint8Array(140000)),
    /interrupted upload/,
  );
  assert.deepEqual(await original.readMedia('media/logo.png'), photo);
  assert.equal(
    (
      await f.db.get(
        "SELECT count(*) AS count FROM agent_workspace WHERE content_kind='binary_staging'",
      )
    ).count,
    0,
  );
});

test('staged publish still requires the live lease and original target revision', async () => {
  const f = await fixture(),
    original = f.repositories.workspace.port();
  await original.writeMedia('media/logo.png', photo);
  await f.repositories.conversations.acquireChat('42', 'media-writer');
  const expired = createWorkspaceRepository(
    {
      ...f.db,
      async run(query, params) {
        if (
          (query.startsWith('INSERT INTO agent_workspace') &&
            query.includes('FROM agent_workspace')) ||
          query.includes('content_bytes=(SELECT')
        )
          await f.repositories.conversations.releaseChat('42', 'media-writer');
        return f.db.run(query, params);
      },
    },
    f.now,
  ).port('agent', async () => {}, { chatId: '42', token: 'media-writer' });
  await assert.rejects(expired.writeMedia('media/logo.png', new Uint8Array(140000), 1), /changed/);
  assert.deepEqual(await original.readMedia('media/logo.png'), photo);
  await assert.rejects(original.writeMedia('media/logo.png', new Uint8Array(140000), 0), /changed/);
  assert.deepEqual(await original.readMedia('media/logo.png'), photo);
  await original.writeMedia('media/logo.png', new Uint8Array(140000), 1);
  assert.equal((await original.readMedia('media/logo.png')).length, 140000);
  assert.equal(
    (
      await f.db.get(
        "SELECT count(*) AS count FROM agent_workspace WHERE content_kind='binary_staging'",
      )
    ).count,
    0,
  );
});

test('multi-chunk media reads fail if the pinned revision changes during the read', async () => {
  const f = await fixture(),
    original = f.repositories.workspace.port();
  let chunks = 0;
  await original.writeMedia('media/logo.png', new Uint8Array(140000));
  const reader = createWorkspaceRepository(
    {
      ...f.db,
      async get(query, params) {
        const row = await f.db.get(query, params);
        if (query.includes('substr(content_bytes') && ++chunks === 1)
          await original.writeMedia('media/logo.png', new Uint8Array(140000).fill(255));
        return row;
      },
    },
    f.now,
  ).port();
  await assert.rejects(reader.readMedia('media/logo.png'), /changed/);
  assert.equal(chunks, 2);
});

test('metadata hosting preserves reference precedence and JSON and reuses acknowledged pins', async () => {
  const f = await fixture(),
    workspace = f.repositories.workspace.port(),
    uploads = [];
  await workspace.writeMedia('media/duck.png', photo);
  const pinata = {
    configured: true,
    pinFile: async (name, bytes) => {
      uploads.push({ name, bytes: [...bytes] });
      return imageCid;
    },
    pinJSON: async (name, json) => {
      uploads.push({ name, json });
      return metadataCid;
    },
  };
  const service = createMetadataService({
    pinata,
    workspace,
    journal: f.repositories.operations,
    download: async () => {
      assert.fail('Saved image takes precedence.');
    },
  });
  const input = {
    name: ' Duck Coin ',
    symbol: ' DUCK ',
    description: ' Quack ',
    image: 'media/duck.png',
    imageFileId: 'ignored',
  };
  const result = { metadataUri: `ipfs://${metadataCid}`, imageCid, metadataCid };
  assert.deepEqual(await service.prepare(input, 'deploy:1'), result);
  assert.deepEqual(await service.prepare(input, 'deploy:1'), result);
  assert.deepEqual(uploads, [
    { name: 'duck.png', bytes: [...photo] },
    {
      name: 'metadata.json',
      json: {
        name: 'Duck Coin',
        symbol: 'DUCK',
        description: 'Quack',
        image: `ipfs://${imageCid}`,
        decimals: '9',
      },
    },
  ]);
  await workspace.writeMedia('media/duck.png', Uint8Array.of(7));
  await assert.rejects(
    service.prepare(input, 'deploy:1'),
    (error) => error.code === 'operation_mismatch',
  );
  assert.equal(uploads.length, 2);
  const unconfigured = createMetadataService({
    pinata: null,
    workspace: null,
    journal: null,
    download: null,
  });
  assert.deepEqual(await unconfigured.prepare({ metadataUri: ' ipfs://ready ' }, 'direct'), {
    metadataUri: 'ipfs://ready',
  });
  await assert.rejects(
    unconfigured.prepare({ name: 'X', symbol: 'X' }, 'no-key'),
    (error) => error.code === 'ipfs_not_configured' && error.effectNotStarted,
  );
});

test('metadata hosting never retries an uncertain upload and never stores image bytes in receipts', async () => {
  const f = await fixture();
  let logos = 0,
    metadata = 0;
  const service = createMetadataService({
    workspace: null,
    journal: f.repositories.operations,
    download: async () => photo,
    pinata: {
      configured: true,
      pinFile: async (filename) => {
        assert.equal(filename, 'logo.jpg');
        logos++;
        return imageCid;
      },
      pinJSON: async () => {
        metadata++;
        throw new Error('socket closed');
      },
    },
  });
  const input = { name: 'Duck', symbol: 'DUCK', imageFileId: 'attached-photo' };
  await assert.rejects(service.prepare(input, 'deploy:2'), /socket closed/);
  await assert.rejects(
    service.prepare(input, 'deploy:2'),
    (error) => error.code === 'ipfs_operation_unknown',
  );
  assert.equal(logos, 1);
  assert.equal(metadata, 1);
  const receipts = await f.db.all("SELECT state,data_json FROM agent_operations WHERE kind='ipfs'");
  assert.deepEqual(receipts.map((r) => r.state).sort(), ['succeeded', 'unknown']);
  for (const row of receipts)
    assert.ok(
      Object.keys(JSON.parse(row.data_json)).every((k) => ['signature', 'cid'].includes(k)),
    );
});

test('Pinata uses SDK multipart factories and limits provider responses without disclosing credentials', async () => {
  const requests = [],
    fields = [];
  const provider = createPinata({
    jwt: 'private-test-token',
    makeFormData: () => ({ append: (...args) => fields.push(args) }),
    makeFile: (bytes, name) => ({ bytes, name }),
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, text: async () => JSON.stringify({ IpfsHash: imageCid }) };
    },
  });
  assert.equal(await provider.pinFile('logo.jpg', photo), imageCid);
  assert.equal(requests[0].url, 'https://api.pinata.cloud/pinning/pinFileToIPFS');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-test-token');
  assert.equal(requests[0].options.headers['Content-Type'], undefined);
  assert.deepEqual(fields[0], ['file', { bytes: photo, name: 'logo.jpg' }]);
  await provider.pinJSON('metadata.json', { name: 'Duck' });
  assert.equal(Buffer.from(fields[1][1].bytes).toString(), '{"name":"Duck"}');
  const rejected = createPinata({
    jwt: 'private-test-token',
    makeFormData: () => ({ append() {} }),
    makeFile: () => ({}),
    fetcher: async () => ({ ok: false, status: 403, text: async () => 'private-test-token' }),
  });
  await assert.rejects(
    rejected.pinFile('logo.jpg', photo),
    (error) => error.code === 'http_403' && !error.message.includes('private-test-token'),
  );
  await assert.rejects(
    createPinata({ fetcher: null, makeFormData: null, makeFile: null }).pinFile('logo.jpg', photo),
    (error) => error.code === 'ipfs_not_configured',
  );
});
