import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { decodePrivateKey, keyForModule, parseSigningPlan, writeKeys } from './signing.mjs';

// Go 로 만든 벡터: ed25519.NewKeyFromSeed(0x00..0x1f) 와 terra-sdk TrustKeyID.
// 시드가 0,1,2,… 인 **공개된 시험용 키**다. 어떤 keyring 에도 없다.
const GO_VECTOR = {
  privateKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8DoQe_884Qvh1w3RjnS8CZZ-TWMJulDV8d3IZkElUxuA',
  keyId: 'Vkdap1RjR0wChd9d'
};

/** 시험 안에서만 쓰는 새 키쌍을 pack --sign-key 형식(seed ‖ 공개키, base64url)으로. */
function freshKey() {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url')]);
  return raw.toString('base64url');
}

function plan(overrides = {}) {
  return {
    schemaVersion: 1,
    keys: [
      { name: 'builtin', secret: 'KEY_A', keyId: 'a', issuer: 'Terra', tier: 'built-in', prefixes: ['io.terra'] },
      { name: 'lab', secret: 'KEY_B', keyId: 'b', issuer: 'Lab', tier: 'trusted-third-party', prefixes: ['lab.stellaxia', 'dev.terrallo'] }
    ],
    ...overrides
  };
}

test('keyId 는 Go 의 TrustKeyID 와 같다', () => {
  assert.equal(decodePrivateKey(GO_VECTOR.privateKey).keyId, GO_VECTOR.keyId);
  // pack 은 표준 base64 도 받는다 — 같은 키는 같은 keyId 여야 한다.
  const standard = Buffer.from(GO_VECTOR.privateKey, 'base64url').toString('base64');
  assert.equal(decodePrivateKey(standard).keyId, GO_VECTOR.keyId);
});

test('64바이트가 아닌 키는 거절한다 (공개키를 잘못 넣은 경우 포함)', () => {
  const publicOnly = Buffer.from(GO_VECTOR.privateKey, 'base64url').subarray(32).toString('base64url');
  assert.throws(() => decodePrivateKey(publicOnly), /64바이트/);
  assert.throws(() => decodePrivateKey(''), /64바이트/);
});

test('모듈은 <prefix>. 경계로, 가장 긴 접두사의 키로 서명된다', () => {
  const parsed = parseSigningPlan(plan());
  assert.equal(keyForModule(parsed, 'io.terra.file').name, 'builtin');
  assert.equal(keyForModule(parsed, 'lab.stellaxia.gui-v3').name, 'lab');
  assert.equal(keyForModule(parsed, 'dev.terrallo').name, 'lab');
  assert.equal(keyForModule(parsed, 'io.terrafake.x'), null);
  assert.equal(keyForModule(parsed, 'com.acme.x'), null);

  const nested = plan();
  nested.keys[1].prefixes.push('io.terra.lab');
  assert.equal(keyForModule(parseSigningPlan(nested), 'io.terra.lab.thing').name, 'lab');
});

test('keyId 가 비면 릴리스 경로에서는 선다 — 키를 아직 만들지 않았다는 뜻이다', () => {
  const empty = plan();
  empty.keys[0].keyId = '';
  assert.throws(() => parseSigningPlan(empty), /keyId 가 비어 있다/);
  assert.doesNotThrow(() => parseSigningPlan(empty, { requireKeyIds: false }));
});

test('계획의 틀린 모양은 전부 거절한다', () => {
  const broken = [
    (p) => { p.schemaVersion = 2; },
    (p) => { p.keys = []; },
    (p) => { p.keys[0].tier = 'development'; },
    (p) => { p.keys[0].issuer = ' '; },
    (p) => { p.keys[0].secret = 'lower-case'; },
    (p) => { p.keys[1].prefixes.push('io.terra'); },
    (p) => { p.keys[1].name = 'builtin'; },
    (p) => { p.keys[0].prefixes = []; }
  ];
  for (const mutate of broken) {
    const p = plan();
    mutate(p);
    assert.throws(() => parseSigningPlan(p), /signing\.json/);
  }
});

test('저장소의 signing.json 은 모양이 맞고, 저장소의 모든 모듈에 키가 있다', async () => {
  const repoRoot = new URL('..', import.meta.url);
  const parsed = parseSigningPlan(JSON.parse(readFileSync(new URL('signing.json', repoRoot), 'utf8')), {
    requireKeyIds: false
  });
  const unsigned = [];
  for (const tier of ['common', 'leaf', 'tree']) {
    let entries = [];
    try {
      entries = readdirSync(new URL(`${tier}/`, repoRoot), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && keyForModule(parsed, entry.name) === null) unsigned.push(`${tier}/${entry.name}`);
    }
  }
  assert.deepEqual(unsigned, [], 'signing.json 에 맞는 접두사가 없는 모듈 — 릴리스 포장이 여기서 선다');
});

test('writeKeys: 시크릿이 없으면 아무것도 쓰지 않고 선다', () => {
  const out = mkdtempSync(join(tmpdir(), 'signing-test-'));
  try {
    const keyA = freshKey();
    const p = plan();
    p.keys[0].keyId = decodePrivateKey(keyA).keyId;
    const parsed = parseSigningPlan(p);
    assert.throws(() => writeKeys(parsed, { KEY_A: keyA }, join(out, 'keys')), /KEY_B 가 비어 있다/);
    assert.throws(() => readdirSync(join(out, 'keys')), /ENOENT/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('writeKeys: 시크릿의 키가 signing.json 의 keyId 가 아니면 선다', () => {
  const out = mkdtempSync(join(tmpdir(), 'signing-test-'));
  try {
    const p = plan();
    p.keys[0].keyId = decodePrivateKey(freshKey()).keyId;
    p.keys[1].keyId = decodePrivateKey(freshKey()).keyId;
    assert.throws(
      () => writeKeys(parseSigningPlan(p), { KEY_A: freshKey(), KEY_B: freshKey() }, join(out, 'keys')),
      /keyId .* 와 다르다/
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('writeKeys: 맞는 키는 이름별 파일로 쓰고, 오류 메시지에 키를 싣지 않는다', () => {
  const out = mkdtempSync(join(tmpdir(), 'signing-test-'));
  try {
    const keyA = freshKey();
    const keyB = freshKey();
    const p = plan();
    p.keys[0].keyId = decodePrivateKey(keyA).keyId;
    p.keys[1].keyId = decodePrivateKey(keyB).keyId;
    const dir = join(out, 'keys');
    assert.deepEqual(writeKeys(parseSigningPlan(p), { KEY_A: keyA, KEY_B: keyB }, dir), ['builtin', 'lab']);
    assert.equal(readFileSync(join(dir, 'builtin.key'), 'utf8').trim(), keyA);
    assert.equal(readFileSync(join(dir, 'lab.key'), 'utf8').trim(), keyB);

    // 두 번째 쓰기는 덮어쓰지 않는다 — 지난 실행의 키가 남아 있다면 그것부터 이상하다.
    assert.throws(() => writeKeys(parseSigningPlan(p), { KEY_A: keyA, KEY_B: keyB }, dir), /EEXIST/);

    const wrong = plan();
    wrong.keys[0].keyId = 'x';
    try {
      writeKeys(parseSigningPlan(wrong), { KEY_A: keyA, KEY_B: keyB }, join(out, 'other'));
      assert.fail('엉뚱한 keyId 를 받아들였다');
    } catch (error) {
      assert.ok(!error.message.includes(keyA), '오류 메시지에 비밀키가 실렸다');
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
