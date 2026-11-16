// node --test — op 콘솔 순수 함수: 등급 · 목록 · 폼 생성 · 입력 만들기 · 잠금 · 호출 길
import test from 'node:test';
import assert from 'node:assert/strict';
import { tierOf, normalizeCatalog, categories, filterOps, formFields, initialValues, buildInput, buildFree, lockOf, runOp, buttonText, cliLine, resultText } from './op-console.js';
import { gate } from './gates.js';

const cat = (id, execution, extra = {}) => Object.assign({ operationId: id, execution }, extra);

test('등급 — 승인 문 계약이 T3 · T4 를 정하고, 나머지는 위험도 · 확인으로', () => {
  assert.equal(tierOf(cat('a.b.c.get', { risk: 'read' })), 'T0');
  assert.equal(tierOf(cat('a.b.c.patch', { risk: 'write', confirmationMode: 'none' })), 'T1');
  assert.equal(tierOf(cat('a.b.c.post', { risk: 'dangerous' })), 'T2');
  assert.equal(tierOf(cat('a.b.c.post', { risk: 'write', confirmationMode: 'required' })), 'T2');
  assert.equal(tierOf(cat('a.b.c.post', { risk: 'dangerous', approval: { tier: 'T3' } })), 'T3');
  assert.equal(tierOf(cat('a.b.c.post', { risk: 'privileged', approval: { tier: 'T4' } })), 'T4');
  assert.equal(tierOf(cat('a.b.c.get')), 'T0', '위험도 없음 — 읽기 동사만 T0');
  assert.equal(tierOf(cat('a.b.c.post')), 'T1', '위험도 없음 · 쓰기 동사 — 보수적으로 T1');
});

test('카탈로그 → 목록 · 검색 · 분류 · 등급', () => {
  const items = normalizeCatalog({ operations: [
    cat('terra.daemon.modules.get', { risk: 'read' }, { title: '모듈 목록', category: 'daemon · modules' }),
    cat('terra.daemon.config.patch', { risk: 'write' }, { summary: '설정 고치기', category: 'daemon · config', tags: ['config'] }),
    cat('terra.master.nodes.by-node-id.revoke.post', { risk: 'dangerous', approval: { tier: 'T3', impact: '노드 폐기', inputs: ['node_id'], secret_result: ['token'] } }),
    { notAnOp: true },
  ] });
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((o) => o.tier), ['T1', 'T0', 'T3']);   // id 순
  assert.equal(items.find((o) => o.id.includes('revoke')).category, 'master · nodes', '분류가 비면 id 에서');
  assert.deepEqual(items.find((o) => o.id.includes('revoke')).approval, { tier: 'T3', impact: '노드 폐기', inputs: ['node_id'], sw: '', secret: ['token'] });
  assert.deepEqual(filterOps(items, { q: 'config 고치기' }).map((o) => o.id), ['terra.daemon.config.patch']);
  assert.deepEqual(filterOps(items, { q: 'DAEMON' }).length, 2);
  assert.deepEqual(filterOps(items, { tier: 'T3' }).map((o) => o.tier), ['T3']);
  assert.deepEqual(filterOps(items, { cat: 'daemon · modules' }).length, 1);
  assert.deepEqual(categories(items).map((c) => c[1]), [1, 1, 1]);
});

