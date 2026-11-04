// A 모드 디자인 로그인 — 셸 비밀번호 칸 잇기(host-secret.js). 셸(frame)은 가짜로 세운다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostSecretOf, waitHostLogin, nextAttempt, passwordRowItems, secretStyle, bindHostSecret, rememberedOf, rememberedMode, rememberedRowItems, REMEMBERED_DOTS } from './host-secret.js';

function fakeFrame() {
  const tokenL = new Set(), valueL = new Set();
  return {
    onToken: (f) => { tokenL.add(f); return () => tokenL.delete(f); },
    onValue: (f) => { valueL.add(f); return () => valueL.delete(f); },
    token: (t) => tokenL.forEach((f) => f(t)),
    value: (v) => valueL.forEach((f) => f(v)),
    listeners: () => tokenL.size + valueL.size,
  };
}

function fakeSecret() {
  const calls = [], stateL = new Set(), keyL = new Set();
  return {
    calls,
    place: (rect, o) => calls.push(['place', rect, o]), hide: () => calls.push(['hide']), focus: () => calls.push(['focus']),
    submit: (f) => calls.push(['submit', f]), state: () => ({ shown: true, focused: false, empty: true }),
    onState: (f) => { stateL.add(f); return () => stateL.delete(f); }, onKey: (f) => { keyL.add(f); return () => keyL.delete(f); },
    emitState: (s) => stateL.forEach((f) => f(s)), emitKey: (k) => keyL.forEach((f) => f(k)),
  };
}

test('hostSecretOf — 셸이 칸을 말하지 않으면(이전 Terra) null', () => {
  assert.equal(hostSecretOf(null), null);
  assert.equal(hostSecretOf({ secret: undefined }), null);
  const s = {}; assert.equal(hostSecretOf({ secret: s }), s);
});

test('waitHostLogin — 토큰이 오면 성공, 내 시도의 error 면 실패, 남의 시도는 무시', async () => {
  const f = fakeFrame();
  const ok = waitHostLogin(f, 7, 1000);
  f.token(undefined); f.value({ error: { message: 'x', attempt: 6 } }); f.token('tsa_1');
  assert.deepEqual(await ok, { ok: true });
  assert.equal(f.listeners(), 0);

  const bad = waitHostLogin(f, 8, 1000);
  f.value({ state: 'signedOut', error: { message: '', attempt: 0 } }); f.value({ error: { message: 'Credential service answered 401', attempt: 8 } });
  assert.deepEqual(await bad, { ok: false, message: 'Credential service answered 401' });

  const slow = await waitHostLogin(f, 9, 5);
  assert.equal(slow.ok, false);
});

test('waitHostLogin — 성공의 답(signedIn + 내 attempt, 빈 message)이 토큰보다 먼저 와도 실패가 아니다', async () => {
  // 셸 순서 그대로: signin.host 가 session 을 쓰면 값은 곧바로 오고, 토큰은 발급(fetch) 뒤에 온다
  const f = fakeFrame();
  const ok = waitHostLogin(f, 11, 1000);
  f.value({ state: 'signedIn', principal: 'admin', error: { message: '', attempt: 11 } });
  f.token('tsa_9');
  assert.deepEqual(await ok, { ok: true });

  const lost = waitHostLogin(f, 12, 1000);
  f.value({ state: 'signedIn', principal: 'admin', error: { message: '', attempt: 12 } });
  f.token(undefined);
  assert.equal((await lost).ok, false);

  const bad = waitHostLogin(f, 13, 1000);
  f.value({ state: 'signedOut', error: { message: '', attempt: 13 } });
  assert.deepEqual(await bad, { ok: false, message: '로그인 실패' });
});

test('rememberedOf · rememberedMode — 기억된 id 그대로 · auto 켜짐 · 토큰 없음일 때만 기억으로 들어간다', () => {
  assert.equal(rememberedOf(null), null);
  assert.equal(rememberedOf({ secret: {} }), null);   // 기억을 모르는 셸(이전 Terra)
  let token;
  const f = { token: () => token, remember: { remembered: () => ({ email: 'admin@terra' }) } };
  assert.deepEqual(rememberedOf(f), { email: 'admin@terra' });
  assert.equal(rememberedMode(f, { va: 'admin@terra', autoOn: true }), true);
  assert.equal(rememberedMode(f, { va: 'admin@terra' }), true);   // auto 를 아직 건드리지 않았다
  assert.equal(rememberedMode(f, { va: 'someone', autoOn: true }), false);   // id 를 고쳤다 → 비밀번호로
  assert.equal(rememberedMode(f, { va: 'admin@terra', autoOn: false }), false);   // auto 를 껐다
  token = 'tsa_1'; assert.equal(rememberedMode(f, { va: 'admin@terra' }), false);   // 이미 로그인
  assert.equal(rememberedMode({ token: () => undefined, remember: { remembered: () => undefined } }, { va: '' }), false);
});

