// node --test — ADR-GW-015 E3 · E4: 창 안 브라우저의 외부 사이트 분기(iframe 먼저) · 사설 http 판정 · 막힘 목록 · "늘 밖에서" 기억 · iframe 속성 · capability 선언
//   외부로는 한 번도 요청하지 않는다 — 전부 주소 문자열 판정과 DOM(마크업) 수준이다. 실제 iframe 은 Terra E1(Gateway frame-src)이 병합된 뒤 실기에서 본다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import * as ES from '../src/api/external-sites.js';

const rd = (n) => readFileSync(fileURLToPath(new URL('../design/' + n + '.dc.html', import.meta.url)), 'utf8');
const mod = JSON.parse(readFileSync(fileURLToPath(new URL('../../module.json', import.meta.url)), 'utf8'));
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const WB = new Function('DCLogic', parseBoard(rd('WebBrowser')).script + '\nreturn Component;')(DCLogic);
const tick = () => new Promise((r) => setTimeout(r, 5));
const APPS_OK = [{ id: 'lab.stellaxia.gui-v3.web', capabilities: ['blob-images', 'external-frames'] }];
const mem = (init = []) => { const m = {}; if (init.length) m[ES.MEMORY_KEY] = JSON.stringify(init); return ES.createMemory({ getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }); };
const cls = (u, o = {}) => ES.classify(u, Object.assign({ apps: APPS_OK, memory: mem(), shell: true }, o));

test('module.json — gui-v3 웹 앱이 external-frames 를 선언한다(blob-images 는 그대로)', () => {
  const app = mod.contributions.gui.apps.find((a) => a.id === 'lab.stellaxia.gui-v3.web');
  assert.deepEqual(app.capabilities, ['blob-images', 'external-frames']);   // workers · wasm 은 넓히지 않는다
});

test('분기 — https 는 iframe, Terra 자신의 주소는 거절, 평문 외부 http 는 밖으로', () => {
  assert.equal(cls('https://example.com/a').route, 'frame');
  // Gateway(8787) · 앱 origin(8788) · 셸(17421/17422/17321/8080) · *.localhost — 어느 루프백 꼴이어도
  for (const u of ['http://127.0.0.1:8787/', 'http://localhost:8787/', 'http://[::1]:8787/', 'http://127.1.2.3:8788/', 'http://[::ffff:127.0.0.1]:17422/', 'http://127.0.0.1:17421/x', 'http://127.0.0.1:17321/', 'http://127.0.0.1:8080/', 'https://app-x.localhost:8788/', 'http://foo.localhost/', 'http://foo.localhost:5173/']) assert.deepEqual([u, cls(u).route, cls(u).why], [u, 'reject', 'terra-own']);
  assert.deepEqual([cls('http://example.com/').route, cls('http://example.com/').why], ['out', 'plain-http']);
  assert.equal(cls('ftp://example.com/').route, 'reject');
  assert.equal(cls('https://google.com@evil.example/').why, 'credentials');
});

test('분기 — 그 밖 루프백은 이 PC 로 iframe(평문이어도), 점 없는 localhost 는 *.localhost 와 다르다', () => {
  for (const u of ['http://127.0.0.1:8799/', 'http://localhost:5173/', 'http://[::1]:8799/', 'http://0.0.0.0:9000/', 'http://[::ffff:127.0.0.1]:8799/', 'http://127.1.2.3/', 'http://localhost/', 'https://localhost:8443/']) {
    const c = cls(u); assert.deepEqual([u, c.route, c.why, c.thisPc], [u, 'frame', 'frame', true]);
  }
  assert.equal(cls('https://example.com/').thisPc, false);
  assert.equal(cls('http://localhost:8799/').route, 'frame'); assert.equal(cls('http://x.localhost:8799/').route, 'reject');
  assert.ok(ES.isLocalhostSub('a.localhost') && !ES.isLocalhostSub('localhost'));
  // 다른 호스트의 같은 번호는 Terra 가 아니다
  assert.equal(cls('http://192.168.0.5:8787/').route, 'frame'); assert.equal(cls('https://example.com:8787/').route, 'frame');
});

