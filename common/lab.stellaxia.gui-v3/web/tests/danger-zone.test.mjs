// 위험 영역 — 페이지는 스위치를 쓰지 못한다(Terra ADR-GW-012 §6.1). Scene 구조 + 코드에 쓰기 호출 없음
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const J = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const GET = 'terra.daemon.danger-zone.app-command-execution.get', POST = 'terra.daemon.danger-zone.app-command-execution.post';
const TGET = 'terra.daemon.danger-zone.service-tunnel.get', TPOST = 'terra.daemon.danger-zone.service-tunnel.post';
const fn = (n) => J('scene/contract/functions/danger.' + n + '.function.json');
const scene = J('scene/scene.json');
const walk = (n, f) => { f(n); for (const c of (n && n.children) || []) walk(c, f); };

test('/danger Route — Fragment 에 terra.web/frame 이 없다(내장 엘리먼트만)', () => {
  const r = scene.routes.find((x) => x.path === '/danger');
  assert.equal(r.fragment, 'gui-v3.danger');
  const frag = J('scene/surface/fragments/danger.fragment.json');
  assert.equal(frag.id, 'gui-v3.danger');
  const types = [], comps = [];
  walk(frag.root, (n) => { types.push(n.type); if (n.component) comps.push(n.component); });
  assert.ok(!types.includes('custom')); assert.deepEqual(comps, []);
  assert.ok(!JSON.stringify(frag.root).includes('terra.web/frame'));
});

test('danger.* Function 은 입력($input)을 참조하지 않는다', () => {
  for (const n of ['open', 'allow', 'block', 'close']) assert.ok(!JSON.stringify(fn(n).graph).includes('$input'), n);
});

test('allow · block — call 입력이 상수 true · false, 쓰기는 이 둘뿐', () => {
  const call = (f) => f.graph.nodes.find((x) => x.type === 'call');
  assert.deepEqual(call(fn('allow')), { ...call(fn('allow')), operationId: POST, input: { allow: true } });
  assert.deepEqual(call(fn('block')).input, { allow: false }); assert.equal(call(fn('block')).operationId, POST);
  assert.equal(call(fn('open')).operationId, GET);
  for (const n of ['open', 'close']) assert.ok(!JSON.stringify(fn(n).graph).includes(POST), n);
  for (const n of ['allow', 'block']) assert.ok(fn(n).graph.nodes.find((x) => x.type === 'call').onError, n + ' onError');
});

test('main Fragment — danger 이벤트는 gui-v3.danger.open 으로, 목록에 있다', () => {
  const m = J('scene/surface/fragments/main.fragment.json');
  assert.equal(m.root.on.danger.function, 'gui-v3.danger.open');
  assert.ok(m.functions.includes('gui-v3.danger.open'));
  assert.equal(m.root.on.danger.input, undefined);
});

test('scene.json — 등록 · requiredOperations 는 스위치 넷의 읽기 · 쓰기 여덟 op 만', () => {
  for (const f of ['danger.open', 'danger.allow', 'danger.block', 'danger.close']) assert.ok(scene.functions.includes('contract/functions/' + f + '.function.json'), f);
  assert.ok(scene.stores.includes('contract/stores/danger.store.json'));
  assert.ok(scene.fragments.includes('surface/fragments/danger.fragment.json'));
  assert.deepEqual(scene.requiredOperations.map((o) => o.operationId).sort(), [GET, POST, TGET, TPOST, 'terra.daemon.danger-zone.node-shell.get', 'terra.daemon.danger-zone.node-shell.post', 'terra.daemon.danger-zone.admin-screen.get', 'terra.daemon.danger-zone.admin-screen.post'].sort());
});

