// node --test — gui-v3 가 부르는 Master op 는 앱 위임 입구(src/api/master-delegated.json)에 있거나, B 모드 전용으로 이름이 적혀 있다
//   표는 tools/gen-master-delegated.mjs 가 Terra Master 계약에서 만든다(CI 의 --check 가 대조). 새 Master op 를 부르기 시작했는데
//   위임 밖이면 A 모드(main Scene)에서 DELEGATION_NOT_OPEN 으로 막힌다 — 여기서 먼저 빨개진다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const table = JSON.parse(readFileSync(join(web, 'src/api/master-delegated.json'), 'utf8'));
// 앱 자격으로는 닿지 않는 것 — B 모드(단독 · 자격 핸들)에서만 쓴다. 이유를 적어 둔다
// AUD-23: Tree 로그인 길(login-routes.get · resolve.post)은 Terra가 위임에 열어 표에 들어왔다 — 여기엔 이제 없다
const B_ONLY = {};
// 위임 밖이지만 문(window.TerraGate · TerraGateAll) 뒤에서만 부르는 것 — 화면은 잠그고 why 를 보인다. 코어가 열면 표만 다시 뽑아 저절로 열린다
const GATED = {
  // P14-4 Tree 관리 쓰기 · 설정 읽기 — 위임 표(지휘 세션이 따로 재생성)에 아직 없다. 열리면 이 줄들을 지운다(위 시험이 알려 준다)
  'terra.master.config.get': 'Tree 관리 › Master 설정', 'terra.master.config.schema.get': 'Tree 관리 › Master 설정', 'terra.master.config.validate.post': 'Tree 관리 › Master 설정 › 검증', 'terra.master.config.patch': 'Tree 관리 › Master 설정 › 저장(T4)',
  'terra.master.modules.publications.post': 'Tree 관리 › 모듈 게시', 'terra.master.modules.publications.by-publication-id.revoke.post': 'Tree 관리 › 모듈 회수', 'terra.master.modules.publications.by-publication-id.rollout.post': 'Tree 관리 › 모듈 롤아웃', 'terra.master.modules.publications.by-publication-id.promote.post': 'Tree 관리 › 모듈 승격',
  'terra.master.modules.promotions.by-promotion-id.approve.post': 'Tree 관리 › 승격 승인', 'terra.master.modules.promotions.by-promotion-id.reject.post': 'Tree 관리 › 승격 거절', 'terra.master.modules.approval-ceiling.post': 'Tree 관리 › 승인 상한(T4)', 'terra.master.modules.mirror-blocks.post': 'Tree 관리 › 미러 거부 추가', 'terra.master.modules.mirror-blocks.by-pattern.delete': 'Tree 관리 › 미러 거부 풀기',
  'terra.master.core.releases.post': 'Tree 관리 › 코어 릴리스 게시(T4)', 'terra.master.core.releases.by-release-id.revoke.post': 'Tree 관리 › 코어 회수(T4)', 'terra.master.core.releases.by-release-id.apply.post': 'Tree 관리 › 코어 적용 지시(T4)', 'terra.master.core.releases.by-release-id.rollout.post': 'Tree 관리 › 코어 롤아웃(T4)',
  'terra.master.svi.handles.post': '자원 상태 창 값 보기 — 핸들 열기(svi-view.js WATCH_OPS)',
  'terra.master.svi.handles.by-handle-id.delete': '자원 상태 창 값 보기 — 핸들 닫기',
  'terra.master.admin.users.get': '허가 주체 — 사람 목록(나 말고는 위임 가드도 막는다)',
  'terra.master.network.mesh.wireguard.reconcile.post': '네트워크 › 자동 조정', 
  'terra.master.network.mesh.wireguard.peers.revoke.post': '네트워크 › 피어 철회', 
  'terra.master.route.policies.put': '네트워크 › 정책 저장', 'terra.master.route.policies.by-policy-id.delete': '네트워크 › 정책 지우기',
  
  'terra.master.users.by-user-id.external-identities.post': '설정 › 계정 › 외부 신원 연결', 'terra.master.users.by-user-id.external-identities.delete': '설정 › 계정 › 외부 신원 해제',
  'terra.master.admin.external-issuers.get': '설정 › 계정 › 신뢰 발급자 목록', 'terra.master.admin.external-issuers.post': '설정 › 계정 › 신뢰 발급자 더하기', 'terra.master.admin.external-issuers.delete': '설정 › 계정 › 신뢰 발급자 빼기'
};
const files = (dir, ext) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), ext) : ext.test(e.name) && !/\.test\.mjs$/.test(e.name) ? [join(dir, e.name)] : []));

test('표 — 계약에서 뽑은 모양(op id → method · path · permissions)', () => {
  assert.ok(Object.keys(table.operations).length > 0);
  for (const [id, o] of Object.entries(table.operations)) { assert.match(id, /^terra\.master\./); assert.ok(o.method && o.path.startsWith('/api/v1/'), id); assert.ok(Array.isArray(o.permissions), id); }
  assert.ok(table.operations['terra.master.nodes.by-node-id.modules.assignments.post'], '모듈 배정(#236)이 위임에 열려 있다');
});

test('gui-v3 가 부르는 Master op — 모두 위임 표에 있거나 B 모드 전용', () => {
  const used = new Set();
  for (const f of [...files(join(web, 'src'), /\.js$/), ...files(join(web, 'design'), /\.dc\.html$/)]) for (const m of readFileSync(f, 'utf8').matchAll(/'(terra\.master\.[a-z0-9.-]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 0);
  for (const id of ['terra.master.crossboundary.login-routes.get', 'terra.master.crossboundary.login-routes.by-node-id.resolve.post']) assert.ok(table.operations[id], 'AUD-23 위임에 열림: ' + id);
  const out = [...used].filter((id) => !table.operations[id] && !B_ONLY[id] && !GATED[id]);
  for (const id of Object.keys(GATED)) assert.ok(!table.operations[id], id + ' 가 위임 표에 생겼다 — GATED 에서 빼라(화면은 저절로 열린다)');
  assert.deepEqual(out, [], '위임 밖인데 B 모드 전용 · 문(gate)으로 잠근 단추로 적히지 않은 Master op');
});
