// 승인 문 대상 operation 표 — Terra 계약(execution.approval)에서 뽑는다(ADR-GW-014 P13-1 · P13-2).
//   node tools/gen-approval-ops.mjs --terra <Terra 체크아웃>          표를 다시 쓴다
//   node tools/gen-approval-ops.mjs --terra <Terra 체크아웃> --check  표가 계약과 같은지만 본다(다르면 exit 1)
// 한 줄 = { tier: T3|T4, impact: node|cluster|trust, switch?: 'remote-manage', inputs[], secretResult?: [결과 중 비밀 — 한 번만 보임], permissions[], confirm?: true(계약 confirmation 있음) }
// op-scope.json · master-delegated.json 과 따로 둔다 — 그 둘은 지휘 세션이 Terra 병합 뒤 한꺼번에 다시 뽑는다.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const i = process.argv.indexOf('--terra'), terra = i > 0 ? process.argv[i + 1] : null;
if (!terra) { console.error('--terra <Terra 체크아웃> 이 필요하다'); process.exit(2); }
const SRC = ['products/common/apps/terra-gateway-service', 'products/leaf/daemon', 'products/tree/master'];
const ops = {};
for (const dir of SRC) {
  const c = JSON.parse(await readFile(join(terra, dir, 'contracts/api/terra-api.json'), 'utf8'));
  for (const [id, o] of Object.entries(c.operations)) {
    const a = o.execution && o.execution.approval; if (!a) continue;
    ops[id] = { tier: a.tier, impact: a.impact, ...(a.switch ? { switch: a.switch } : {}), inputs: a.inputs || [], ...(a.secret_result ? { secretResult: a.secret_result } : {}), permissions: (o.security && o.security.permissions) || [], ...(o.execution.confirmation ? { confirm: true } : {}) };
  }
}
const sorted = {}; for (const k of Object.keys(ops).sort()) sorted[k] = ops[k];
const out = { $comment: 'tools/gen-approval-ops.mjs 가 Terra 계약에서 뽑은 표 — 손으로 고치지 않는다', operations: sorted };
const target = new URL('../src/api/approval-ops.json', import.meta.url), text = JSON.stringify(out, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const cur = await readFile(target, 'utf8').catch(() => '');
  if (cur !== text) { console.error('approval-ops.json 이 Terra 계약과 다르다 — gen-approval-ops.mjs 로 다시 쓴다'); process.exit(1); }
  console.log('approval-ops.json — 계약과 같다 (' + Object.keys(sorted).length + ' operation)');
} else { await writeFile(target, text); console.log('approval-ops.json — ' + Object.keys(sorted).length + ' operation'); }