test('rememberedRowItems — password 줄은 고정 점, 남은 자리는 그만큼 민다', () => {
  const items = [{ k: 'pV', t: '', c: 11 }, { k: 'pD', t: '··········', c: 11 }, { k: 'aV', t: 'admin', c: 11 }];
  const out = rememberedRowItems(items);
  assert.equal(out[0].t, REMEMBERED_DOTS);
  assert.equal(out[1].t, '··'); assert.equal(out[1].c, 11 + REMEMBERED_DOTS.length);
  assert.equal(out[2], items[2]);
});

test('nextAttempt — 같은 시각이어도 늘 커진다', () => {
  const a = nextAttempt(1000), b = nextAttempt(1000), c = nextAttempt(5);
  assert.ok(b > a && c > b);
});

test('passwordRowItems — 셸 칸에 글자가 있으면 보드의 password 점 · 남은 자리를 비운다', () => {
  const items = [{ k: 'pL', t: 'password' }, { k: 'pV', t: '' }, { k: 'pD', t: '·····' }, { k: 'aD', t: '···' }];
  assert.equal(passwordRowItems(items, true), items);
  assert.deepEqual(passwordRowItems(items, false).map((i) => i.t), ['password', '', '', '···']);
});

test('secretStyle — 점이 보드의 칸에 한 칸씩 앉는다', () => {
  const s = secretStyle(10, 18, (px) => px * 0.55);
  assert.equal(s.fontFamily, 'monospace');
  assert.equal(s.fontSize, 14);
  assert.equal(s.letterSpacing, 2.3);
  assert.equal(s.padding, '0 0 0 1.15px');
});

test('bindHostSecret — 로그인이 열려 입력을 받을 때만 칸을 두고, 키 · 상태를 보드에 잇는다', () => {
  const sec = fakeSecret(), frames = [];
  const raf = (f) => { frames.push(f); return frames.length; }, step = () => frames.shift()();
  const pw = { getBoundingClientRect: () => ({ left: 100, top: 300, width: 290, height: 24 }) };
  const admin = { focused: 0, focus() { this.focused++; } }, auto = { focused: 0, focus() { this.focused++; } };
  const doc = { querySelector: (sel) => (sel.endsWith('input[name="password"]') ? pw : sel.endsWith('input[name="admin"]') ? admin : sel.includes('auto') ? auto : null) };
  const lg = { state: { open: false, ready: false }, _cw: 10, _ch: 18, logins: 0, closed: 0, login() { this.logins++; }, closeLogin() { this.closed++; }, setState(p) { Object.assign(this.state, p); } };
  const b = bindHostSecret({ secret: sec, login: () => lg, scene: () => ({ loginOn: () => true }), doc, raf, caf: () => {}, advance: (px) => px * 0.55 });

  step();
  assert.deepEqual(sec.calls, []);
  lg.state.open = true; lg.state.ready = true; step();
  assert.equal(sec.calls.length, 1);
  assert.deepEqual(sec.calls[0][1], { x: 100, y: 300, width: 290, height: 24 });
  step();
  assert.equal(sec.calls.length, 1, '자리가 같으면 다시 보내지 않는다');
  lg._WP = {}; step();
  assert.deepEqual(sec.calls.at(-1), ['hide'], '전환(워프)이 시작되면 칸을 걷는다');
  lg._WP = null;

  sec.emitState({ shown: true, focused: true, empty: true });
  assert.equal(lg.state.foc, 'p');
  sec.emitState({ shown: true, focused: true, empty: false });
  assert.equal(lg.state.foc, null);

  sec.emitKey('Enter'); sec.emitKey('Escape'); sec.emitKey('Tab'); sec.emitKey('ShiftTab');
  assert.deepEqual([lg.logins, lg.closed, auto.focused, admin.focused], [1, 1, 1, 1]);

  step(); b.stop();
  assert.deepEqual(sec.calls.at(-1), ['hide']);
});
