import test from 'node:test';
import assert from 'node:assert/strict';
import { dangerView, DANGER_BANNER, DANGER_SET_HINT } from './danger-zone.js';

const ON = { data: { allow: true, changed_at: '2026-11-08T10:00:00Z', changed_by: 'admin' } };

test('시안(읽기 없음) — 꺼짐 · 단추 비활성 · 터미널 안내', () => {
  const v = dangerView(null, { canAsk: true });
  assert.equal(v.state, 'sim'); assert.equal(v.on, false); assert.equal(v.btnOff, true); assert.equal(v.banner, '');
  assert.ok(v.why.includes(DANGER_SET_HINT));
});

test('켜짐 — 표시줄 · 마지막 변경 시각 · 주체', () => {
  const v = dangerView(ON, { canAsk: true });
  assert.equal(v.on, true); assert.equal(v.banner, DANGER_BANNER); assert.equal(v.status, '허용 중');
  assert.match(v.changed, /2026-11-08T10:00:00Z/); assert.match(v.changed, /admin/);
  assert.equal(v.btnOff, false); assert.equal(v.btn, '변경 ›');
});

test('꺼짐(기본) — 변경 기록 없음', () => {
  const v = dangerView({ data: { allow: false } }, { canAsk: true });
  assert.equal(v.on, false); assert.equal(v.banner, ''); assert.match(v.changed, /없음/);
});

test('원격 제어기 — 읽기 전용 · 켜져 있으면 표시는 그대로', () => {
  const v = dangerView(ON, { remote: true, canAsk: true });
  assert.equal(v.on, true); assert.equal(v.banner, DANGER_BANNER);
  assert.equal(v.btn, '이 노드에서만 변경'); assert.equal(v.btnOff, true);
});

test('TerraDangerAsk 없음 — 단추 비활성 + 터미널 안내', () => {
  const v = dangerView(ON, { canAsk: false });
  assert.equal(v.btnOff, true); assert.ok(v.why.includes(DANGER_SET_HINT));
});

test('unavailable — 켜져 있다고 와도 꺼진 것으로 처리', () => {
  const v = dangerView({ data: { allow: true, unavailable: 'read error' } }, { canAsk: true });
  assert.equal(v.on, false); assert.equal(v.banner, ''); assert.match(v.note, /꺼진 것으로 처리/);
  assert.match(dangerView({ data: { allow: false, unavailable: true } }).note, /스위치 파일 읽기 불가/);
});

test('이전 Terra(op 없음) — 미지원 표시 · 깨지지 않음', () => {
  for (const code of ['MODULE_ROUTE_NOT_FOUND', 'OPERATION_NOT_FOUND', 'NOT_FOUND']) {
    const v = dangerView({ data: null, err: { code } }, { canAsk: true });
    assert.equal(v.state, 'unsupported'); assert.equal(v.status, '이 Terra 판 미지원'); assert.equal(v.btnOff, true); assert.equal(v.on, false);
  }
});

test('다른 오류 · 읽는 중', () => {
  assert.equal(dangerView({ data: null, err: { code: 'TIMEOUT' } }).state, 'error');
  assert.equal(dangerView({ data: null, err: { code: 'TIMEOUT' } }).on, false);
  assert.equal(dangerView({ data: null, err: null, loading: true }).state, 'loading');
});

test('{ok,data} 봉투도 읽는다', () => {
  assert.equal(dangerView({ data: { ok: true, data: { allow: true } } }, { canAsk: true }).on, true);
});
