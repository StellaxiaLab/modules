// node --test — AUD-82: 다른 노드의 앱 목록을 앱 토큰으로 실제로 받는다(GET /api/v1/gui/remote/{node}/apps, Terra #385).
//   노드마다 캐시 · TTL · 실패는 "못 봤음 + 이유"(없음이 아니다). AUD-89 후반: TerraSviMods 도 못 읽음 ≠ 빈 목록.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import * as A from '../src/api/desk-adapt.js';
import { createRemoteApps, remoteAppsWhy, TTL_OK, TTL_ERR } from '../src/api/remote-apps.js';
import { createTerra, TerraError } from '../src/api/terra.js';

const rd = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const load = (n) => new Function('DCLogic', parseBoard(rd(n)).script + '\nreturn Component;')(DCLogic);
const tick = () => new Promise((r) => setTimeout(r, 5));
const RAPPS = { nodeId: 'R', count: 2, apps: [
  { nodeId: 'R', moduleId: 'm1', id: 'a1', name: '원격 앱', mode: 'static', origin: 'http://rapp-habc.localhost:8787', assets: { state: 'cached' } },
  { nodeId: 'R', moduleId: 'm1', id: 'e1', name: '안쪽 앱', mode: 'static', embed: 'scene' }] };

test('캐시 — 같은 노드는 TTL 안에서 한 번만 묻고, 받으면 화면을 다시 그리게 알린다', async () => {
  let t = 0, changed = 0; const calls = [];
  const R = createRemoteApps({ http: async (m, p) => { calls.push(m + ' ' + p); return RAPPS; }, now: () => t, onChange: () => changed++ });
  assert.equal(R.get('R').state, 'loading'); R.get('R'); R.get('R');
  await tick(); assert.equal(calls.length, 1, '받는 중에는 다시 묻지 않는다'); assert.equal(changed, 1);
  assert.equal(calls[0], 'GET /api/v1/gui/remote/R/apps');
  const e = R.get('R'); assert.equal(e.state, 'ok'); assert.equal(e.apps.length, 2);
  t = TTL_OK - 1; R.get('R'); await tick(); assert.equal(calls.length, 1);
  t = TTL_OK; assert.equal(R.get('R').state, 'ok', '낡은 사본은 새로 받는 동안 보인다'); await tick(); assert.equal(calls.length, 2);
  R.get('R2'); await tick(); assert.equal(calls.length, 3, '노드마다 따로');
});

test('실패 — 못 봤음 + 이유, 짧은 TTL 뒤에야 다시', async () => {
  let t = 0, n = 0; const err = new TerraError('GUI_REMOTE_DENIED', '권한 없음', 403);
  const R = createRemoteApps({ http: async () => { n++; throw err; }, now: () => t });
  R.get('R'); await tick(); const e = R.get('R'); assert.equal(e.state, 'err'); assert.match(e.why, /GUI_REMOTE_DENIED/); assert.equal(n, 1);
  t = TTL_ERR - 1; R.get('R'); await tick(); assert.equal(n, 1); t = TTL_ERR; R.get('R'); await tick(); assert.equal(n, 2);
  assert.match(remoteAppsWhy(new TerraError('GUI_REMOTE_UNAVAILABLE', 'x', 501)), /501/);
  assert.match(remoteAppsWhy(new TerraError('NETWORK', 'x', 0)), /닿지 못함/);
});

test('terra.http — 앱 토큰이 낡아 401 이면 새 토큰으로 한 번만 다시', async () => {
  let tok = 'old', refreshed = 0; const seen = [];
  const f = async (path, init) => { seen.push(init.headers.authorization); return init.headers.authorization === 'Bearer new' ? new Response(JSON.stringify(RAPPS), { status: 200 }) : new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }); };
  const terra = createTerra({ fetch: f, token: () => tok, refresh: async () => { refreshed++; tok = 'new'; return 'new'; } });
  const d = await terra.http('GET', '/api/v1/gui/remote/R/apps'); assert.equal(d.apps.length, 2); assert.deepEqual(seen, ['Bearer old', 'Bearer new']); assert.equal(refreshed, 1);
  const dead = createTerra({ fetch: async () => new Response('{}', { status: 401 }), token: () => 'x', refresh: async () => 'y' });
  await assert.rejects(dead.http('GET', '/x'), (e) => e.status === 401);
});

test('appsView — 원격: 읽었으면 사실, 받는 중 · 못 읽음은 몰랐음', () => {
  const ok = A.appsView(null, 'm1', false, { state: 'ok', apps: RAPPS.apps });
  assert.equal(ok.appsUnknown, false); assert.deepEqual(ok.apps.map((a) => a.id), ['a1'], 'embed 앱은 뺀다'); assert.equal(ok.apps[0].asset, 'cached');
  const z = A.appsView(null, 'm2', false, { state: 'ok', apps: RAPPS.apps }); assert.equal(z.appsUnknown, false); assert.deepEqual(z.apps, []);
  assert.match(A.appsView(null, 'm1', false, { state: 'loading' }).appsWhy, /받는 중/);
  const bad = A.appsView(null, 'm1', false, { state: 'err', why: '권한 (GUI_REMOTE_DENIED)' }); assert.equal(bad.appsUnknown, true); assert.match(bad.appsWhy, /GUI_REMOTE_DENIED/);
});

