#!/usr/bin/env node
// Master 위임 입구 표 — Terra Master 계약에서 src/api/master-delegated.json 을 만든다.
//
// 앱 토큰(A 모드 — main Scene 의 terra.web/frame 안)으로 닿는 Master op 는 계약이 위임 입구
// (security.authentication 의 'delegated-session', Terra ADR-GW-003)로 연 것뿐이다. gui-v3 는 Master op 를
// operation id 로 부르므로(Gateway 가 잇는다) 표는 op id → { method, path, permissions } 다.
// 화면은 이 표로 "앱 자격으로 닿는가"를 판정하고, 시험(tests/master-delegated.test.mjs)은 gui-v3 가 부르는
// Master op 가 모두 이 표에 있거나 B 모드 전용으로 이름이 적혀 있는지 본다.
//
// node-gui 의 web/tools/gen-master-delegated.mjs 와 같은 쓰임 — Terra CI 의 "Check … Master delegation table" 스텝이
// 대체 때 이 파일로 바뀐다(인자 같음).
//   node tools/gen-master-delegated.mjs --terra ../Terra           표를 다시 쓴다
//   node tools/gen-master-delegated.mjs --terra ../Terra --check   다르면 실패한다(CI)
// --terra 대신 TERRA_CHECKOUT 환경변수도 받는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT = join(here, '..', 'src', 'api', 'master-delegated.json');
const CONTRACT = 'products/tree/master/contracts/api/terra-api.json';
const SCHEME = 'delegated-session';

/** 계약 → 표(op id 순) */
export function buildTable(contract) {
  const operations = {};
  for (const id of Object.keys(contract.operations).sort()) {
    const op = contract.operations[id];
    if (!(op.security?.authentication ?? []).includes(SCHEME)) continue;
    const b = (op.bindings ?? []).find((x) => x.method && x.path);
    if (!b) throw new Error(`${id}: 위임으로 열렸는데 HTTP 바인딩이 없다`);
    operations[id] = { method: b.method.toUpperCase(), path: b.path, permissions: op.security?.permissions ?? [] };
  }
  return { $comment: 'tools/gen-master-delegated.mjs 가 Terra Master 계약에서 뽑은 표 — 손으로 고치지 않는다', contractVersion: contract.contractVersion ?? contract.version ?? '?', operations };
}

function main(argv) {
  const at = argv.indexOf('--terra');
  const terra = at >= 0 ? argv[at + 1] : process.env.TERRA_CHECKOUT;
  if (!terra) { console.error('Terra 체크아웃이 필요하다 — --terra <path> 또는 TERRA_CHECKOUT'); process.exit(2); }
  const table = buildTable(JSON.parse(readFileSync(resolve(terra, CONTRACT), 'utf8')));
  const n = Object.keys(table.operations).length;
  if (argv.includes('--check')) {
    let now = null;
    try { now = JSON.parse(readFileSync(OUTPUT, 'utf8')); } catch { /* 없다 · 깨짐 */ }
    if (JSON.stringify(now) !== JSON.stringify(table)) {   // 값으로 비교한다(줄 끝 · 들여쓰기에 흔들리지 않게)
      console.error('::error::src/api/master-delegated.json 이 Terra 계약과 다르다 — node tools/gen-master-delegated.mjs --terra <Terra> 로 다시 만든다');
      process.exit(1);
    }
    console.log(`master-delegated.json: Terra 계약과 같다 (${n} op)`);
    return;
  }
  writeFileSync(OUTPUT, JSON.stringify(table, null, 1) + '\n');
  console.log(`master-delegated.json: ${n} op`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