test('스키마 → 폼 칸: 문자열 · 숫자 · 정수 · 불린 · 열거 · 배열 · 객체, 필수 · 기본값', () => {
  const { fields, free } = formFields({ type: 'object', required: ['name'], properties: {
    name: { type: 'string', description: '이름' }, count: { type: 'integer', default: 3 }, ratio: { type: 'number' }, on: { type: 'boolean' },
    mode: { type: 'string', enum: ['a', 'b'] }, tags: { type: 'array', items: { type: 'string' } }, meta: { type: 'object' }, pw: { type: 'string', format: 'password' },
  } });
  assert.equal(free, false);
  assert.deepEqual(fields.map((f) => [f.key, f.kind, f.required]), [['name', 'text', true], ['count', 'number', false], ['ratio', 'number', false], ['on', 'bool', false], ['mode', 'enum', false], ['tags', 'json', false], ['meta', 'json', false], ['pw', 'text', false]]);
  assert.equal(fields[7].secret, true);
  assert.deepEqual(initialValues(fields), { name: '', count: '3', ratio: '', on: 'false', mode: '', tags: '', meta: '', pw: '' });
  assert.deepEqual(formFields(null), { fields: [], free: true }, '스키마 없음 — 자유 JSON');
  assert.deepEqual(formFields({ type: 'object' }), { fields: [], free: true });
});

test('칸 값 → 입력 JSON: 빈 칸은 안 보내고, 필수 · 형식 오류는 칸마다', () => {
  const { fields } = formFields({ type: 'object', required: ['name', 'n'], properties: { name: { type: 'string' }, n: { type: 'integer' }, on: { type: 'boolean' }, mode: { enum: ['a', 'b'] }, tags: { type: 'array' }, meta: { type: 'object' } } });
  let r = buildInput(fields, { name: '', n: '', on: '', mode: '', tags: '', meta: '' });
  assert.equal(r.ok, false); assert.deepEqual(r.errors, { name: '필수', n: '필수' });
  r = buildInput(fields, { name: 'x', n: '1.5', on: 'true', mode: 'c', tags: '{}', meta: '[1]' });
  assert.deepEqual(r.errors, { n: '정수만', mode: '목록에 없는 값', tags: '배열([…])로', meta: '객체({…})로' });
  r = buildInput(fields, { name: 'x', n: '7', on: 'true', mode: 'b', tags: '["u","v"]', meta: '{"k":1}' });
  assert.equal(r.ok, true); assert.deepEqual(r.input, { name: 'x', n: 7, on: true, mode: 'b', tags: ['u', 'v'], meta: { k: 1 } });
  r = buildInput(fields, { name: 'x', n: '7', tags: '[oops' });
  assert.deepEqual(r.errors, { tags: 'JSON 이 아님' });
  assert.deepEqual(buildFree('').input, {}); assert.deepEqual(buildFree('{"a":1}').input, { a: 1 });
  assert.equal(buildFree('[1]').ok, false); assert.equal(buildFree('{x').ok, false);
});

test('잠금 — T0~T2 는 앱 토큰 게이트, T3 · T4 는 승인 문 유무 (게이트가 닫혀 있어도 승인 문이 부른다)', () => {
  const g = (id, o) => gate(id, Object.assign({ who: { allPermissions: true }, app: true }, o));
  // 앱 토큰에 닫힌 Daemon 위임 문 — 잠금 칩 + 이유
  const closed = lockOf({ id: 'terra.daemon.svi.declarations.apply.post', tier: 'T1' }, { gate: g, canApprove: true });
  assert.equal(closed.locked, true); assert.equal(closed.chip, 'app'); assert.match(closed.why, /앱 토큰에 닫힘/); assert.match(closed.why, /terra module call terra\.daemon\.svi\.declarations\.apply\.post/);
  // 위임 표에 없는 Master op — T1 이면 잠김, 같은 op 가 T3 면 승인 문으로 열림
  const mid = 'terra.master.crossboundary.peer-grants.by-grant-id.revoke.post';
  assert.equal(lockOf({ id: 'terra.master.nodes.by-node-id.nobody.post', tier: 'T1' }, { gate: g }).locked, true);
  assert.equal(lockOf({ id: mid, tier: 'T3' }, { gate: g, canApprove: true }).locked, false);
  // 승인 문 없음(단독 실행)
  const door = lockOf({ id: mid, tier: 'T4' }, { gate: g, canApprove: false });
  assert.deepEqual([door.locked, door.chip], [true, 'door']);
  // 열린 읽기 · 시안(게이트 없음)
  assert.equal(lockOf({ id: 'terra.daemon.modules.get', tier: 'T0' }, { gate: g }).locked, false);
  assert.equal(lockOf({ id: 'x.y.z.get', tier: 'T0' }, {}).locked, false);
  // 다른 노드에서 local 전용
  const lo = lockOf({ id: 'terra.daemon.commands.execute.post', tier: 'T2' }, { gate: g, remote: true });
  assert.deepEqual([lo.locked, lo.chip], [true, 'local']);
  // 계정 권한 없음
  const perm = lockOf({ id: 'terra.daemon.config.patch', tier: 'T1' }, { gate: (id, o) => gate(id, Object.assign({ who: { permissions: [] }, app: true }, o)) });
  assert.deepEqual([perm.locked, perm.chip], [true, 'perm']);
});

