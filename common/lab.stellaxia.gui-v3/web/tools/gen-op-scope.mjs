// Daemon operation 의 원격 개방 표를 Terra 계약에서 뽑는다 — 원격 제어기의 잠금 표시가 읽는다(src/api/op-scope.json).
//   node tools/gen-op-scope.mjs --terra <Terra 체크아웃>          표를 다시 쓴다
//   node tools/gen-op-scope.mjs --terra <Terra 체크아웃> --check  표가 계약과 같은지만 본다(다르면 exit 1)
// 기준: 계약의 availability.scopes 에 'cluster' 가 있으면 다른 노드에서(Master 중계) 부를 수 있다. 없으면 그 노드에서만 — 잠금.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const i = process.argv.indexOf('--terra'), terra = i > 0 ? process.argv[i + 1] : null;
if (!terra) { console.error('--terra <Terra 체크아웃> 이 필요하다'); process.exit(2); }
const src = join(terra, 'products/leaf/daemon/contracts/api/terra-api.json');
const c = JSON.parse(await readFile(src, 'utf8'));
const ops = {};
for (const id of Object.keys(c.operations).sort()) {
  const o = c.operations[id];
  ops[id] = { scopes: (o.availability && o.availability.scopes) || ['local'], permissions: (o.security && o.security.permissions) || [], risk: (o.execution && o.execution.risk) || '' };
}
const out = { $comment: 'tools/gen-op-scope.mjs 가 Terra Daemon 계약에서 뽑은 표 — 손으로 고치지 않는다', contractVersion: c.contractVersion || '', operations: ops };
const target = new URL('../src/api/op-scope.json', import.meta.url);
const text = JSON.stringify(out, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const cur = await readFile(target, 'utf8').catch(() => '');
  if (cur !== text) { console.error('op-scope.json 이 Terra 계약과 다르다 — gen-op-scope.mjs 로 다시 쓴다'); process.exit(1); }
  console.log('op-scope.json — 계약과 같다 (' + Object.keys(ops).length + ' operation)');
} else { await writeFile(target, text); console.log('op-scope.json — ' + Object.keys(ops).length + ' operation, 그 노드에서만 ' + Object.values(ops).filter((o) => !o.scopes.includes('cluster')).length); }