test('분기 — 지금 페이지가 온 Gateway 포트(옮긴 배치)도 거절, 하드코딩이 아니다', () => {
  assert.equal(cls('http://127.0.0.1:9911/').route, 'frame');
  for (const g of ['127.0.0.1:9911', 'http://localhost:9911', ['x:1', '[::1]:9911']]) assert.deepEqual([cls('http://127.0.0.1:9911/', { gateway: g }).route, cls('http://127.0.0.1:9911/', { gateway: g }).why], ['reject', 'terra-own']);
  assert.equal(cls('http://127.0.0.1:9912/', { gateway: '127.0.0.1:9911' }).route, 'frame');
  assert.equal(cls('https://example.com:9911/', { gateway: '127.0.0.1:9911' }).route, 'frame');
});

test('분기 — 이 PC 주소도 막힘 목록 · 기억 · 자격 증명 규칙은 그대로', () => {
  const m = mem(); m.add('127.0.0.1');
  assert.deepEqual([cls('http://127.0.0.1:8799/', { memory: m }).route, cls('http://127.0.0.1:8799/', { memory: m }).why], ['out', 'remembered']);
  assert.equal(cls('http://u:p@127.0.0.1:8799/').why, 'credentials');
  assert.equal(cls('http://127.0.0.1:8799/', { apps: [{ id: 'lab.stellaxia.gui-v3.web', capabilities: [] }] }).why, 'no-capability');
});

test('http 는 사설 · 링크로컬 주소에만 iframe', () => {
  for (const u of ['http://192.168.0.1/', 'http://10.1.2.3/', 'http://172.16.0.9/', 'http://172.31.255.1/', 'http://169.254.10.10/', 'http://printer/', 'http://nas.local/', 'http://router.lan/', 'http://[fd12::1]/', 'http://[fe80::1]/'])
    assert.deepEqual([u, cls(u).route], [u, 'frame']);
  for (const u of ['http://172.15.0.1/', 'http://172.32.0.1/', 'http://11.0.0.1/', 'http://192.169.0.1/', 'http://8.8.8.8/', 'http://example.com/', 'http://[2001:db8::1]/'])
    assert.deepEqual([u, cls(u).route], [u, 'out']);
  assert.equal(cls('http://192.168.0.1/').plain, true);
});

test('막힘 목록 — 호스트와 하위 도메인은 밖으로, 비슷한 이름은 아니다', () => {
  assert.ok(ES.BLOCK_HOSTS.includes('google.com') && ES.BLOCK_HOSTS.includes('github.com'));
  assert.equal(cls('https://google.com/').why, 'known-blocked'); assert.equal(cls('https://www.google.com/x').why, 'known-blocked'); assert.equal(cls('https://docs.github.com/').route, 'out');
  assert.equal(cls('https://notgoogle.com/').route, 'frame'); assert.equal(cls('https://google.com.example.org/').route, 'frame');
});

test('기억 — 호스트 단위로 남고 지울 수 있다. 기억된 호스트는 밖으로', () => {
  const m = mem(); assert.equal(cls('https://wiki.example.com/', { memory: m }).route, 'frame');
  assert.ok(m.add('Wiki.Example.com')); assert.deepEqual(m.list(), ['wiki.example.com']);
  assert.equal(cls('https://wiki.example.com/p', { memory: m }).why, 'remembered'); assert.equal(cls('https://a.wiki.example.com/', { memory: m }).why, 'remembered');
  assert.equal(cls('https://example.com/', { memory: m }).route, 'frame');
  m.add('b.example.com'); m.remove('wiki.example.com'); assert.deepEqual(m.list(), ['b.example.com']); assert.equal(cls('https://wiki.example.com/', { memory: m }).route, 'frame');
  m.clear(); assert.deepEqual(m.list(), []);
});

test('기억 저장소가 없거나 던져도 죽지 않고 빈 기억', () => {
  const bad = ES.createMemory({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } });
  assert.deepEqual(bad.list(), []); assert.equal(bad.add('a.com'), false); assert.equal(bad.has('a.com'), false);
  assert.deepEqual(ES.createMemory({ getItem: () => '{broken', setItem() {} }).list(), []);
});

