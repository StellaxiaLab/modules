// 모듈 설정(Terra B-6 설정 — maingui A-29) — 모듈 앱의 수정 폼 = 모듈이 선언한 configuration.schema 의 칸.
//   npm test
// 모양은 Terra main Daemon 계약에서 확인했다: config.schema.get → { module_id, version, schema_sha256, schema, secret_keys } ·
// config.get → { module_id, revision, values, secrets: { k: { set } }, invalid_keys, restart_pending } ·
// config.patch { module_id(경로), values, unset, base_revision } → 202 { module_id, revision, changed, restart, restart_error?, module } ·
// 거절 400 MODULE_CONFIG_INVALID { error: { detail: { keys: [{ key, code, message }] } } } · 409 MODULE_CONFIG_REVISION_CONFLICT · 404 MODULE_CONFIG_UNDECLARED
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TerraClient } = await import('../src/api/client.js');
const { LiveSource } = await import('../src/api/source.js');
const { cfgForm, cfgPatch, cfgErrorKeys, CRUD_TEXT } = await import('../src/api/operations.js');
const { wireHelm, formValues } = await import('../src/api/wire.js');
const { prep } = await import('../src/boot/module.js');
const { default: NodeScreen } = await import('../src/screens/node.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const opOf = (url) => decodeURIComponent((/\/operations\/([^/]+)\/invoke$/.exec(url) || [])[1] || '');
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url, op: opOf(url), body: init.body ? JSON.parse(init.body) : null }); return answer(calls.at(-1)); };
  f.calls = calls;
  return f;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA = {
  module_id: 'lab.cfgtest', version: '0.1.0', schema_sha256: 'a'.repeat(64), secret_keys: ['token'],
  schema: { type: 'object', required: ['poll_ms'], properties: {
    poll_ms: { type: 'integer', title: '읽기 간격 (ms)', minimum: 10, default: 50 },
    mode: { enum: ['relative', 'absolute'], default: 'relative' },
    share: { type: 'boolean', title: '커서 공유', default: true },
    label: { type: 'string', description: '보이는 이름' },
    tags: { type: 'array', items: { type: 'string' } },
    token: { type: 'string', title: '중계 토큰', 'x-terra-secret': true }
  } }
};
const VALUES = { module_id: 'lab.cfgtest', revision: 3, values: { poll_ms: 80, tags: ['a'] }, secrets: { token: { set: true } }, invalid_keys: [], restart_pending: false };

test('cfgForm — 스키마 → 폼 칸(수 · 고르기 · 예/아니오 · 글 · 비밀). 값은 저장된 것, 없으면 기본값 · 비밀은 설정됐는지만', () => {
  const c = cfgForm(SCHEMA, VALUES);
  assert.deepEqual(c.fields.map((f) => [f.k, f.type]), [['poll_ms', 'num'], ['mode', 'sel'], ['share', 'bool'], ['label', 'text'], ['tags', 'text'], ['token', 'secret']]);
  assert.deepEqual(c.fields.map((f) => f.label), ['읽기 간격 (ms) *', 'mode', '커서 공유', 'label', 'tags', '중계 토큰 🔒']);
  assert.equal(c.fields[0].ph, '기본 50');
  assert.equal(c.fields[3].ph, '보이는 이름');
  assert.equal(c.fields[5].ph, '설정됨 — 비워 두면 그대로');
  assert.deepEqual(c.vals, { poll_ms: '80', mode: 'relative', share: true, label: '', tags: '["a"]', token: '' });
  assert.deepEqual([c.revision, c.required, c.restartPending], [3, ['poll_ms'], false]);
  assert.equal(cfgForm(SCHEMA, Object.assign({}, VALUES, { secrets: {} })).fields[5].ph, '비밀 값 (보이지 않는다)');
});