test('web 코드 — 스위치 쓰기(.post)를 부르지 않는다 (안내 문구 한 곳만)', () => {
  const hits = [];
  const scan = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'build' && e.name !== 'archive' && e.name !== 'node_modules') scan(p); continue; }
    if (/\.test\.mjs$/.test(e.name) || !/\.(js|mjs|html)$/.test(e.name)) continue;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => { if (l.includes('app-command-execution.post')) hits.push({ f: path.relative(root, p).split(path.sep).join('/'), l }); });
  } };
  scan(path.join(root, 'web/src')); scan(path.join(root, 'web/design'));
  for (const h of hits) {
    assert.ok(/^web\/src\/api\/(danger-zone|op-scope)/.test(h.f.replace(/^.*?(web\/)/, '$1')), '예상 밖 위치 ' + h.f);
    assert.ok(!/(invoke|write|http|sse|call|fetch)\(/.test(h.l), '호출로 쓰임 ' + h.f);
  }
  assert.ok(hits.some((h) => h.f.endsWith('danger-zone.js')));   // 안내 문구
});

test('설정창 · 입구 — TerraDangerAsk 는 emit(danger) 만, 값을 싣지 않는다', () => {
  const main = fs.readFileSync(path.join(root, 'web/src/boot/main.js'), 'utf8');
  assert.match(main, /window\.TerraDangerAsk = \(which\) => \{ if \(!\(MODE === 'app' && frame\)\) return false; frame\.emit\(which === 'serviceTunnel' \? 'dangerTunnel' : which === 'nodeShell' \? 'dangerShell' : which === 'adminScreen' \? 'dangerAdmin' : 'danger'\); return true; }/, '호출 시점에 frame 을 본다(AUD-79) · 이벤트 이름만 다르고 값은 싣지 않는다');
  assert.ok(!/if \(MODE === 'app' && frame\) window\.TerraDangerAsk/.test(main), '대입 시점 판정 없음');
  const dc = fs.readFileSync(path.join(root, 'web/design/NodeDesktopEmbed.dc.html'), 'utf8');
  assert.match(dc, /W2\.TerraDangerAsk\(k\)/);
  assert.ok(!/TerraDangerAsk\((?!k\))[^)]/.test(dc));
});

test('module.json 앱 권한 그대로 — process.execute 등 8개', () => {
  const m = J('module.json');
  const app = JSON.stringify(m);
  assert.ok(app.includes('process.execute'));
  assert.ok(!app.includes('danger'));
});

// ── 서비스 터널 열기 스위치(ADR-GW-014 P10-6) — 같은 구조의 두 번째 확인 화면 ──
const tfn = (n) => J('scene/contract/functions/dangerTunnel.' + n + '.function.json');
test('/danger/tunnel Route — 내장 엘리먼트만, 전용 Store · Function', () => {
  const r = scene.routes.find((x) => x.path === '/danger/tunnel');
  assert.equal(r.fragment, 'gui-v3.dangerTunnel');
  const frag = J('scene/surface/fragments/dangerTunnel.fragment.json');
  assert.equal(frag.id, 'gui-v3.dangerTunnel'); assert.deepEqual(frag.stores, ['dangerTunnel']);
  const types = [], comps = [];
  walk(frag.root, (n) => { types.push(n.type); if (n.component) comps.push(n.component); });
  assert.ok(!types.includes('custom')); assert.deepEqual(comps, []);
  assert.ok(!JSON.stringify(frag.root).includes('terra.web/frame'));
  assert.ok(!JSON.stringify(frag.root).includes('웹 앱 명령'), '문구가 터널 스위치 것이다');
  for (const f of ['open', 'allow', 'block', 'close']) assert.ok(scene.functions.includes('contract/functions/dangerTunnel.' + f + '.function.json'), f);
  assert.ok(scene.stores.includes('contract/stores/dangerTunnel.store.json'));
  assert.ok(scene.fragments.includes('surface/fragments/dangerTunnel.fragment.json'));
});

