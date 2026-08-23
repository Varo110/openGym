import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';

const API_DIR = fileURLToPath(new URL('.', import.meta.url));

async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => {
    probe.close(error => error ? reject(error) : resolve());
  });
  return port;
}

function sessionCookie(uid, secret, version = 0) {
  const payload = `${uid}:${Date.now() + 60 * 60 * 1000}:${version}`;
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}

async function waitForServer(child, base) {
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode != null) throw new Error(`API exited before ready: ${stderr}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`API did not become ready: ${stderr}`);
}

async function jsonResponse(base, pathname, options = {}) {
  const response = await fetch(base + pathname, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function assertPublicProgramme(programme, { root, ownerId, otherId }) {
  assert.deepEqual(Object.keys(programme).sort(), [
    'download', 'filename', 'id', 'mime', 'modified', 'scope', 'size'
  ]);
  assert.equal(programme.download, '/api/programmes/' + programme.id);
  const serialized = JSON.stringify(programme);
  assert.doesNotMatch(serialized, /full|relative|userId|uid|filesystem|path/i);
  assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, new RegExp(ownerId));
  assert.doesNotMatch(serialized, new RegExp(otherId));
}

test('server preserves managed state generation and account-scoped programme storage', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opengym-api-test-'));
  const dataDir = path.join(root, 'data');
  const programmesDir = path.join(root, 'programmes');
  const secret = 'temporary-api-test-secret-not-a-real-credential';
  const ownerId = 'owner-test';
  const otherId = 'other-test';
  const sharedName = 'shared-source.pdf';
  const sharedBody = 'immutable shared source';
  let child;

  try {
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.mkdir(programmesDir, { recursive: true });
    await fs.promises.writeFile(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
    await fs.promises.writeFile(path.join(dataDir, 'db.json'), JSON.stringify({
      users: [{ id: ownerId, name: 'Owner' }, { id: otherId, name: 'Other' }],
      creds: [], subs: [], invites: []
    }));
    await fs.promises.writeFile(path.join(programmesDir, sharedName), sharedBody);

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], {
      cwd: API_DIR,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDir,
        PROGRAMMES_DIR: programmesDir,
        PROGRAMMES_OWNER_UID: ownerId,
        NODE_ENV: 'test',
        OPENGYM_TEST_MAX_PROGRAMME_BYTES: '32',
        ORIGIN: base,
        RP_ID: '127.0.0.1',
        VAPID_SUBJECT: 'mailto:test@example.invalid'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.resume();
    await waitForServer(child, base);

    const unauthenticated = await jsonResponse(base, '/api/programmes');
    assert.equal(unauthenticated.response.status, 401);

    let ownerCookie = sessionCookie(ownerId, secret);
    const otherCookie = sessionCookie(otherId, secret);
    const ownerUploadDir = path.join(programmesDir, 'uploads', ownerId);

    const revokeAll = await jsonResponse(base, '/api/logout/all', {
      method: 'POST', headers: { Cookie: ownerCookie }
    });
    assert.equal(revokeAll.response.status, 200);
    const staleOwnerCookie = ownerCookie;
    ownerCookie = sessionCookie(ownerId, secret, 1);
    assert.equal((await jsonResponse(base, '/api/me', { headers: { Cookie: staleOwnerCookie } })).response.status, 401);
    assert.equal((await jsonResponse(base, '/api/me', { headers: { Cookie: ownerCookie } })).response.status, 200);

    const releasedState = { syncGeneration: 1, _ts: 100, workouts: [{ id: 'released-history', entries: [] }] };
    await fs.promises.writeFile(path.join(dataDir, `state-${ownerId}.json`), JSON.stringify(releasedState));
    const releasedPull = await jsonResponse(base, '/api/data', { headers: { Cookie: ownerCookie } });
    assert.equal(releasedPull.response.status, 200);
    assert.equal(releasedPull.body.state.syncGeneration, 1);
    const stalePush = await jsonResponse(base, '/api/data', {
      method: 'PUT',
      headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: { _ts: 200, workouts: [{ id: 'stale-history', entries: [] }] } })
    });
    assert.equal(stalePush.response.status, 409);
    assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(dataDir, `state-${ownerId}.json`), 'utf8')), releasedState);

    const emptyUpload = await jsonResponse(
      base,
      '/api/programmes/upload?filename=empty.txt',
      { method: 'PUT', headers: { Cookie: ownerCookie, 'Content-Type': 'text/plain' }, body: '' }
    );
    assert.equal(emptyUpload.response.status, 400);
    const afterEmpty = await jsonResponse(base, '/api/programmes', { headers: { Cookie: ownerCookie } });
    assert.equal(afterEmpty.response.status, 200);
    assert.equal(afterEmpty.body.maxBytes, 32);
    assert.equal(afterEmpty.body.programmes.length, 1);
    assert.equal(afterEmpty.body.programmes.some(file => file.filename === 'empty.txt'), false);
    assert.deepEqual(await fs.promises.readdir(ownerUploadDir), []);

    const oversizedUpload = await jsonResponse(
      base,
      '/api/programmes/upload?filename=oversized.txt',
      { method: 'PUT', headers: { Cookie: ownerCookie, 'Content-Type': 'text/plain' }, body: Buffer.alloc(33, 'x') }
    );
    assert.equal(oversizedUpload.response.status, 413);
    const afterOversized = await jsonResponse(base, '/api/programmes', { headers: { Cookie: ownerCookie } });
    assert.equal(afterOversized.body.programmes.some(file => file.filename === 'oversized.txt'), false);
    assert.deepEqual(await fs.promises.readdir(ownerUploadDir), []);

    const upload = await jsonResponse(
      base,
      '/api/programmes/upload?filename=' + encodeURIComponent('../../owner-private.pdf'),
      { method: 'PUT', headers: { Cookie: ownerCookie, 'Content-Type': 'application/pdf' }, body: 'owner private copy' }
    );
    assert.equal(upload.response.status, 200)
    assert.deepEqual(Object.keys(upload.body).sort(), ['programme']);
    assertPublicProgramme(upload.body.programme, { root, ownerId, otherId });
    assert.equal(upload.body.programme.scope, 'personal')
    assert.match(upload.body.programme.filename, /owner-private\.pdf$/)
    assert.doesNotMatch(upload.body.programme.filename, /[\\/]|\.\./)

    const ownerList = await jsonResponse(base, '/api/programmes', { headers: { Cookie: ownerCookie } });
    assert.equal(ownerList.response.status, 200);
    assert.deepEqual(Object.keys(ownerList.body).sort(), ['maxBytes', 'programmes']);
    assert.equal(ownerList.body.maxBytes, 32);
    assert.equal(ownerList.body.programmes.length, 2);
    ownerList.body.programmes.forEach(file => assertPublicProgramme(file, { root, ownerId, otherId }));
    const shared = ownerList.body.programmes.find(file => file.filename === sharedName);
    const personal = ownerList.body.programmes.find(file => file.scope === 'personal');
    assert.ok(shared)
    assert.ok(personal)
    assert.match(personal.filename, /owner-private\.pdf$/)

    const uploadEntries = await fs.promises.readdir(ownerUploadDir);
    assert.equal(uploadEntries.length, 1);
    assert.equal(path.dirname(path.resolve(ownerUploadDir, uploadEntries[0])), path.resolve(ownerUploadDir));
    assert.equal(await fs.promises.readFile(path.join(ownerUploadDir, uploadEntries[0]), 'utf8'), 'owner private copy');
    const personalDownload = await fetch(base + personal.download, { headers: { Cookie: ownerCookie } });
    assert.equal(personalDownload.status, 200);
    assert.equal(await personalDownload.text(), 'owner private copy');

    const otherList = await jsonResponse(base, '/api/programmes', { headers: { Cookie: otherCookie } });
    assert.equal(otherList.response.status, 200);
    assert.equal(otherList.body.programmes.length, 0);
    const otherShared = await fetch(base + shared.download, { headers: { Cookie: otherCookie } });
    const otherPersonal = await fetch(base + personal.download, { headers: { Cookie: otherCookie } });
    assert.equal(otherShared.status, 404);
    assert.equal(otherPersonal.status, 404);

    const sharedDelete = await jsonResponse(base, shared.download, { method: 'DELETE', headers: { Cookie: ownerCookie } });
    assert.equal(sharedDelete.response.status, 403);
    assert.equal(await fs.promises.readFile(path.join(programmesDir, sharedName), 'utf8'), sharedBody);
    const sharedDownload = await fetch(base + shared.download, { headers: { Cookie: ownerCookie } });
    assert.equal(sharedDownload.status, 200);
    assert.equal(await sharedDownload.text(), sharedBody);

    const personalDelete = await jsonResponse(base, personal.download, { method: 'DELETE', headers: { Cookie: ownerCookie } });
    assert.equal(personalDelete.response.status, 200);
    assert.equal((await fs.promises.readdir(ownerUploadDir)).length, 0);
  } finally {
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        new Promise(resolve => setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1000))
      ]);
    }
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
