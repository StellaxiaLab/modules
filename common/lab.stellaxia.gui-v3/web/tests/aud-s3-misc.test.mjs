// node --test — AUD-79(위험 영역 단추 부팅 배선) · AUD-90(node id 복사 대체 경로) · AUD-30(로그아웃 뒤 브라우저 잔여물)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { pcLogout } from '../src/api/pc-state.js';
import { boardModule } from '../tools/dc-board.mjs';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const el = () => ({ dataset: {}, style: {}, childNodes: [], parentNode: null, appendChild(c) { return c; }, insertBefore(c) { return c; }, removeChild() {}, setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; }, addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
globalThis.window = globalThis;
globalThis.document = { visibilityState: 'visible', createElement: () => Object.assign(el(), { content: { childNodes: [] }, set innerHTML(v) {} }), createComment: () => el(), createTextNode: () => el(), querySelector: () => null, head: el(), body: el(), addEventListener() {}, removeEventListener() {} };
const RT = pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href;
const { boardDef } = await import(RT);
const dir = mkdtempSync(join(tmpdir(), 'aud-s3-misc-'));
async function logic(name) {
  const f = join(dir, name + '.mjs');
  writeFileSync(f, boardModule(readFileSync(fileURLToPath(new URL('../design/' + name + '.dc.html', import.meta.url)), 'utf8'), name, RT));
  await import(pathToFileURL(f).href);
  return boardDef(name).Logic;
}

test('AUD-79 — 부팅 배선: TerraDangerAsk 는 frame 이 서기 전에도 정의되고, frame 이 서면 열린다', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/boot/main.js', import.meta.url)), 'utf8');
  const line = src.split('\n').find((l) => l.includes('window.TerraDangerAsk = '));
  assert.ok(line, 'main.js 에 TerraDangerAsk 배선이 있다');
  // main.js 의 같은 줄을 그대로 실행 — MODE · frame 은 부팅 본문의 지역 변수(frame 은 나중에 선다)
  const sent = [];
  const sandbox = { window: {}, MODE: 'app', frame: null, dangerView: {} };
  vm.createContext(sandbox);
  vm.runInContext('let frame = null; const MODE = "app"; const dangerView = {};\n' + line + '\nglobalThis.__set = (f) => { frame = f; };', sandbox);
  const w = sandbox.window;
  assert.equal(typeof w.TerraDangerAsk, 'function', 'frame 이 서기 전에도 정의돼 있다(그렇지 않으면 설정창 단추가 늘 잠긴다)');
  assert.equal(w.TerraDangerAsk.can(), false); assert.equal(w.TerraDangerAsk(), false);
  sandbox.__set({ emit: (e) => sent.push(e) });
  assert.equal(w.TerraDangerAsk.can(), true, 'frame 이 선 뒤에는 단추가 열린다');
  assert.equal(w.TerraDangerAsk(), true); assert.deepEqual(sent, ['danger']);
});

test('AUD-90 — 복사: clipboard 가 막히면 textarea + execCommand 로 대신하고, 둘 다 안 되면 실패를 보인다', async () => {
  const C = await logic('NodeStatus');
  const mk = () => { const o = Object.create(C.prototype); o.props = { nodeRid: '' }; o.state = { t: 0, info: null, copied: false }; o._net = []; o._live = true; o.real = () => false; o.setState = (s) => { Object.assign(o.state, s); }; return o; };
  const run = async (o) => { const v = o.renderVals(); v.copyId(); await new Promise((r) => setTimeout(r, 20)); return o.renderVals().copyT; };
  const denied = { writeText: () => Promise.reject(new DOMException('blocked', 'NotAllowedError')) };
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: denied }, configurable: true });
  let cmds = [], ok = true;
  document.execCommand = (c) => { cmds.push(c); return ok; };
  document.createElement = () => Object.assign(el(), { value: '', select() {}, focus() {}, setSelectionRange() {} });
  document.body.appendChild = (c) => c; document.body.removeChild = () => {};
  assert.equal(await run(mk()), '복사됨', 'clipboard 가 막혀도 execCommand 대체 경로로 복사된다');
  assert.deepEqual(cmds, ['copy']);
  ok = false;
  assert.match(await run(mk()), /복사 못 함/, '둘 다 안 되면 실패 문구');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: () => Promise.resolve() } }, configurable: true });
  assert.equal(await run(mk()), '복사됨');
});

test('AUD-30 — 로그아웃: terra.view.desk.* 옛 키가 남지 않는다(principal 을 몰라도)', () => {
  const st = mem({ 'terra.view.desk.T1': '{}', 'terra.view.desk.P1:ws': '{}', 'terra.pc.desk.n1': '{}', 'terra.theme': 'dark', 'terra.view.other': '1' });
  pcLogout({ TerraWho: null, dispatchEvent: () => true }, st);
  assert.deepEqual([...st.m.keys()].sort(), ['terra.pc.desk.n1', 'terra.theme', 'terra.view.other']);
});

test('AUD-30 — TerraNodes.clear: 대기 중인 저장 타이머가 로그아웃 뒤 terra.cache 를 다시 쓰지 않는다', async () => {
  globalThis.localStorage = mem();
  const C = await logic('TerraNodes');
  delete window.TerraNodes; window.TerraTransport = { kind: 'gateway', localId: () => '' };
  new C({}); const T = window.TerraNodes;
  T.cache.set('n1|props', { data: { a: 1 }, at: 1 }); T.persist();   // 400ms 뒤 저장 예약
  T.clear();                                                           // 로그아웃
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(localStorage.getItem('terra.cache'), null, '로그아웃 뒤 terra.cache 가 다시 생기지 않는다');
  T.persist(); await new Promise((r) => setTimeout(r, 600));            // 늦은 응답의 finally 가 부르는 persist — 비어 있으면 키를 만들지 않는다
  assert.equal(localStorage.getItem('terra.cache'), null);
});