test('dangerTunnel.* — 입력($input) 참조 없음 · allow · block 은 상수 · 쓰기는 이 둘뿐', () => {
  for (const n of ['open', 'allow', 'block', 'close']) assert.ok(!JSON.stringify(tfn(n).graph).includes('$input'), n);
  const call = (f) => f.graph.nodes.find((x) => x.type === 'call');
  assert.equal(call(tfn('allow')).operationId, TPOST); assert.deepEqual(call(tfn('allow')).input, { allow: true });
  assert.equal(call(tfn('block')).operationId, TPOST); assert.deepEqual(call(tfn('block')).input, { allow: false });
  assert.equal(call(tfn('open')).operationId, TGET);
  for (const n of ['open', 'close']) assert.ok(!JSON.stringify(tfn(n).graph).includes(TPOST), n);
  for (const n of ['allow', 'block']) assert.ok(call(tfn(n)).onError, n + ' onError');
  // 앱 명령 스위치 op 를 건드리지 않는다
  for (const n of ['open', 'allow', 'block', 'close']) assert.ok(!JSON.stringify(tfn(n)).includes('app-command-execution'), n);
  // 확인 화면 안에서 돌고 두 번째 Store 만 쓴다
  for (const n of ['open', 'allow', 'block']) for (const x of tfn(n).graph.nodes) if (x.storeId) assert.equal(x.storeId, 'dangerTunnel');
  assert.ok(JSON.stringify(tfn('open').graph).includes('"/danger/tunnel"'));
});

test('main Fragment — dangerTunnel 이벤트는 gui-v3.dangerTunnel.open 으로(값 없음)', () => {
  const m = J('scene/surface/fragments/main.fragment.json');
  assert.equal(m.root.on.dangerTunnel.function, 'gui-v3.dangerTunnel.open'); assert.equal(m.root.on.dangerTunnel.input, undefined);
  assert.ok(m.functions.includes('gui-v3.dangerTunnel.open'));
});

const SGET = 'terra.daemon.danger-zone.node-shell.get', SPOST = 'terra.daemon.danger-zone.node-shell.post';
// ── 노드 셸 스위치(P16-4a · Terra P16-1) — 같은 구조의 확인 화면 ──
const sfn = (n) => J('scene/contract/functions/dangerShell.' + n + '.function.json');
test('/danger/shell Route — 내장 엘리먼트만, 전용 Store · Function', () => {
  const r = scene.routes.find((x) => x.path === '/danger/shell');
  assert.equal(r.fragment, 'gui-v3.dangerShell');
  const frag = J('scene/surface/fragments/dangerShell.fragment.json');
  assert.equal(frag.id, 'gui-v3.dangerShell'); assert.deepEqual(frag.stores, ['dangerShell']);
  const types = [], comps = [];
  walk(frag.root, (n) => { types.push(n.type); if (n.component) comps.push(n.component); });
  assert.ok(!types.includes('custom')); assert.deepEqual(comps, []);
  assert.ok(!JSON.stringify(frag.root).includes('terra.web/frame')); assert.ok(JSON.stringify(frag.root).includes('노드 셸'));
  assert.ok(!JSON.stringify(frag.root).includes('웹 앱 명령'), '문구가 노드 셸 스위치 것이다');
  for (const f of ['open', 'allow', 'block', 'close']) assert.ok(scene.functions.includes('contract/functions/dangerShell.' + f + '.function.json'), f);
  assert.ok(scene.stores.includes('contract/stores/dangerShell.store.json'));
  assert.ok(scene.fragments.includes('surface/fragments/dangerShell.fragment.json'));
});

test('dangerShell.* — 입력($input) 참조 없음 · allow · block 은 상수 · 쓰기는 이 둘뿐', () => {
  for (const n of ['open', 'allow', 'block', 'close']) assert.ok(!JSON.stringify(sfn(n).graph).includes('$input'), n);
  const call = (f) => f.graph.nodes.find((x) => x.type === 'call');
  assert.equal(call(sfn('allow')).operationId, SPOST); assert.deepEqual(call(sfn('allow')).input, { allow: true });
  assert.equal(call(sfn('block')).operationId, SPOST); assert.deepEqual(call(sfn('block')).input, { allow: false });
  assert.equal(call(sfn('open')).operationId, SGET);
  for (const n of ['open', 'close']) assert.ok(!JSON.stringify(sfn(n).graph).includes(SPOST), n);
  for (const n of ['allow', 'block']) assert.ok(call(sfn(n)).onError, n + ' onError');
  // 다른 스위치 op 를 건드리지 않는다
  for (const n of ['open', 'allow', 'block', 'close']) assert.ok(!/app-command-execution|service-tunnel|admin-screen/.test(JSON.stringify(sfn(n))), n);
  // 확인 화면 안에서 돌고 두 번째 Store 만 쓴다
  for (const n of ['open', 'allow', 'block']) for (const x of sfn(n).graph.nodes) if (x.storeId) assert.equal(x.storeId, 'dangerShell');
  assert.ok(JSON.stringify(sfn('open').graph).includes('"/danger/shell"'));
});