test('호출 길 — T0 · T1 · T2 는 앱 토큰으로 곧장, T3 · T4 는 승인 문으로만 (페이지가 직접 안 부른다)', async () => {
  const calls = [];
  const d = { invoke: async (rid, op, inp) => { calls.push(['remote', rid, op, inp]); return { r: 1 }; }, invokeLocal: async (op, inp) => { calls.push(['local', op, inp]); return { l: 1 }; },
    approve: async (op, inp) => { calls.push(['door', op, inp]); return { ok: true, status: 200, data: { done: true }, withheld: ['token'] }; }, textOf: (op, e) => 'T:' + e.code };
  let r = await runOp({ item: { id: 'a.b.c.get', tier: 'T0' }, input: { x: 1 } }, d);
  assert.deepEqual([r.ok, r.via, r.data], [true, 'app', { l: 1 }]);
  r = await runOp({ item: { id: 'a.b.c.post', tier: 'T2' }, input: {}, node: 'n-9' }, d);
  assert.deepEqual([r.ok, r.via, r.data], [true, 'app', { r: 1 }]);
  r = await runOp({ item: { id: 'a.b.d.post', tier: 'T4' }, input: { k: 'v' } }, d);
  assert.deepEqual([r.ok, r.via, r.data, r.withheld], [true, 'door', { done: true }, ['token']]);
  assert.deepEqual(calls.map((c) => c[0]), ['local', 'remote', 'door']);
  // 승인 문 없음 · 거절(문구 없음 = 조용히) · 앱 길 오류
  assert.equal((await runOp({ item: { id: 'a.b.d.post', tier: 'T3' }, input: {} }, { ...d, approve: undefined })).code, 'APPROVAL_UNAVAILABLE');
  const no = await runOp({ item: { id: 'a.b.d.post', tier: 'T3' }, input: {} }, { ...d, approve: async () => ({ ok: false, code: 'APPROVAL_REJECTED', message: '', text: '' }) });
  assert.deepEqual([no.ok, no.silent], [false, true]);
  const bad = await runOp({ item: { id: 'a.b.c.get', tier: 'T0' }, input: {} }, { ...d, invokeLocal: async () => { const e = new Error('x'); e.code = 'FORBIDDEN'; throw e; } });
  assert.deepEqual([bad.ok, bad.code, bad.text], [false, 'FORBIDDEN', 'T:FORBIDDEN']);
});

test('글자 — 단추 · CLI · 결과', () => {
  assert.equal(buttonText('T0'), '읽기'); assert.equal(buttonText('T2', true), '한 번 더 눌러 실행'); assert.match(buttonText('T4'), /재인증/);
  assert.equal(cliLine('a.b.c.post', { k: 1 }), "terra module call a.b.c.post --input '{\"k\":1}'");
  assert.equal(cliLine('a.b.c.get'), 'terra module call a.b.c.get');
  assert.match(resultText({ a: 'x'.repeat(50) }, 20), /… \(\d+자 더/);
});
