// 릴리스 서명의 계획(signing.json)을 읽고, 시크릿에서 키 파일을 쓴다.
//
//   node tools/signing.mjs write-keys --signing signing.json --out <dir>
//
// **왜 키 파일을 셸이 아니라 여기서 쓰나** — 시크릿 이름이 signing.json 에 있고,
// 쓰기 전에 확인할 것이 셋 있다: 시크릿이 비어 있지 않은가, 64바이트 ed25519
// 비밀키인가, **그 키가 signing.json 이 말하는 keyId 인가**. 셋째가 빠지면 엉뚱한
// 키를 시크릿에 넣은 릴리스가 포장까지 끝내고 마지막 inspect 검사에서야 선다 —
// 실패는 같아도 원인을 읽기 어렵다. 셸 루프로는 그 확인을 정직하게 못 한다.
//
// **조용히 건너뛰지 않는다** (분리 검토 G-12) — 시크릿이 없으면 서명 없이 포장하는
// 대신 여기서 선다. 미서명 포장은 pack-modules.mjs --unsigned 로 **명시**해야만 된다.
//
// 이 파일은 비밀키를 출력하지 않는다. 오류 메시지에도 키 이름과 keyId 만 싣는다.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIGNING_TIERS = ['core', 'built-in', 'trusted-third-party'];
const SIGNING_SCHEMA_VERSION = 1;
const PRIVATE_KEY_BYTES = 64;

/** base64url(sha256(publicKey)[:12]) — terra-sdk trust.TrustKeyID 와 같은 값. */
export function keyIdFromPublicKey(publicKey) {
  return createHash('sha256').update(publicKey).digest().subarray(0, 12).toString('base64url');
}

/**
 * `terra module pack --sign-key` 가 읽는 형식(64바이트 비밀키의 base64url, 또는
 * 표준 base64)을 해석한다. Go 의 ed25519 비밀키는 seed(32) ‖ 공개키(32)라 공개키는
 * 뒤 32바이트다.
 */
export function decodePrivateKey(text) {
  const trimmed = String(text ?? '').trim();
  const bytes = /^[A-Za-z0-9_-]+$/.test(trimmed)
    ? Buffer.from(trimmed, 'base64url')
    : Buffer.from(trimmed, 'base64');
  if (bytes.length !== PRIVATE_KEY_BYTES) {
    throw new Error(`64바이트 ed25519 비밀키가 아니다 (${bytes.length}바이트)`);
  }
  return { publicKey: bytes.subarray(32), keyId: keyIdFromPublicKey(bytes.subarray(32)) };
}

/**
 * signing.json 을 검사한다. requireKeyIds 는 릴리스 경로(키가 이미 있어야 한다)에서
 * 켜고, 계획의 모양만 볼 때는 끈다.
 */
export function parseSigningPlan(document, { requireKeyIds = true } = {}) {
  const problems = [];
  if (document?.schemaVersion !== SIGNING_SCHEMA_VERSION) {
    problems.push(`schemaVersion 은 ${SIGNING_SCHEMA_VERSION} 이어야 한다 (${document?.schemaVersion})`);
  }
  const keys = Array.isArray(document?.keys) ? document.keys : [];
  if (keys.length === 0) problems.push('keys 가 비어 있다');
  const owners = new Map();
  const names = new Set();
  for (const [index, key] of keys.entries()) {
    const label = `keys[${index}] (${key?.name ?? '?'})`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key?.name ?? '')) problems.push(`${label}: name 은 소문자·숫자·- 만`);
    if (names.has(key?.name)) problems.push(`${label}: name 이 겹친다`);
    names.add(key?.name);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key?.secret ?? '')) problems.push(`${label}: secret 은 시크릿 이름(대문자·숫자·_)`);
    if (!String(key?.issuer ?? '').trim()) problems.push(`${label}: issuer 가 비어 있다`);
    if (!SIGNING_TIERS.includes(key?.tier)) problems.push(`${label}: tier ${key?.tier} 는 서명 tier 가 아니다`);
    if (typeof key?.keyId !== 'string') problems.push(`${label}: keyId 는 문자열`);
    else if (requireKeyIds && key.keyId === '') {
      problems.push(`${label}: keyId 가 비어 있다 — 키를 아직 만들지 않았다 (Terra docs/architecture/operations/module-signing-key-procedure.md)`);
    }
    const prefixes = Array.isArray(key?.prefixes) ? key.prefixes : [];
    if (prefixes.length === 0) problems.push(`${label}: prefixes 가 비어 있다`);
    for (const prefix of prefixes) {
      if (!/^[a-z0-9]+(\.[a-z0-9-]+)*$/.test(prefix)) problems.push(`${label}: 접두사 ${prefix} 의 모양이 틀렸다`);
      if (owners.has(prefix)) problems.push(`${label}: 접두사 ${prefix} 를 ${owners.get(prefix)} 도 갖는다`);
      owners.set(prefix, key?.name);
    }
  }
  if (problems.length > 0) {
    throw new Error(`signing.json 이 틀렸다:\n  - ${problems.join('\n  - ')}`);
  }
  return { keys };
}