const LOC = { id: 'L', kind: 'leaf', name: 'desk' }, REM = { id: 'R', kind: 'leaf', name: 'far' };
function field(ent) {
  const Field = load('Field'), c = new Field({});
  c.TN = () => ({ read: () => ({ data: [{ id: 'm1', name: '모듈', ver: '1', st: 'run' }] }) }); c.localNode = () => LOC;
  globalThis.window = { TerraDesk: A, TerraGuiApps: [], TerraRemoteApps: { get: (id) => (id === 'R' ? ent : undefined) } };
  return c;
}
test('전역 틀 — 원격 노드의 모듈 · 브라우저 카탈로그가 받은 앱 목록을 쓴다', () => {
  try {
    let c = field({ state: 'ok', apps: RAPPS.apps }); let m = c.modsOf(REM)[0];
    assert.equal(m.appsUnknown, false); assert.equal(m.apps.length, 1); assert.equal(m.remote, true);
    const cat = c.liveCat(REM); assert.equal(cat.length, 1); assert.equal(cat.why, ''); assert.equal(cat[0].asset, 'cached', '받은 자산 상태 — 지어낸 값이 아니다'); assert.equal(cat[0].arg, 'mod|R|m1|a1');
    c = field({ state: 'err', why: '권한 없음 (GUI_REMOTE_DENIED)' }); m = c.modsOf(REM)[0];
    assert.equal(m.appsUnknown, true); assert.match(m.appsWhy, /GUI_REMOTE_DENIED/); assert.match(c.liveCat(REM).why, /GUI_REMOTE_DENIED/); assert.equal(c.liveCat(REM).length, 0);
  } finally { delete globalThis.window; }
});

test('WebBrowser — 실제(셸)에서 원격 앱은 예시 화면을 지어내지 않고 셸에 { appId, moduleId, nodeId, nodeName } 로 연다', async () => {
  const WB = load('WebBrowser'), e = { arg: 'mod|R|m1|a1', modId: 'm1', modName: '모듈', appId: 'a1', appName: '원격 앱', mode: 'static', node: 'far', nodeId: 'R', remote: true, st: 'run', asset: 'cached' }, calls = [];
  globalThis.window = { TerraLaunch: (...a) => { calls.push(a); return true; }, addEventListener() {} };
  try { const c = new WB({ catalog: [e] }); c.renderVals(); c.nav('mod|R|m1|a1'); const v = c.renderVals(); assert.equal(v.isDoc, false); assert.equal(v.isLaunch, true); assert.doesNotMatch(String(v.errT || ''), /아직 열 수 없음/);
    await new Promise((r) => setTimeout(r, 5)); assert.deepEqual(calls, [['a1', { moduleId: 'm1', nodeId: 'R', nodeName: 'far' }]]); } finally { delete globalThis.window; }
});

test('main.js — 모듈 목록을 못 읽은 것이 [] 로 둔갑하지 않는다(TerraSviMods)', () => {
  const s = readFileSync(fileURLToPath(new URL('../src/boot/main.js', import.meta.url)), 'utf8');
  assert.doesNotMatch(s, /TerraSviMods = \[\]/); assert.match(s, /\(\) => \{ window\.TerraSviMods = null; \}/);
});

// AUD-82(실측 s3-gui): 장면 키('P1:iso-B')가 아니라 실제 node id(rid)로 /gui/remote/{node}/apps 를 받는다 — 403 GUI_REMOTE_DENIED 의 원인
test('원격 앱 목록은 장면 키가 아니라 node id(rid) 로 받는다 — Field · Scene', () => {
  const NODE = { id: 'P1:iso-B', rid: 'real-node-B', kind: 'leaf', name: 'iso-B' };
  const asked = [];
  const R = { get: (id) => { asked.push(id); return id === 'real-node-B' ? { state: 'ok', apps: RAPPS.apps.map((a) => ({ ...a, nodeId: 'real-node-B' })) } : { state: 'err', why: '권한 없음 (GUI_REMOTE_DENIED)' }; } };
  const mods = [{ id: 'm1', name: '모듈', ver: '1', st: 'run' }];
  try {
    for (const [name, pre] of [['Field', ''], ['Scene', 'gf_']]) {
      asked.length = 0;
      const C = load(name), c = new C({});
      c[pre + 'TN'] = c.TN = () => ({ read: () => ({ data: mods }) }); c[pre + 'localNode'] = c.localNode = () => LOC;
      globalThis.window = { TerraDesk: A, TerraGuiApps: [], TerraRemoteApps: R };
      const m = c[pre + 'modsOf'](NODE)[0], cat = c[pre + 'liveCat'](NODE);
      assert.ok(asked.length >= 1 && asked.every((id) => id === 'real-node-B'), name + ': ' + JSON.stringify(asked));
      assert.equal(m.appsUnknown, false, name); assert.equal(m.apps.length, 1, name); assert.equal(cat.why, '', name); assert.equal(cat.length, 1, name);
    }
  } finally { delete globalThis.window; }
});
