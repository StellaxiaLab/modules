// node --test — §2.5 오류 문구 표
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHint, errorLine, errorSilent, retryAfterOf } from './error-text.js';

const UP = 'terra.master.modules.upload.post';

test('새 코드 — 표 문구', () => {
  assert.equal(errorHint(UP, { code: 'APPROVAL_EXPIRED' }), '승인 요청이 만료됨(5분) — 다시 누르기');
  assert.equal(errorHint(UP, { code: 'APPROVAL_UNAVAILABLE' }), '승인 문 없음 — Terra 셸 안에서 열기');
  assert.equal(errorHint(UP, { code: 'APPROVAL_RATE_LIMITED' }), '승인 요청이 너무 잦음 — 잠시 뒤');
  assert.equal(errorHint(UP, { code: 'RECENT_AUTH_REQUIRED' }), '비밀번호를 다시 입력해야 함');
  assert.equal(errorHint(UP, { code: 'REMOTE_MANAGEMENT_APP_REFUSED' }), '원격 관리는 사람만 — 승인 문으로');
});

test('노드 이름이 들어가는 문구', () => {
  assert.equal(errorHint(UP, { code: 'SERVICE_TUNNEL_DISABLED' }, { node: 'desk' }), "desk 의 '서비스 터널 열기'가 꺼져 있음");
  assert.equal(errorHint(UP, { code: 'APP_COMMAND_EXECUTION_DISABLED' }, { node: 'rdk' }), "rdk 의 '웹 앱 명령 실행'이 꺼져 있음");
  assert.equal(errorHint(UP, { code: 'REMOTE_MANAGEMENT_DISABLED' }, { node: 'rdk' }), 'rdk 의 원격 관리가 꺼져 있음 — 그 노드의 위험 영역에서 켜기');
  assert.match(errorHint(UP, { code: 'SERVICE_TUNNEL_DISABLED' }), /^이 노드의 /);
});

test('거절은 조용하다', () => {
  assert.equal(errorSilent({ code: 'APPROVAL_DECLINED' }), true);
  assert.equal(errorHint(UP, { code: 'APPROVAL_DECLINED' }), '');
  assert.equal(errorLine(UP, { code: 'APPROVAL_DECLINED' }), '');
  assert.equal(errorSilent({ code: 'APPROVAL_EXPIRED' }), false);
});

test('429 — Retry-After 초, 503+Retry-After — 다시 로그인이라 하지 않는다', () => {
  assert.equal(errorHint(UP, { code: 'RATE_LIMITED', status: 429, details: { retry_after_seconds: 7 } }), '너무 잦음 — 7초 뒤 다시');
  assert.equal(errorHint(UP, { status: 429 }), '너무 잦음 — 다시');
  assert.equal(retryAfterOf({ retryAfter: 2.2 }), 3);
  const h = errorHint(UP, { status: 503, retryAfter: 5 }); assert.match(h, /세션을 확인 못 함/); assert.ok(!h.includes('다시 로그인'));
});

test('권한 거부는 op-scope 표에서, 표에 없는 코드는 서버 문장 + 코드', () => {
  assert.match(errorHint('terra.master.service-tunnels.open.post', { code: 'MODULE_PERMISSION_DENIED' }), /^계정 권한 없음 : .*Tree 관리자에게 요청$/);
  assert.equal(errorLine(UP, { code: 'WEIRD', message: '이상함' }), '이상함 (WEIRD)');
  assert.equal(errorLine(UP, { code: 'WEIRD' }), 'WEIRD');
  assert.equal(errorHint(UP, { code: 'WEIRD', message: 'x' }), '');
});

test('readFailNote — LOCAL_ONLY 는 op 이름 없이 쉬운 말로(D10)', async () => {
  const { readFailNote } = await import('./error-text.js');
  const t = readFailNote({ code: 'LOCAL_ONLY', msg: 'terra.daemon.danger-zone.node-shell.get — 이 노드에서만' });
  assert.ok(!/terra\.daemon/.test(t) && /그 노드에서만/.test(t), t);
  assert.equal(readFailNote({ code: 'X_FAIL', msg: '왜' }), '상태 읽기 실패 : X_FAIL — 왜');
});