test('cfgPatch — 바뀐 키만 · 비우면 unset · 비밀은 적었을 때만 · 수 · JSON 은 그 모양으로(아니면 글 그대로 — 서버가 키로 말한다) · base_revision', () => {
  const item = { id: 'lab.cfgtest', cfg: cfgForm(SCHEMA, VALUES) };
  assert.equal(cfgPatch(item, item.cfg.vals), null, '손대지 않았다');
  assert.deepEqual(cfgPatch(item, Object.assign({}, item.cfg.vals, { poll_ms: ' 120 ', share: false, tags: '["a","b"]' })),
    { module_id: 'lab.cfgtest', base_revision: 3, values: { poll_ms: 120, share: false, tags: ['a', 'b'] } });
  assert.deepEqual(cfgPatch(item, Object.assign({}, item.cfg.vals, { poll_ms: '' })), { module_id: 'lab.cfgtest', base_revision: 3, unset: ['poll_ms'] }, '비우면 기본값으로');
  assert.equal(cfgPatch(item, Object.assign({}, item.cfg.vals, { label: '   ' })), null, '저장된 적 없는 칸을 비워도 바뀐 것이 없다');
  assert.deepEqual(cfgPatch(item, Object.assign({}, item.cfg.vals, { token: 's3cret' })).values, { token: 's3cret' });
  assert.deepEqual(cfgPatch(item, Object.assign({}, item.cfg.vals, { poll_ms: '1.5' })).values, { poll_ms: '1.5' }, '정수가 아니면 글 그대로');
  assert.deepEqual(cfgPatch(item, Object.assign({}, item.cfg.vals, { mode: 'absolute' })).values, { mode: 'absolute' });
  assert.equal(cfgPatch({ id: 'x' }, {}), null);
  assert.equal(cfgErrorKeys({ data: { error: { code: 'MODULE_CONFIG_INVALID', detail: { keys: [{ key: 'poll_ms', code: 'minimum', message: 'must be >= 10' }, { key: 'zz', code: 'unknown' }] } } } }), 'poll_ms — must be >= 10 · zz');
  assert.match(CRUD_TEXT.mod.edit, /config\.patch/);
});

/** 설정 서버 — schema · get · patch(409 · 400 도) */
function cfgServer(o = {}) {
  let rev = VALUES.revision;
  return fakeFetch((c) => {
    if (c.op.endsWith('config.schema.get')) return o.undeclared ? json(404, { error: { code: 'MODULE_CONFIG_UNDECLARED', message: 'no configuration' } }) : json(200, { status: 'ok', data: SCHEMA });
    if (c.op.endsWith('config.get')) return json(200, { status: 'ok', data: Object.assign({}, VALUES, { revision: rev }) });
    if (c.op.endsWith('config.patch')) {
      if (o.conflict) return json(409, { error: { code: 'MODULE_CONFIG_REVISION_CONFLICT', message: 'revision moved' } });
      if (o.invalid) return json(400, { error: { code: 'MODULE_CONFIG_INVALID', message: 'module configuration is invalid', detail: { keys: [{ key: 'poll_ms', code: 'minimum', message: 'must be >= 10' }] } } });
      rev++;
      return json(202, { status: 'accepted', data: { module_id: 'lab.cfgtest', revision: rev, changed: Object.keys(c.body.values || {}).concat(c.body.unset || []), restart: true, module: { id: 'lab.cfgtest', state: 'running' } } });
    }
    if (c.op === 'terra.daemon.modules.get') return json(200, { status: 'ok', data: { modules: [{ id: 'lab.cfgtest', name: 'cfg test', state: 'running' }, { id: 'io.terra.file', name: 'Terra File', state: 'running' }] } });
    return json(200, { status: 'ok', data: {} });
  });
}

