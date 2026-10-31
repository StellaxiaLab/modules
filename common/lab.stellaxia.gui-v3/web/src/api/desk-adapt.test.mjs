// node --test — 노드 데스크톱의 실제 응답 → 보드 모양(터널 · 등록 · 모듈 로그 · 모듈 앱)
import test from 'node:test';
import assert from 'node:assert/strict';
import { tunnels, enroll, logLines, moduleApps, offers, cfgFields, castCfg, taskOutput, ago } from './desk-adapt.js';

const NOW = Date.parse('2026-10-31T12:00:00Z');

test('tunnels — 로컬 주소에서 포트, 상대는 노드:포트, 열린 지 얼마', () => {
  const r = tunnels({ tunnels: [{ tunnel_id: 't1', service_id: 'ssh', target_node_id: 'nd_b', target_port: 22, local_address: '127.0.0.1:40022', status: 'open', opened_at: '2026-10-31T11:48:00Z' }, { id: 't2', local_bind_host: '127.0.0.1', local_port: '5000' }] }, NOW);
  assert.deepEqual(r[0], { id: 't1', svc: 'ssh', port: 40022, peer: 'nd_b:22', since: '12분 전', st: 'open' });
  assert.equal(r[1].port, 5000); assert.equal(r[1].svc, 'tcp'); assert.equal(r[1].since, '');
  assert.deepEqual(tunnels(null), []);
});

test('enroll — 등록 여부 · Master 주소 · 노드 id, 모르는 칸은 비운다', () => {
  assert.deepEqual(enroll({ enabled: true, registered: true, node_id: 'nd_a', master_url: 'http://m:8080', registered_at: '2026-09-14T03:00:00Z', credential_ready: true }),
    { st: '등록됨', parent: 'http://m:8080', id: 'nd_a', at: '2026-09-14', real: true, registered: true, cred: '준비됨' });
  assert.equal(enroll({ enabled: true, registered: false }).st, '등록 안 됨');
  assert.equal(enroll({ enabled: false }).st, '등록 꺼짐');
  assert.equal(enroll(undefined).id, '');
});

test('logLines — Daemon { lines:[{at,stream,text}] } · Gateway { logs:[글] }, 수준은 글에서', () => {
  const r = logLines({ lines: [{ at: '2026-10-31T09:12:03Z', stream: 'stdout', text: 'started' }, { at: 'x', stream: 'stderr', text: 'level=error boom' }, { text: 'WARN slow' }] });
  assert.equal(r[0].msg, 'started'); assert.equal(r[0].cls, 'info'); assert.match(r[0].t, /^\d\d:\d\d:\d\d$/);
  assert.equal(r[1].cls, 'err'); assert.equal(r[1].t, '');
  assert.equal(r[2].cls, 'warn');
  assert.deepEqual(logLines({ logs: ['a'] }), [{ t: '', cls: 'info', msg: 'a' }]);
});

test('moduleApps — 그 모듈의 앱만, embed 앱(Scene 안에서만)은 뺀다, 상태는 모듈에서', () => {
  const list = { apps: [{ id: 'io.terra.agent.chat', moduleId: 'io.terra.agent', name: '대화' }, { id: 'lab.stellaxia.gui-v3.web', moduleId: 'lab.stellaxia.gui-v3', embed: 'scene' }, { id: 'x.y', moduleId: 'x' }] };
  assert.deepEqual(moduleApps(list, 'io.terra.agent', true), [{ id: 'io.terra.agent.chat', name: '대화', health: '정상', full: true }]);
  assert.deepEqual(moduleApps(list, 'lab.stellaxia.gui-v3', true), []);
  assert.equal(moduleApps(list, 'io.terra.agent', false)[0].health, '멈춤');
});

test('ago', () => { assert.equal(ago('2026-10-31T11:59:30Z', NOW), '방금'); assert.equal(ago('2026-10-29T12:00:00Z', NOW), '2일 전'); assert.equal(ago('', NOW), ''); });

test('offers — Daemon 동의 상태를 보드의 세 칸으로, 권한 · 지정한 쪽은 그대로', () => {
  const r = offers({ offers: [{ module_id: 'io.terra.agent', version: '0.6.2', state: 'offered', permissions: ['node.read'], pinned_by: 'admin' }, { module_id: 'b', state: 'accepted' }, { module_id: 'c', state: 'managed', policy: 'auto' }, { module_id: 'd', state: 'stale' }] });
  assert.deepEqual(r[0], { id: 'io.terra.agent', name: 'io.terra.agent', ver: '0.6.2', size: '', by: 'admin', perms: ['node.read'], st: 'wait', state: 'offered' });
  assert.deepEqual(r.map((x) => x.st), ['wait', 'consent', 'done', 'wait']);
  assert.equal(r[2].by, 'auto');
  assert.deepEqual(offers({}), []);
});

test('cfgFields — 스키마 최상위 키가 칸, 비밀은 빼고, 값이 없으면 기본값, 재시작 표시', () => {
  const schema = { schema: { type: 'object', properties: {
    maxFileMB: { type: 'integer', default: 8, title: '파일 하나 한도 (MiB)', 'x-terra-restart': true },
    mode: { type: 'string', enum: ['a', 'b'], default: 'a' }, on: { type: 'boolean' }, tags: { type: 'array' },
    token: { type: 'string', 'x-terra-secret': true }, key2: { type: 'string' } } }, secret_keys: ['key2'] };
  const r = cfgFields(schema, { values: { maxFileMB: 16, tags: ['x'], on: true }, revision: 3, restart_pending: true });
  assert.deepEqual(r.fields, [['maxFileMB', '파일 하나 한도 (MiB)', 'text', '16', null, true, 'integer'], ['mode', 'mode', 'sel', 'a', ['a', 'b'], false, 'string'], ['on', 'on', 'bool', true, null, false, 'boolean'], ['tags', 'tags', 'text', '["x"]', null, false, 'json']]);
  assert.deepEqual(r.secrets.sort(), ['key2', 'token']); assert.equal(r.revision, 3); assert.equal(r.restartPending, true);
  assert.deepEqual(cfgFields(null, null).fields, []);
});

test('castCfg — 저장할 때 스키마 형으로, 틀리면 화면 말', () => {
  assert.equal(castCfg(['n', 'N', 'text', '', null, false, 'integer'], '12'), 12);
  assert.throws(() => castCfg(['n', 'N', 'text', '', null, false, 'integer'], '1.5'), /정수/);
  assert.deepEqual(castCfg(['t', 'T', 'text', '', null, false, 'json'], '["a"]'), ['a']);
  assert.throws(() => castCfg(['t', 'T', 'text', '', null, false, 'json'], '[a'), /JSON/);
  assert.equal(castCfg(['s', 'S', 'text', '', null, false, 'string'], 'x'), 'x');
  assert.equal(castCfg(['b', 'B', 'bool', true, null, false, 'boolean'], false), false);
});

test('taskOutput — 조각을 줄로, stderr 는 표시, 버린 것 · 안 남김은 말로', () => {
  const r = taskOutput({ captured: true, state: 'running', chunks: [{ seq: 1, stream: 'stdout', text: 'a\n' }, { seq: 2, stream: 'stderr', text: 'b\n' }], dropped: { bytes: 10 } });
  assert.equal(r.text, 'a\n! b'); assert.match(r.note, /10바이트/); assert.equal(r.done, false);
  assert.equal(taskOutput({ captured: false, complete: true }).note, '이 작업은 출력을 남기지 않는다');
  assert.equal(taskOutput(null).text, '');
});
