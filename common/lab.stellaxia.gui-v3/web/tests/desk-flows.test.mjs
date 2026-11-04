// node --test — 제어기 쓰기 흐름(보드): @flows 사본이 원본과 같다 · 문(gate)이 닫으면 마지막 단추만 잠기고 why · 설계 결정으로 닫은 것은 시안에서도 닫힘
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard } from '../tools/dc-board.mjs';
import { region } from '../tools/sync-desk-flows.mjs';
import { NODE_SHELL } from '../src/api/shells.js';

const src = readFileSync(fileURLToPath(new URL('../design/NodeDesktopEmbed.dc.html', import.meta.url)), 'utf8');
const flows = readFileSync(fileURLToPath(new URL('../src/api/desk-flows.js', import.meta.url)), 'utf8');
class DCLogic { constructor(p) { this.props = p || {}; this.state = {}; } setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state, this.props) : p); } }
const make = (win, props, raw) => {
  const prev = globalThis.window; globalThis.window = win;
  const C = new Function('DCLogic', parseBoard(src).script + '\nreturn Component;')(DCLogic), c = new C(Object.assign({ nodeName: 'desk', winW: 1240, winH: 760 }, props)); c.persist = () => {}; if (!raw) c.renderVals();   // 처음 그리기가 노드의 보기 상태를 묶는다(bind) — 그 뒤에 상태를 바꾼다
  return { c, done: () => { globalThis.window = prev; } };
};
const SHUT = (op) => ({ open: false, needs: 'core', why: '잠김 : 위임 없음 — ' + op, op });   // src/api/gates.js 의 why 꼴
const render = (c) => { const v = c.renderVals(); return v; };

test('@flows — 보드의 사본이 src/api/desk-flows.js 와 글자 그대로 같다(tools/sync-desk-flows.mjs)', () => {
  assert.equal(region(src), region(flows));
});

test('확인 단계 — 체크 전엔 다음이 잠기고, 문이 닫히면 마지막 단추가 why 와 함께 잠긴다(실행하지 않는다)', () => {
  let ran = 0;
  const { c, done } = make({ TerraGate: SHUT }); try {
    c.ask({ title: '시험', op: 'terra.master.route.policies.put', risk: 'dangerous', steps: [{ label: '하나', checks: [['a', '안다']] }, { label: '둘' }], final: { label: '하기', run: () => { ran++; return []; } }, undo: '없음' });
    let v = c.cfmView({}, true);
    assert.equal(v.riskT, '위험'); assert.equal(v.lockOn, true); assert.equal(v.lockWhy, '잠김 : 위임 없음 — terra.master.route.policies.put');   // 보드가 '잠김' 을 또 붙이지 않는다
    assert.equal(v.btns.find((b) => b.label === '다음 ›').dis, 'disabled'); assert.equal(v.err, '확인 필요 : 1');
    v.checks[0].flip(); v = c.cfmView({}, true); v.btns.find((b) => b.label === '다음 ›').run(); v = c.cfmView({}, true);
    const fin = v.btns.find((b) => b.label === '하기'); assert.equal(fin.dis, 'disabled'); assert.equal(fin.lock, true); assert.equal(fin.run, null);
    assert.deepEqual(v.steps.map((s) => s.cls), ['done', 'now', 'lock']); assert.equal(ran, 0);
  } finally { done(); }
});