test('source — modConfig 는 스키마 · 값을 받아 폼 모양으로(다른 노드는 노드 주소 호출). 선언이 없으면 cfg 없이 그 이유 · 저장은 바뀐 키만', async () => {
  const f = cfgServer();
  const source = new LiveSource(new TerraClient('', { fetch: f }), { localNode: 'leaf-a', localId: 'node_a', idOf: (n) => (n === 'leaf-b' ? 'node_b' : null) });
  const { cfg } = await source.modConfig('leaf-a', 'lab.cfgtest');
  assert.deepEqual(f.calls.map((c) => [c.op, c.body]), [['terra.daemon.modules.by-module-id.config.schema.get', { module_id: 'lab.cfgtest' }], ['terra.daemon.modules.by-module-id.config.get', { module_id: 'lab.cfgtest' }]]);
  assert.equal(cfg.fields.length, 6);
  const r = await source.crud('leaf-a', 'mod', 'update', Object.assign({}, cfg.vals, { poll_ms: '120' }), { id: 'lab.cfgtest', name: 'cfg test', cfg });
  assert.deepEqual([f.calls.at(-1).op, f.calls.at(-1).body], ['terra.daemon.modules.by-module-id.config.patch', { module_id: 'lab.cfgtest', base_revision: 3, values: { poll_ms: 120 } }]);
  assert.deepEqual([r.kind, r.say], ['accepted', '⚙ cfg test 설정 저장 — revision 4 · 재시작함']);
  const n = f.calls.length;
  assert.equal((await source.crud('leaf-a', 'mod', 'update', cfg.vals, { id: 'lab.cfgtest', cfg })).same, true, '바뀐 것이 없으면 부르지 않는다');
  assert.equal(f.calls.length, n);
  // 다른 노드 — 노드 주소 호출(두 op 모두 scopes cluster)
  f.calls.length = 0;
  source.client.canRelay = () => true;
  await source.modConfig('leaf-b', 'lab.cfgtest');
  const opsB = f.calls.filter((c) => c.op);
  assert.ok(opsB.length === 2 && opsB.every((c) => c.url.startsWith('/api/v1/nodes/node_b/operations/')), f.calls.map((c) => c.url).join(' '));
  const u = await new LiveSource(new TerraClient('', { fetch: cfgServer({ undeclared: true }) }), { localNode: 'leaf-a' }).modConfig('leaf-a', 'io.terra.file');
  assert.deepEqual([u.cfg, u.r.reason], [null, 'MODULE_CONFIG_UNDECLARED']);
});