test('capability — 앱 목록에 external-frames 가 없으면 밖으로(옛 Gateway), 못 받았으면 셸에서는 밖으로·시안에서는 iframe', () => {
  assert.equal(ES.frameCapability(APPS_OK), true); assert.equal(ES.frameCapability([{ id: 'lab.stellaxia.gui-v3.web', capabilities: ['blob-images'] }]), false);
  assert.equal(ES.frameCapability(null), null); assert.equal(ES.frameCapability([{ id: 'other.app' }]), null);
  assert.equal(cls('https://example.com/', { apps: [{ id: 'lab.stellaxia.gui-v3.web', capabilities: [] }] }).why, 'no-capability');
  assert.equal(cls('https://example.com/', { apps: null }).why, 'no-capability');
  assert.equal(cls('https://example.com/', { apps: null, shell: false }).route, 'frame');
});

test('punycode — 동형 문자 호스트는 ASCII 로 보인다', () => { assert.equal(ES.hostOf('https://аpple.com/'), 'xn--pple-43d.com'); });

test('iframe 속성 상수 — allow-scripts allow-forms allow-same-origin 만(다운로드 · 팝업 · 상단 이동 · 모달 없음)', () => {
  assert.equal(ES.FRAME_SANDBOX, 'allow-scripts allow-forms allow-same-origin'); assert.equal(ES.FRAME_ALLOW, ''); assert.equal(ES.FRAME_REFERRER, 'no-referrer');
  assert.doesNotMatch(ES.FRAME_SANDBOX, /downloads|popups|top-navigation|modals|pointer-lock|presentation/);
});