test('노드 셸 — 열기 확인 단계를 끝까지 걸어도 셸 열기는 node-shell.md 결정까지 잠김(시안도)', () => {
  const { c, done } = make({}); try {
    c.shellAsk(); const S = c.state.cfm.spec;
    assert.deepEqual(S.steps.map((s) => s.label), ['무엇이 되는가', '권한 경고', '두 터미널 구분']);
    assert.equal(S.final.gate.open, false); assert.equal(S.final.gate.why, NODE_SHELL.reason + ' — ' + NODE_SHELL.design);
    assert.ok(S.steps[1].rows.some(([k, v]) => k === '위험도' && /dangerous/.test(v)));
    assert.equal(S.steps[2].preview, 'shell');
  } finally { done(); }
  assert.ok(!/commands\.execute\.post'/.test(parseBoard(src).script), '보드가 commands.execute 를 부르지 않는다');
});

test('.tmod 설치 — 마지막 단추는 결정 표(DECIDE.tmodInstall)가 잠근다, 시안에서도', () => {
  const { c, done } = make({}); try {
    c.state.tm = { name: 'x.tmod', size: 10, ck: { perm: true, unsigned: true }, r: { manifest: { id: 'lab.x', version: '1.0.0', kind: 'service', permissions: { storage: ['d'] } }, entries: ['module.json'], first: true } };
    c.state.modView = 'add'; c.state.wins = { mods: { fx: 0, fy: 0, fw: .5, fh: .5 } }; c.state.order = ['mods'];
    const X = render(c).wins[0].nx; assert.equal(X.add.hasV, true);
    const ins = X.add.btns.find((b) => b.label === '설치 ›'); assert.equal(ins.lock, true); assert.match(ins.tip, /^결정 필요 — process\.execute 경로/);
    ins.run(); assert.equal(c.state.cfm.spec.final.gate.open, false); assert.match(c.state.cfm.spec.final.gate.why, /^결정 필요/);
    assert.deepEqual(X.add.steps.map((s) => s.cls), ['done', 'done', 'done', 'done', 'lock']);
  } finally { done(); }
});

test('등록 — 앱 권한(node.enroll)이 닫으면 확인 단추에 자물쇠 · 마지막 등록 단추 잠김 · 이미 등록된 노드는 상태만', () => {
  const gate = (op) => (op === 'terra.daemon.enrollment.code.post' ? { open: false, needs: 'app-perm', why: '잠김 : 앱 권한 없음 — node.enroll', op } : { open: true, why: '', op });
  const { c, done } = make({ TerraGate: gate }, { nodeName: 'new-box' }); try {
    c.state.setTab = 'enroll'; c.state.wins = { set: { fx: 0, fy: 0, fw: .6, fh: .7 } }; c.state.order = ['set'];
    c.nd().en.code = 'tnc_abcd1234.' + Buffer.from('https://tree.lab').toString('base64url');
    let X = render(c).wins[0].nx; assert.equal(X.en.wiz, true); assert.equal(X.en.urlV, 'https://tree.lab'); assert.equal(X.en.why, '');
    const b = X.en.btns[0]; assert.equal(b.lock, true); assert.match(b.tip, /node\.enroll/);
    b.run(); assert.equal(c.state.cfm.spec.op, 'terra.daemon.enrollment.code.post');
    const v = c.cfmView({}, true); assert.equal(v.lockOn, true); assert.match(v.lockWhy, /^잠김 : 앱 권한 없음 — node\.enroll · Daemon 계약 : node\.enroll 권한/);
  } finally { done(); }
  const { c: r, done: d2 } = make({}); try {
    r.state.setTab = 'enroll'; r.state.wins = { set: { fx: 0, fy: 0, fw: .6, fh: .7 } }; r.state.order = ['set'];
    const X = render(r).wins[0].nx; assert.equal(X.en.reg, true); assert.equal(X.en.wiz, false); assert.match(X.en.regNote, /409/);
  } finally { d2(); }
});

test('네트워크 · 터널 · 계정 — 단추는 그리되 문이 닫으면 자물쇠와 why', () => {
  const { c, done } = make({ TerraGate: SHUT }); try {
    c.state.wins = { net: { fx: 0, fy: 0, fw: .7, fh: .7 }, svi: { fx: 0, fy: 0, fw: .6, fh: .7 }, set: { fx: 0, fy: 0, fw: .6, fh: .7 } }; c.state.order = ['net', 'svi', 'set'];
    c.state.netTab = 'peers'; c.state.resTab = 'tun'; c.state.setTab = 'acct';
    const W = render(c).wins, net = W.find((w) => w.id === 'net').net, svi = W.find((w) => w.id === 'svi').nx, set = W.find((w) => w.id === 'set');
    assert.deepEqual(net.acts.map((b) => [b.label, b.lock]), [['피어 철회', true]]); assert.match(net.note, /^잠김 : 위임 없음 — terra\.master\.network\.mesh\.wireguard\.peers\.revoke\.post · /); assert.match(net.acts[0].tip, /^잠김 : 위임 없음 — /);
    const open = svi.tn.btns[0]; assert.equal(open.lock, true); assert.match(open.tip, /service-tunnels\.open\.post.*경로 결정/);
    assert.equal(set.tid.linkBtns[0].lock, true); assert.match(set.tid.limit, /^연결 · 해제 — 잠김 : 위임 없음 — .*위임 세션\(앱 토큰\) 닫힘/); assert.match(set.tid.issWhy, /^목록 없음 · 잠김 : 위임 없음 — /);
    assert.ok(!/잠김[ :—]+잠김/.test(JSON.stringify([net.note, open.tip, set.tid.limit, set.tid.issWhy])), '잠김 말이 겹치지 않는다');
  } finally { done(); }
});

test('배정 진행 — 시안: 지정하면 진행 목록에 올라 단계 칩으로 보인다', async () => {
  const { c, done } = make({}); try {
    c.state.wins = { mods: { fx: 0, fy: 0, fw: .6, fh: .7 } }; c.state.order = ['mods'];
    c.assign('lab.missing.x', '');
    assert.equal(c.state.modView, 'offer'); assert.equal(c.state.asgTrack[0].post.st, 'wait');
    await new Promise((r) => setTimeout(r, 700));
    const X = render(c).wins[0].nx, a = X.asgs.find((x) => x.id === 'lab.missing.x');
    assert.deepEqual(a.steps.map((s) => s.cls), ['fail', 'fail', 'wait', 'wait', 'wait']); assert.match(a.fix, /게시본 없음/);
    c.asgPoll(false);
  } finally { done(); }
});

test('계정 — 실제 연결이면 받는 중이어도 시안 줄(user:stk · id.terra.example)을 쓰지 않는다', () => {
  const T = { t: { kind: 'gateway', meta: {} }, read: () => ({ data: null, loading: true, err: null, at: 0 }), linkText: () => ({ t: '', cls: 'local', ro: false }), refresh() {}, subscribe: () => () => {}, view: () => null, setView() {} };
  const { c, done } = make({ TerraNodes: T }, {}, true); try {
    const o = c.terraId();
    assert.doesNotMatch(JSON.stringify(o), /user:stk|id\.terra\.example|시안/);
    assert.equal(o.rows.length, 0); assert.equal(o.issuers.length, 0);
  } finally { done(); }
});