test('wire — 모듈 수정 폼: 열기 전에 설정을 받아 그 칸으로 연다 · 다시 받아도 칸을 잃지 않는다 · 저장은 config.patch · 거절은 키를 적는다 · 선언이 없으면 그렇다고', async () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  s.__real.perms = ['node.read', 'node.control', 'module.manage', 'file.read'];
  const local = s.state.localNode.name, said = [];
  const say = s.hbSay.bind(s);
  s.hbSay = (t, c) => { said.push(t); say(t, c); };
  const opts = {};
  const f = cfgServer(opts);
  const client = new TerraClient('', { fetch: f });
  s.__client = client;
  const source = new LiveSource(client, { localNode: local, localId: 'node_a' });
  const unwire = wireHelm(s, source, { pollMs: 60000 });
  try {
  s.hbPut(local, 'mod', [{ id: 'lab.cfgtest', name: 'cfg test', state: 'running' }, { id: 'io.terra.file', name: 'Terra File', state: 'running' }]);
  await s.hbFormOpen('mod', 'edit', 'lab.cfgtest', local, 'fs');
  const F = s.state.hbForm;
  assert.ok(F, '폼이 열렸다');
  assert.deepEqual(F.vals, cfgForm(SCHEMA, VALUES).vals);
  assert.deepEqual(s.hbFields('mod', s.hbItems(local, 'mod')[0]).map((x) => x.k), ['poll_ms', 'mode', 'share', 'label', 'tags', 'token']);
  // 목록을 다시 받아도 칸(item.cfg)을 잃지 않는다 — 서버 목록에는 설정이 없다
  assert.equal((await source.list(local, 'mod'))[0].cfg, undefined);
  s.hbOpen('mod');
  await sleep(900);
  assert.ok(f.calls.some((c) => c.op === 'terra.daemon.modules.get'), '모듈 목록을 다시 받았다');
  assert.ok(s.hbItems(local, 'mod').find((x) => x.id === 'lab.cfgtest').cfg, '붙여 둔 설정이 남았다');
  // formValues 는 설정 칸을 다듬지 않는다(비운 수 칸은 0 이 아니라 기본값으로 되돌리기)
  assert.deepEqual(formValues(s, Object.assign({}, F, { vals: Object.assign({}, F.vals, { poll_ms: '' }) }), s.hbItems(local, 'mod')[0]).vals.poll_ms, '');
  // 거절 — 키를 적고 폼은 열어 둔다
  opts.invalid = true;
  s.hbFormSet('poll_ms', '5');
  await s.hbFormSave();
  assert.match(s.state.hbForm.err, /스키마를 어긴다 — poll_ms — must be >= 10/);
  opts.invalid = false; opts.conflict = true;
  await s.hbFormSave();
  assert.match(s.state.hbForm.err, /다른 화면이 먼저 설정을 바꿨다/);
  opts.conflict = false;
  s.hbFormSet('poll_ms', '120');
  await s.hbFormSave();
  assert.equal(s.state.hbForm, null);
  assert.ok(said.some((t) => /⚙ cfg test 설정 저장 — revision 4 · 재시작함/.test(t)), said.join(' | '));
  const patch = f.calls.filter((c) => c.op.endsWith('config.patch')).at(-1);
  assert.deepEqual(patch.body, { module_id: 'lab.cfgtest', base_revision: 3, values: { poll_ms: 120 } });
  // module.manage★ 가 없는 토큰 — 화면 권한은 node.control 로 채워 넣지만 저장은 실제 권한으로 본다: 볼 수만 있다
  s.__real.perms = ['node.read', 'node.control', 'file.read'];
  const before = f.calls.length;
  await s.hbFormOpen('mod', 'edit', 'lab.cfgtest', local, 'fs');
  assert.ok(s.state.hbForm, '보기는 열린다(node.read)');
  assert.ok(said.some((t) => /설정을 볼 수만 있다/.test(t)), said.join(' | '));
  s.hbFormSet('poll_ms', '200');
  await s.hbFormSave();
  assert.match(s.state.hbForm.err, /module\.manage★ 권한 없음/);
  assert.ok(!f.calls.slice(before).some((c) => c.op.endsWith('config.patch')), '부르지 않는다');
  s.setState({ hbForm: null });
  s.__real.perms = ['node.read', 'node.control', 'module.manage', 'file.read'];
  // 설정을 선언하지 않은 모듈 — 폼을 열지 않고 그렇다고 말한다(화면 원본의 글)
  opts.undeclared = true;
  await s.hbFormOpen('mod', 'edit', 'io.terra.file', local, 'fs');
  assert.equal(s.state.hbForm, null);
  assert.ok(said.some((t) => /설정을 선언하지 않은 모듈이다/.test(t)), said.join(' | '));
  } finally {
    unwire();
    clearInterval(s._hbX); clearTimeout(s._hbT);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(s, 'hbFormOpen'), false, '끊으면 원래 폼 열기로');
});

test('I/O 장치 폼 — 추가는 손 등록(이름 · 주소), 고칠 때는 원본의 칸에서 주소를 뺀다(등록한 장치의 주소를 바꾸는 op 는 없다)', () => {
  const s = new (prep('node', NodeScreen))({ skin: 'grass' });
  assert.deepEqual(s.hbFields('io', null).map((f) => f.k), ['name', 'addr']);
  const edit = s.hbFields('io', { id: 'cam-1', name: 'cam', kind: 'camera' }).map((f) => f.k);
  assert.ok(!edit.includes('addr') && edit.includes('name') && edit.includes('approval'), edit.join(','));
});
