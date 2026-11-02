// node --test — 자원화 틀: 스키마 → 칸 · 검사 · 선언 입력 · 울타리 · 이을 수 있나 · 연결 상태 · 끌어다 놓기의 본인 허가
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TYPES, moduleTypes, formFields, validate, toDeclaration, envelopeCheck, envelopeLines, canLink, bindingState, createSviMake } from './svi-make.js';

const T = (id) => BUILTIN_TYPES.find((t) => t.id === id);

test('스키마 → 칸 — 고르기 · 경로 · 목록 · 필수 · 기본값', () => {
  const F = formFields(T('process').schema, { command: '/usr/bin/ffmpeg', args: ['-i', 'x'] });
  assert.deepEqual(F.map((f) => [f.key, f.kind, f.required]), [['command', 'path', true], ['args', 'list', false], ['direction', 'enum', false]]);
  assert.equal(F[1].value, '-i x'); assert.equal(F[2].value, 'source'); assert.equal(F[2].options[1].label, '입력을 받음');
});

test('검사 — 이름 꼴 · 필수 · 절대 경로 · 주소 꼴', () => {
  assert.deepEqual(validate(T('file').schema, 'Cam', {}), { name: '소문자 · 숫자 · - 만(앞뒤는 - 아님)', path: '필요하다' });
  assert.deepEqual(validate(T('file').schema, 'log', { path: 'logs/a.txt' }), { path: '절대 경로여야 한다' });
  assert.deepEqual(validate(T('file').schema, 'log', { path: 'C:\\data\\a.txt' }), {});
  assert.deepEqual(validate(T('net').schema, 'cam-rtsp', { address: 'rtsp://10.0.0.5:554' }), { address: '꼴이 맞지 않는다' });
  assert.deepEqual(validate(T('net').schema, 'cam-rtsp', { address: 'tcp://10.0.0.5:554' }), {});
});

test('선언 입력 — Daemon svi.declarations.post 의 꼴 그대로, 모듈 유형은 거절', () => {
  assert.deepEqual(toDeclaration(T('net'), 'cam', { address: 'tcp://10.0.0.5:554', mode: 'connect' }), { family: 'net', name: 'cam', direction: 'source', address: 'tcp://10.0.0.5:554', mode: 'connect', framing: 'chunk' });
  assert.deepEqual(toDeclaration(T('process'), 'enc', { command: '/usr/bin/ffmpeg', args: '-f mpegts -', direction: 'sink' }, { replace: true }), { family: 'process', name: 'enc', direction: 'sink', command: '/usr/bin/ffmpeg', args: ['-f', 'mpegts', '-'], replace: true });
  const M = moduleTypes([{ id: 'io.lab.cam', contributions: { svi: { types: [{ id: 'rtsp', title: '카메라', schema: { properties: { url: { type: 'string' } } } }] } } }, { id: 'x', contributions: { svi: { resources: true } } }]);
  assert.deepEqual(M.map((t) => [t.id, t.title, t.family]), [['io.lab.cam/rtsp', '카메라', null]]);
  assert.throws(() => toDeclaration(M[0], 'c', {}), /Terra 에 아직 없다/);
});

test('울타리 — 열린 폴더 밖 · 프로그램 닫힘 · 허락 목록 · 요약', () => {
  const env = { file_roots: [{ path: '/srv/share', mode: 'ro' }], process: 'allowlist', process_commands: ['/usr/bin/ffmpeg'], net: false, net_endpoints: [] };
  assert.equal(envelopeCheck(env, T('file'), { path: '/srv/share/a.txt' }).ok, true);
  assert.match(envelopeCheck(env, T('file'), { path: '/etc/passwd' }).why, /열린 폴더 밖 — \/srv\/share/);
  assert.match(envelopeCheck(env, T('process'), { command: '/bin/sh' }).why, /허락된 프로그램이 아니다/);
  assert.match(envelopeCheck(env, T('net'), {}).why, /닫아 두었다/);
  assert.deepEqual(envelopeLines(env)[0], ['파일', '/srv/share (ro)']);
});

