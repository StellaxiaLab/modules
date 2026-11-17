#!/usr/bin/env node
// terra-frame-client.js 사본 대조 검사 (코드 재사용 분석 G-1).
//
// 원본은 Terra 의 `@terra/frame-client` 이고, Terra CLI 의 웹 스캐폴드가 빌드한 파일 한 개를
// 그대로 내준다(`webscaffold/terra-frame-client.js`, Terra 쪽 시험이 원본과의 일치를 지킨다).
// 이 저장소는 그 파일을 모듈마다 사본으로 둔다 — 모듈은 서로 의존하지 않고, 웹 모듈은 빌드 한
// 번으로 혼자 서야 하기 때문이다(저장소 분리 결정). 사본이 조용히 갈라지는 것(한 사본만 approve
// 가 없던 일)을 여기서 잡는다.
//
// 기준은 gui-v3 의 사본이다. 사본을 갱신할 때는 Terra 스캐폴드 파일을 모든 사본 자리에 같은
// 바이트로 복사한다(`--write` 가 gui-v3 사본을 기준으로 나머지를 맞춘다).
// 줄끝(CRLF/LF)만 다른 것은 같은 것으로 본다.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'terra-frame-client.js';
const REFERENCE = 'common/lab.stellaxia.gui-v3/web/src/api/terra-frame-client.js';
const SKIP = new Set(['node_modules', 'dist', '.git']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (entry === NAME) yield full;
  }
}

const norm = (text) => text.replace(/\r\n/g, '\n');
const reference = norm(readFileSync(join(root, REFERENCE), 'utf8'));
const write = process.argv.includes('--write');
const copies = [];
for (const top of ['common', 'leaf', 'tree']) copies.push(...walk(join(root, top)));

let bad = 0;
for (const file of copies) {
  const rel = relative(root, file).split(sep).join('/');
  if (rel === REFERENCE) continue;
  if (norm(readFileSync(file, 'utf8')) === reference) continue;
  if (write) {
    writeFileSync(file, reference);
    console.log(`rewrote ${rel}`);
  } else {
    bad++;
    console.error(`DRIFT ${rel} differs from ${REFERENCE}`);
  }
}
if (copies.length < 5) {
  console.error(`expected at least 5 ${NAME} copies, found ${copies.length}`);
  bad++;
}
if (bad) {
  console.error('Copy the Terra scaffold file over the reference first, then run: node tools/check-frame-client.mjs --write');
  process.exit(1);
}
console.log(`${copies.length} ${NAME} copies match ${REFERENCE}`);