test('main Fragment — dangerShell 이벤트는 gui-v3.dangerShell.open 으로(값 없음)', () => {
  const m = J('scene/surface/fragments/main.fragment.json');
  assert.equal(m.root.on.dangerShell.function, 'gui-v3.dangerShell.open'); assert.equal(m.root.on.dangerShell.input, undefined);
  assert.ok(m.functions.includes('gui-v3.dangerShell.open'));
});


test('web 코드 — 서비스 터널 스위치 쓰기(.post)도 부르지 않는다', () => {
  const hits = [];
  const scan = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'build' && e.name !== 'archive' && e.name !== 'node_modules') scan(p); continue; }
    if (/\.test\.mjs$/.test(e.name) || !/\.(js|mjs|html)$/.test(e.name)) continue;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((l) => { if (l.includes('danger-zone.service-tunnel.post')) hits.push({ f: path.relative(root, p).split(path.sep).join('/'), l }); });
  } };
  scan(path.join(root, 'web/src')); scan(path.join(root, 'web/design'));
  for (const h of hits) {
    assert.ok(/^web\/src\/api\/(danger-zone|op-scope|master-delegated)/.test(h.f.replace(/^.*?(web\/)/, '$1')), '예상 밖 위치 ' + h.f);
    assert.ok(!/(invoke|write|http|sse|call|fetch)\(/.test(h.l), '호출로 쓰임 ' + h.f);
  }
});

// 관리 화면 스위치(P13-4) — 서비스 터널 스위치와 같은 구조: emit('dangerAdmin') → /danger/admin → 상수 입력 Function
test('관리 화면 스위치 — Route · main 이벤트 · 상수 입력 Function 이 admin-screen 만 부른다', () => {
  assert.equal(scene.routes.find((x) => x.path === '/danger/admin').fragment, 'gui-v3.dangerAdmin');
  const m = J('scene/surface/fragments/main.fragment.json');
  assert.equal(m.root.on.dangerAdmin.function, 'gui-v3.dangerAdmin.open'); assert.equal(m.root.on.dangerAdmin.input, undefined);
  assert.ok(m.functions.includes('gui-v3.dangerAdmin.open'));
  const frag = J('scene/surface/fragments/dangerAdmin.fragment.json'); let web = 0; walk(frag.root, (n) => { if (n.component === 'terra.web/frame') web++; });
  assert.equal(web, 0, '내장 엘리먼트만');
  const calls = [];
  for (const k of ['open', 'allow', 'block', 'close']) { const f = J('scene/contract/functions/dangerAdmin.' + k + '.function.json'); assert.equal(f.id, 'gui-v3.dangerAdmin.' + k); JSON.stringify(f, (kk, v) => { if (kk === 'operationId') calls.push(v); return v; }); assert.ok(!/\$input/.test(JSON.stringify(f)), k + ' 가 입력을 참조'); }
  assert.deepEqual([...new Set(calls)].sort(), ['terra.daemon.danger-zone.admin-screen.get', 'terra.daemon.danger-zone.admin-screen.post']);
  assert.equal(J('scene/contract/functions/dangerAdmin.allow.function.json').graph.nodes.find((n) => n.id === 'set').input.allow, true);
  assert.equal(J('scene/contract/functions/dangerAdmin.block.function.json').graph.nodes.find((n) => n.id === 'set').input.allow, false);
});
