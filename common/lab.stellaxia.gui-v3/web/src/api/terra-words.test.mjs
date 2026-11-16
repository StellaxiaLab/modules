// node --test — Terra 터미널 낱말 확장(P17-2): 낱말 해석 · 등급 분기 · 거절 · 변수 · 출력 꼴
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShells } from './shells.js';
import { TERRA_WORDS, lookup, parseArgs, coerce, expandVars, formatResult, posOf } from './terra-words.js';
import { formFields, buildInput } from './op-console.js';
import { gate } from './gates.js';

const NODES = [{ node_id: 'n-desk-0001', display_name: 'desk' }, { node_id: 'n-srv-0002', display_name: 'server' }];
const fake = (h = {}) => { const calls = []; return { calls, invoke: async (op, input = {}, at = {}) => { calls.push([op, input, at.node || '']); if (op === 'terra.master.nodes.get') return NODES; const f = h[op]; if (f === undefined) return { ok: true }; return typeof f === 'function' ? f(input, at) : f; } }; };
const topo = () => ({ localId: 'n-desk-0001' });
const open = () => ({ open: true });
const mk = (T, deps = {}) => createShells(T, topo, Object.assign({ gate: open, canApprove: () => true, words: EXTRA }, deps));
const EXTRA = [{ cmd: 'zz grant', cls: 'A', tier: 'T3', kind: 'op', op: 'terra.master.zz.grants.post', pos: [], node: false }, { cmd: 'zz core', cls: 'A', tier: 'T4', kind: 'op', op: 'terra.master.zz.core.post', pos: [], node: false }];
const text = (r) => r.lines.map((l) => l.t).join('\n');
const W = (cmd) => TERRA_WORDS.find((w) => w.cmd === cmd);

test('낱말 표 — O · A · R 만, kind 마다 필수 칸이 있고 op 낱말은 id 마디에서 위치 인자를 얻는다', () => {
  assert.ok(TERRA_WORDS.length > 150);
  const cmds = new Set();
  for (const w of TERRA_WORDS) {
    assert.ok(['O', 'A', 'R'].includes(w.cls), w.cmd); assert.ok(!cmds.has(w.cmd), '중복 ' + w.cmd); cmds.add(w.cmd);
    assert.ok(['op', 'multi', 'stream', 'direct', 'shape'].includes(w.kind), w.cmd);
    assert.match(w.tier, /^T[0-4]$/, w.cmd);
    if (w.kind === 'op') { assert.match(w.op, /^terra\.|^lab\./, w.cmd); assert.deepEqual(w.pos, posOf(w.op)); assert.equal(w.node, w.op.startsWith('terra.daemon.'), w.cmd); }
    if (w.kind === 'multi') assert.ok(Array.isArray(w.ops), w.cmd);
  }
  assert.deepEqual(posOf('terra.daemon.io.devices.by-device-id.alias.post'), ['device_id']);
});

test('lookup · parseArgs — 가장 긴 앞부분 · 위치 인자 · 이름=값 · --플래그 · node=', () => {
  const h = lookup(['daemon', 'io', 'device', 'alias', 'dev-1', 'desk-cam']);
  assert.equal(h.word.cmd, 'daemon io device alias'); assert.deepEqual(h.rest, ['dev-1', 'desk-cam']);
  assert.equal(lookup(['module', 'config', 'show', 'x']).word.cmd, 'module config show');
  assert.equal(lookup(['module', 'zzz']), null);
  const w = W('daemon io device alias');
  assert.deepEqual(parseArgs(w, ['dev-1', 'alias=cam', 'node=server', '--force']).input, { device_id: 'dev-1', alias: 'cam', force: 'true' });
  assert.equal(parseArgs(w, ['dev-1', 'node=server']).node, 'server');
  assert.match(parseArgs(w, []).errors.join(), /device_id — 필요/);
});

test('coerce — 스키마가 있으면 칸 꼴로, 모르는 칸 · 비밀 칸을 가린다', () => {
  const schema = { type: 'object', required: ['id'], properties: { id: { type: 'string' }, n: { type: 'integer' }, on: { type: 'boolean' }, pw: { type: 'string', format: 'password' } } };
  assert.deepEqual(coerce({ id: 'a', n: '3', on: 'true' }, schema, { formFields, buildInput }), { ok: true, input: { id: 'a', n: 3, on: true }, secret: [] });
  assert.equal(coerce({ id: 'a', zz: '1' }, schema, { formFields, buildInput }).ok, false);
  assert.equal(coerce({ id: 'a', n: 'x' }, schema, { formFields, buildInput }).ok, false);
  assert.deepEqual(coerce({ id: 'a', pw: 's' }, schema, { formFields, buildInput }).secret, ['pw']);
  assert.deepEqual(coerce({ a: '1' }, null, { formFields, buildInput }), { ok: true, input: { a: '1' }, secret: [] });
});