/** id 를 서명할 키 — `<prefix>.` 경계로 맞는 가장 긴 접두사. 없으면 null. */
export function keyForModule(plan, moduleId) {
  let best = null;
  let bestLength = -1;
  for (const key of plan.keys) {
    for (const prefix of key.prefixes) {
      if ((moduleId === prefix || moduleId.startsWith(`${prefix}.`)) && prefix.length > bestLength) {
        best = key;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

export function loadSigningPlan(path, options) {
  return parseSigningPlan(JSON.parse(readFileSync(path, 'utf8')), options);
}

export function keyFilePath(keyDir, key) {
  return join(keyDir, `${key.name}.key`);
}

/** 키 파일이 계획의 keyId 인지 본다. pack-modules 가 포장 전에 다시 부른다. */
export function checkKeyFile(keyDir, key) {
  const { keyId } = decodePrivateKey(readFileSync(keyFilePath(keyDir, key), 'utf8'));
  if (keyId !== key.keyId) {
    throw new Error(`${key.name}: 키 파일의 keyId ${keyId} 가 signing.json 의 ${key.keyId} 와 다르다 — 엉뚱한 키가 들어왔다`);
  }
}

/** env 의 시크릿에서 키 파일을 쓴다. 하나라도 문제가 있으면 아무것도 쓰지 않는다. */
export function writeKeys(plan, env, outDir) {
  const prepared = [];
  for (const key of plan.keys) {
    const text = env[key.secret];
    if (!text || !String(text).trim()) {
      throw new Error(`시크릿 ${key.secret} 가 비어 있다 (${key.name}) — 서명 없이 릴리스를 만들지 않는다`);
    }
    let decoded;
    try {
      decoded = decodePrivateKey(text);
    } catch (error) {
      throw new Error(`시크릿 ${key.secret} (${key.name}): ${error.message}`);
    }
    if (decoded.keyId !== key.keyId) {
      throw new Error(
        `시크릿 ${key.secret} 의 keyId ${decoded.keyId} 가 signing.json 의 ${key.name} keyId ${key.keyId} 와 다르다`
      );
    }
    prepared.push({ key, text: `${String(text).trim()}\n` });
  }
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  for (const { key, text } of prepared) {
    const path = keyFilePath(outDir, key);
    writeFileSync(path, text, { mode: 0o600, flag: 'wx' });
    chmodSync(path, 0o600);
  }
  return prepared.map(({ key }) => key.name);
}

// --- CLI ----------------------------------------------------------------

function main(argv) {
  const [command, ...rest] = argv;
  let signing = '';
  let out = '';
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--signing') signing = rest[++index] ?? '';
    else if (rest[index] === '--out') out = rest[++index] ?? '';
    else throw new Error(`알 수 없는 인자: ${rest[index]}`);
  }
  if (command !== 'write-keys' || !signing || !out) {
    throw new Error('usage: node tools/signing.mjs write-keys --signing <signing.json> --out <dir>');
  }
  const written = writeKeys(loadSigningPlan(resolve(signing)), process.env, resolve(out));
  console.log(`서명 키 ${written.length}개를 썼다: ${written.join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message.replaceAll('\n', '%0A')}`);
    process.exitCode = 1;
  }
}