test('이을 수 있나 — 방향 · 상호작용 · 형식 이름 · 판', () => {
  const s = { resId: 'a', dir: 'source', interaction: 'stream', schema: 'terra.bytes@1' }, k = { resId: 'b', dir: 'sink', interaction: 'stream', schema: 'terra.bytes@1' };
  assert.equal(canLink(s, k).ok, true);
  assert.match(canLink(k, s).why, /원천이 내보내지 않는다/);
  assert.match(canLink(s, { ...k, interaction: 'command' }).why, /stream → command/);
  assert.match(canLink(s, { ...k, schema: 'terra.video@1' }).why, /형식이 다르다/);
  assert.equal(canLink(s, { ...k, schema: 'terra.bytes@2' }).why, '판이 달라 변환이 필요할 수 있다');
});

test('연결 상태 — 연결됨 · 끊김(사유) · 실패 · 닫힘 · 연결 중, 유휴는 보고 없음(null)', () => {
  assert.deepEqual([bindingState({ observed_state: 'active' }).label, bindingState({ observed_state: 'degraded', reason: 'participant_disconnected' }).reason], ['연결됨', '한쪽 노드 연결 끊김']);
  assert.equal(bindingState({ observed_state: 'failed', reason: 'target_prepare_failed: port busy' }).reason, 'target_prepare_failed: port busy');
  assert.equal(bindingState({ observed_state: 'closed', reason: 'source_completed' }).reason, '원천이 끝남(파일 끝 등)');
  assert.equal(bindingState({ observed_state: 'planning' }).label, '연결 중'); assert.equal(bindingState({ observed_state: 'active' }).idle, null);
});

test('끌어다 놓기 — 없는 본인 허가(bind.source · bind.target)만 주고 bindings.post', async () => {
  const calls = [];
  const terra = { invoke: async (op, input) => { calls.push([op, input]); if (op === 'terra.master.svi.grants.get') return { items: input.subject_id ? [{ resource_id: 'src', operations: ['bind.source'], subject: { type: 'user', id: 'u1' } }] : [{ subject: { type: 'user', id: 'u1' } }] }; return { binding_id: 'b1' }; } };
  const S = createSviMake(terra, () => ({ localId: 'n1' }), () => ({ principal: 'u1 via gui' }));
  const r = await S.link({ resId: 'src', epId: 'out', dir: 'source', interaction: 'stream' }, { resId: 'dst', epId: 'in', dir: 'sink', interaction: 'stream' });
  assert.equal(r.binding_id, 'b1');
  const posts = calls.filter(([op]) => op === 'terra.master.svi.grants.post').map(([, i]) => [i.subject_id, i.resource_id, i.operations[0], i.ttl_seconds]);
  assert.deepEqual(posts, [['u1', 'dst', 'bind.target', 604800]]);
  const b = calls.find(([op]) => op === 'terra.master.svi.bindings.post')[1]; assert.equal(b.source_endpoint_id, 'out'); assert.match(b.idempotency_key, /^gui-v3-/);
  await assert.rejects(S.link({ resId: 'x', dir: 'sink' }, { resId: 'y', dir: 'sink' }), /원천이 내보내지 않는다/);
});

test('load — 원격 노드의 선언은 중계, 실패한 읽기는 miss', async () => {
  const calls = [];
  const terra = { invoke: async (op, input, at = {}) => { calls.push([op, at.node || '']); if (op === 'terra.master.svi.bindings.get') throw Object.assign(new Error(), { code: 'DELEGATION_NOT_OPEN' });
    if (op === 'terra.daemon.svi.declarations.get') return { envelope: { file_roots: ['/srv'] }, declarations: [{ family: 'file', name: 'log', direction: 'source', path: '/srv/a', state: 'applied', resource_id: 'r1' }] };
    if (op === 'terra.master.svi.resources.get') return { items: [{ resource_id: 'r1', display_name: 'log', node_id: 'n2', endpoints: [{ endpoint_id: 'out', direction: 'source', interaction: 'stream', output_schema: 'terra.bytes@1' }] }] };
    return { items: [] }; } };
  const v = await createSviMake(terra, () => ({ localId: 'n1' }), () => null).load('n2');
  assert.equal(calls.find(([op]) => op === 'terra.daemon.svi.declarations.get')[1], 'n2');
  assert.deepEqual(v.miss, ['연결 DELEGATION_NOT_OPEN']); assert.equal(v.decls[0].detail, '/srv/a'); assert.equal(v.eps[0].schema, 'terra.bytes@1');
});