test('마크업 — 외부 iframe 은 sandbox · allow="" · referrerpolicy 정확히, 외부 띠는 접을 수 없다', () => {
  const html = rd('WebBrowser');
  const m = /<iframe class="wb-frame wb-white"[^>]*>/.exec(html); assert.ok(m, '외부 iframe');
  assert.match(m[0], /sandbox="allow-scripts allow-forms allow-same-origin"/); assert.match(m[0], / allow=""/); assert.match(m[0], /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(m[0], /allow-downloads|allow-popups|allow-top-navigation|allow-modals/);
  assert.match(html, /class="wb-band"/); assert.doesNotMatch(html, /<details/);
});

function board(win, props = {}) { globalThis.window = Object.assign({ addEventListener() {} }, win); const c = new WB(Object.assign({ catalog: [], nodeName: 'desk' }, props)); c.renderVals(); return c; }
const withSites = (extra = {}, m = mem()) => ({ TerraGuiApps: APPS_OK, TerraOpenExternal: (u) => { (extra.asked || []).push(u); return true; }, TerraExternalSites: { classify: ES.classify, memory: m }, ...extra.win });

test('보드 — 허용 주소는 iframe + 외부 칩 · 띠 · ↗, 기본 브라우저 요청은 없다', async () => {
  const asked = []; const c = board(withSites({ asked }));
  try {
    c.nav('https://example.com/docs'); const v = c.renderVals(); await tick();
    assert.equal(v.isWeb, true); assert.equal(v.isExt, false); assert.equal(v.src, 'https://example.com/docs');
    assert.equal(v.lockT, '외부 · example.com'); assert.match(v.bandT, /Terra 화면이 아닙니다/); assert.match(v.bandT, /비밀번호를 묻지 않습니다/); assert.match(v.bandNote, /로그인이 필요한 사이트는/); assert.match(v.bandNote, /새 창 링크/);
    assert.equal(v.outD, 'inline-flex'); assert.equal(v.extD, 'none', '셸에서는 ↗ 가 기본 브라우저 단추'); assert.deepEqual(asked, [], 'iframe 이면 요청하지 않는다');
    v.outAsk(); assert.deepEqual(asked, ['https://example.com/docs']);
    assert.equal(v.moved, false); v.onFrameLoad(); assert.equal(c.renderVals().moved, false, '첫 load 는 이동이 아니다'); c.renderVals().onFrameLoad(); const v2 = c.renderVals();
    assert.equal(v2.moved, true); assert.match(v2.movedT, /지금 주소는 Terra 가 볼 수 없습니다/);
  } finally { delete globalThis.window; }
});

test('보드 — punycode 칩 · 사설 http 는 iframe · 외부 http 는 밖으로 · Terra 자신은 거절 · 이 PC 는 iframe', async () => {
  const asked = []; const c = board(withSites({ asked }));
  try {
    c.nav('https://аpple.com/'); assert.equal(c.renderVals().lockT, '외부 · xn--pple-43d.com');
    c.nav('http://192.168.0.10/admin'); let v = c.renderVals(); assert.equal(v.isWeb, true); assert.ok(v.chips.some((q) => /사설/.test(q.t)));
    c.nav('http://example.com/'); v = c.renderVals(); assert.equal(v.isWeb, false); assert.equal(v.isExt, true); assert.match(v.extT, /http/); await tick(); assert.deepEqual(asked, ['http://example.com/']);
    c.nav('http://127.0.0.1:8787/'); v = c.renderVals(); assert.equal(v.isErr, true); assert.match(v.errT, /Terra 화면은 시작 페이지에서/); assert.equal(v.isWeb, false); await tick(); assert.equal(asked.length, 1, 'Terra 자신의 주소는 밖으로도 보내지 않는다');
    c.nav('http://127.0.0.1:8799/'); v = c.renderVals(); assert.equal(v.isWeb, true); assert.equal(v.isErr, false); assert.equal(v.src, 'http://127.0.0.1:8799/'); assert.ok(v.chips.some((q) => /이 PC/.test(q.t))); await tick(); assert.equal(asked.length, 1, '이 PC 주소는 iframe — 밖으로 묻지 않는다');
  } finally { delete globalThis.window; }
});

test('보드 — 막힘 목록 호스트는 바로 밖으로, "늘 밖에서" 를 누르면 기억하고 다음엔 밖으로, 기억 지우기로 되돌린다', async () => {
  const asked = []; const m = mem(); const c = board(withSites({ asked }, m));
  try {
    c.nav('https://www.google.com/search?q=a'); let v = c.renderVals(); assert.equal(v.isExt, true); assert.match(v.extT, /막는 것으로 알려져/); await tick(); assert.deepEqual(asked, ['https://www.google.com/search?q=a']);
    c.nav('https://wiki.example.com/'); v = c.renderVals(); assert.equal(v.isWeb, true); assert.equal(v.rememberD, 'inline-flex'); v.remember();
    assert.deepEqual(m.list(), ['wiki.example.com']); v = c.renderVals(); assert.equal(v.isExt, true); assert.match(v.extT, /늘 기본 브라우저로/); assert.equal(v.extForgetD, 'inline-flex');
    c.nav('https://wiki.example.com/other'); v = c.renderVals(); assert.equal(v.isExt, true, '같은 호스트의 다른 경로도 밖으로');
    v.extForget(); assert.deepEqual(m.list(), []); v = c.renderVals(); assert.equal(v.isWeb, true, '지우면 다시 창 안');
  } finally { delete globalThis.window; }
});

test('보드 — external-frames 없는 Gateway(옛 것)이면 iframe 대신 밖으로 + 이유 문구', () => {
  const c = board(withSites({ win: { TerraGuiApps: [{ id: 'lab.stellaxia.gui-v3.web', capabilities: ['blob-images'] }] } }));
  try { c.nav('https://example.com/'); const v = c.renderVals(); assert.equal(v.isWeb, false); assert.equal(v.isExt, true); assert.match(v.extT, /Gateway/); } finally { delete globalThis.window; }
});

test('보드 — 원격 노드 창이면 띠에 "이 기기에서 엽니다"', () => {
  const c = board(withSites(), { nodeName: 'rdk', remote: true });
  try { c.nav('https://example.com/'); assert.match(c.renderVals().bandNote, /이 기기에서 엽니다\(rdk 경유 아님\)/); } finally { delete globalThis.window; }
  const l = board(withSites(), { nodeName: 'desk' });
  try { l.nav('https://example.com/'); assert.doesNotMatch(l.renderVals().bandNote, /이 기기에서 엽니다/); } finally { delete globalThis.window; }
});

test('Scene — 웹 브라우저 창에 remote 를 넘긴다', () => {
  assert.equal((rd('Scene').match(/name="WebBrowser"[^>]*remote="\{\{wRemote(19|20)\}\}"/g) || []).length, 2);
});