test('T0 — 곧장 부르고 표로 보인다 · set output json 은 JSON', async () => {
  const T = fake({ 'terra.master.route.policies.get': { policies: [{ id: 'p1', mode: 'prefer' }, { id: 'p2', mode: 'deny' }] } });
  const S = mk(T);
  const r = await S.terra.run('route policy list');
  assert.deepEqual(T.calls.at(-1), ['terra.master.route.policies.get', {}, '']);
  assert.match(text(r), /id\s+mode/); assert.match(text(r), /p1\s+prefer/); assert.match(text(r), /↳ terra\.master\.route\.policies\.get · T0/);
  await S.terra.run('set output json');
  assert.match(text(await S.terra.run('route policy list')), /"policies": \[/);
  await assert.rejects(S.terra.run('set output xml'), (e) => e.code === 'BAD_INPUT');
});

test('T1 — 확인 없이 곧장 · 위치 인자가 입력이 되고 daemon op 는 use 한 노드로', async () => {
  const T = fake(), S = mk(T), cx = { cur: 'n-srv-0002' };
  await S.terra.run('daemon io device approve dev-9', cx);
  assert.deepEqual(T.calls.at(-1), ['terra.daemon.io.devices.by-device-id.approve.post', { device_id: 'dev-9' }, 'n-srv-0002']);
  await S.terra.run('daemon io device approve dev-9 node=desk', cx);   // 이 노드 = 노드 지정 없음
  assert.deepEqual(T.calls.at(-1), ['terra.daemon.io.devices.by-device-id.approve.post', { device_id: 'dev-9' }, '']);
});

test('T2 — yes 전에는 부르지 않고, yes 에서 한 번만 · no · 다른 줄은 대기를 버린다', async () => {
  const T = fake(), S = mk(T), n0 = () => T.calls.filter(([o]) => o.includes('modules.by-module-id.stop')).length;
  const r = await S.terra.run('module stop io.terra.x');
  assert.equal(n0(), 0); assert.match(text(r), /확인 — terra\.daemon\.modules\.by-module-id\.stop\.post \(T2 앱 확인\)/); assert.match(text(r), /yes/); assert.equal(r.lines[0].c, 'warn');
  const y = await S.terra.run('yes'); assert.equal(n0(), 1); assert.match(text(y), /T2/);
  await assert.rejects(S.terra.run('yes'), (e) => e.code === 'NOT_FOUND');   // 대기는 한 번만
  await S.terra.run('module stop io.terra.x'); assert.match(text(await S.terra.run('no')), /취소/); assert.equal(n0(), 1);
  await S.terra.run('module stop io.terra.x'); await S.terra.run('echo 다른줄'); await assert.rejects(S.terra.run('yes'), (e) => e.code === 'NOT_FOUND'); assert.equal(n0(), 1);
});

test('T3 · T4 — 승인 문으로만(앱 토큰 호출 없음) · 문 없으면 거절 · 사람이 거절하면 조용히', async () => {
  // 표에는 O · A · R 의 T3 · T4 가 없다 — 길만 시험한다(deps.words 로 시험용 낱말을 더한다)
  {
    const T = fake(), asked = [];
    const S = mk(T, { approve: async (op, inp) => { asked.push([op, inp]); return { ok: true, data: { done: 1 }, withheld: ['token'] }; } });
    const r = await S.terra.run('zz grant who=alice');
    assert.deepEqual(asked, [['terra.master.zz.grants.post', { who: 'alice' }]]); assert.ok(!T.calls.some(([o]) => o.startsWith('terra.master.zz')), '앱 토큰으로 안 불렀다');
    assert.match(text(r), /T3 승인 문 · 승인 문/); assert.match(text(r), /숨김 : token/);
    await S.terra.run('zz core'); assert.equal(asked.at(-1)[0], 'terra.master.zz.core.post');
    await assert.rejects(mk(T, { canApprove: () => false }).terra.run('zz grant'), (e) => e.code === 'LOCKED_OP' && /승인 문 없음/.test(e.message));
    assert.match(text(await mk(T, { approve: async () => ({ ok: false, code: 'DENIED', text: '' }) }).terra.run('zz grant')), /승인 거절됨/);
    await assert.rejects(mk(T, { approve: async () => ({ ok: false, code: 'APPROVAL_EXPIRED', text: '승인 시간 지남' }) }).terra.run('zz grant'), (e) => e.code === 'APPROVAL_EXPIRED' && /승인 시간/.test(e.message));
  }
});

test('거절 — 앱 토큰에 닫힌 op(문) · multi · stream · direct · shape · 비밀 칸 · 인자 오류, 아무것도 안 부른다', async () => {
  const T = fake(), closed = (op) => (op === 'terra.master.fleets.post' ? { open: false, needs: 'core', why: '잠김 : 코어가 앱 토큰에 열지 않음' } : { open: true });
  const S = mk(T, { gate: closed });
  await assert.rejects(S.terra.run('master fleet create'), (e) => e.code === 'LOCKED_OP' && /앱 토큰에 닫힘/.test(e.message) && /terra module call terra\.master\.fleets\.post/.test(e.message));
  for (const [line, re] of [['task cancel t-1', /작업 관리자/], ['daemon io watch', /스트림/], ['auth login', /비밀번호/], ['module ops', /op 콘솔/], ['file rm desk:root/x', /인자 꼴/], ['daemon io device alias', /device_id — 필요/], ['daemon io device alias a b c', /받는 자리 없음/], ['daemon io device get d node=nobody', /Master 노드 목록에 없음|여러 노드/]])
    await assert.rejects(S.terra.run(line), (e) => e instanceof Error && re.test(e.message), line);
  await assert.rejects(S.terra.run('master fleet list node=desk'), (e) => e.code === 'BAD_INPUT' && /노드 지정 없는/.test(e.message));
  const sec = mk(T, { describe: async () => ({ input: { type: 'object', properties: { device_id: { type: 'string' }, alias: { type: 'string', format: 'password' } } } }) });
  await assert.rejects(sec.terra.run('daemon io device alias d1 alias=zz'), (e) => /비밀 값/.test(e.message));
  assert.ok(!T.calls.some(([o]) => /fleets\.post|alias|cancel/.test(o)), '막힌 것은 부르지 않았다');
});

test('실제 문(gate) — 위임표에 없는 master op 낱말은 잠기고, 위임표에 있는 것은 열린다', async () => {
  const closed = TERRA_WORDS.find((w) => w.kind === 'op' && w.op.startsWith('terra.master.') && w.tier !== 'T3' && w.tier !== 'T4' && !gate(w.op, { app: true }).open);
  const T = fake(), S = mk(T, { gate: (op, o) => gate(op, Object.assign({ app: true }, o)) });
  if (closed) { await assert.rejects(S.terra.run(closed.cmd + ' ' + (closed.pos || []).map((p) => p + '1').join(' ')), (e) => e.code === 'LOCKED_OP'); assert.equal(T.calls.length, 0); }
  const opened = TERRA_WORDS.find((w) => w.kind === 'op' && w.tier === 'T0' && w.op.startsWith('terra.master.') && gate(w.op, { app: true }).open);
  assert.ok(opened, '앱 토큰에 열린 T0 master 낱말이 하나는 있다');
  await S.terra.run(opened.cmd + ' ' + (opened.pos || []).map((p) => p + '1').join(' '));
  assert.equal(T.calls.at(-1)[0], opened.op);
});

test('변수 · echo · vars — $이름은 줄을 가르기 전에 펼치고, 값은 낱말 하나, 셸 문법은 여전히 거절', async () => {
  const S = mk(fake());
  assert.match(text(await S.terra.run('set n=desk')), /n = desk/);
  assert.equal(text(await S.terra.run('echo hi $n')), 'hi desk');
  assert.match(text(await S.terra.run('vars')), /output = table[\s\S]*n = desk/);
  assert.match(text(await S.terra.run('set m $n')), /m = desk/);
  await assert.rejects(S.terra.run('echo $nope'), (e) => e.code === 'BAD_INPUT' && /변수 없음/.test(e.message));
  for (const bad of ['set x=a;b', 'set x="a"', 'set 1x=a', 'set x=$(id)']) await assert.rejects(S.terra.run(bad), (e) => ['SHELL_SYNTAX', 'BAD_INPUT'].includes(e.code), bad);
  for (const bad of ['echo ${n}', 'echo $(id)', 'echo `id`']) await assert.rejects(S.terra.run(bad), (e) => e.code === 'SHELL_SYNTAX', bad);
  await S.terra.run('unset n'); assert.doesNotMatch(text(await S.terra.run('vars')), /n = desk/);
  assert.equal(expandVars('a $x b', { x: '1' }), 'a 1 b');
});

test('help — 접두 검색은 명령 · 등급 · operation 을 보인다', async () => {
  const S = mk(fake());
  const t = text(await S.terra.run('help daemon io device'));
  assert.match(t, /daemon io device alias\s+T1/); assert.match(t, /terra\.daemon\.io\.devices\.by-device-id\.alias\.post/);
  assert.match(text(await S.terra.run('help zzzz')), /없음/);
});

test('formatResult — 객체 배열은 표 · 객체는 이름/값 · json 은 그대로 · 긴 결과는 잘림', () => {
  assert.deepEqual(formatResult([{ a: 1, b: 'x' }, { a: 22, b: null }]).map((s) => s.replace(/\s+/g, ' ')), ['a b', '1 x', '22 —']);
  assert.match(formatResult({ id: 'n1', up: true })[0], /^id\s+n1$/);
  assert.deepEqual(formatResult([], 'table'), ['(없음)']);
  assert.equal(formatResult({ a: 1 }, 'json')[0], '{');
  assert.equal(formatResult(Array.from({ length: 500 }, (_, i) => ({ i })), 'table', 10).length, 11);
});

test('손 낱말은 그대로 — status · node list 는 표 낱말이 아니라 손 낱말이 맡는다(합성 명령)', async () => {
  const S = mk(fake({ 'terra.daemon.status.get': { daemon: { node_id: 'n-desk-0001' } } }));
  assert.match(text(await S.terra.run('node list')), /desk/); assert.match(text(await S.terra.run('status')), /Gateway/);
});
