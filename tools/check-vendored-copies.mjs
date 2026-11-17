#!/usr/bin/env node
// 모듈끼리 같은 바이트로 둔 사본의 대조 검사 (코드 재사용 분석 G-1 · G-9).
//
//   node tools/check-vendored-copies.mjs [--write]
//
// 웹 모듈은 서로 의존하지 않고 빌드 한 번으로 혼자 서야 한다(저장소 분리 결정). 그래서 공용 코드는
// 모듈마다 사본으로 두되, 사본이 조용히 갈라지는 것(한 사본만 approve · resume_id 가 없던 일)을
// 이 검사가 잡는다. 기준 파일 하나와 같은 이름의 사본을 모두 찾아 바이트를 대조한다(줄끝 CRLF/LF 차이는
// 무시). `--write` 는 기준 파일로 나머지를 덮어 맞춘다.
//
//   terra-frame-client.js   원본은 Terra 의 `@terra/frame-client`(Terra CLI 웹 스캐폴드가 빌드한 파일
//                           한 개를 내준다). 기준은 gui-v3 의 사본 — 갱신할 때는 Terra 스캐폴드 파일을
//                           기준 자리에 먼저 복사한다.
//   file-transfer.js(+test) 파일 모듈(lab.stellaxia.file)이 원본이다 — gui-v3 의 제어기 파일 관리자가
//                           같은 코드를 쓴다.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.git']);

const SETS = [
  { name: 'terra-frame-client.js', reference: 'common/lab.stellaxia.gui-v3/web/src/api/terra-frame-client.js', min: 5 },
  { name: 'file-transfer.js', reference: 'leaf/lab.stellaxia.file/web/src/lib/file-transfer.js', min: 2 },
  { name: 'file-transfer.test.mjs', reference: 'leaf/lab.stellaxia.file/web/src/lib/file-transfer.test.mjs', min: 2 }
];

function* walk(dir, name) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full, name);
    else if (entry === name) yield full;
  }
}

const norm = (text) => text.replace(/\r\n/g, '\n');
const write = process.argv.includes('--write');
let bad = 0;

for (const set of SETS) {
  const reference = norm(readFileSync(join(root, set.reference), 'utf8'));
  const copies = [];
  for (const top of ['common', 'leaf', 'tree']) copies.push(...walk(join(root, top), set.name));
  for (const file of copies) {
    const rel = relative(root, file).split(sep).join('/');
    if (rel === set.reference || norm(readFileSync(file, 'utf8')) === reference) continue;
    if (write) {
      writeFileSync(file, reference);
      console.log(`rewrote ${rel}`);
    } else {
      bad++;
      console.error(`DRIFT ${rel} differs from ${set.reference}`);
    }
  }
  if (copies.length < set.min) {
    console.error(`expected at least ${set.min} ${set.name} copies, found ${copies.length}`);
    bad++;
  } else {
    console.log(`${copies.length} ${set.name} copies checked against ${set.reference}`);
  }
}
if (bad) {
  console.error('Fix the reference first, then run: node tools/check-vendored-copies.mjs --write');
  process.exit(1);
}
