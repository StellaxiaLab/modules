// node --test — 노드 셸(P16-4a): 승인 분기 · 스위치 꺼짐 · 스트림 송수신 · 닫기 정리 · resize · 끊김 · 원격 안내 · 키 변환
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeShell, shellPanel, keyBytes, OPS, remoteText, OFF_TEXT } from './node-shell.js';
import { dangerView, SWITCHES } from './danger-zone.js';
import { errorLine } from './error-text.js';
import { viaDoor, approvalOf } from './approval-door.js';
import SCOPE from './op-scope.json' with { type: 'json' };

const enc = new TextEncoder(), dec = new TextDecoder();
const err = (code, message = '', status = 0) => Object.assign(new Error(message || code), { code, status });

/** invoke · streamIO 흉내 — 호출 기록 + 노드가 보내는 바이트를 push 로 */
function rig(o = {}) {
  const calls = [], sent = [], closes = [];
  const R = {
    calls, sent, closes, sock: null, onClose: null,
    invoke: async (op, input) => {
      calls.push([op, input]);
      if (op === OPS.open) { if (o.open) return o.open(input); return { session: { session_id: 'ts_1', shell: 'pwsh', cols: o.sessCols ?? input.cols, rows: o.sessRows ?? input.rows }, elevated: !!o.elevated, warning: o.elevated ? 'Daemon 이 관리자' : '' }; }
      if (op === OPS.resize && o.resizeFails) throw err('X');
      return { ok: true };
    },
    streamIO: async (op, input, h) => {
      calls.push([op, input]); if (o.stream) return o.stream(op, input, h);
      assert.equal(h.binary, true);
      R.h = h; R.onClose = h.onClose;
      return { send: (v) => sent.push(v), close: () => { closes.push(1); } };
    },
    push: (s) => R.h.onMessage(enc.encode(s).buffer),
  };
  R.ctl = createNodeShell({ invoke: R.invoke, streamIO: R.streamIO, setTimeout: o.setTimeout || ((f) => { f(); return 1; }), clearTimeout: () => {} });
  return R;
}

test('열기 — T3 세션 열기(승인 문 op) → 스트림 티켓으로 붙기 → 화면에 출력 · 입력 송신(바이너리)', async () => {
  const R = rig(); const ok = await R.ctl.open({ cols: 100, rows: 30 });
  assert.equal(ok, true); assert.equal(R.ctl.state().phase, 'live');
  assert.deepEqual(R.calls[0], [OPS.open, { cols: 100, rows: 30 }]);
  assert.deepEqual(R.calls[1], [OPS.stream, { session_id: 'ts_1' }]);
  R.push('hello\r\n\x1b[32mok\x1b[0m'); assert.deepEqual(R.ctl.text().slice(0, 2), ['hello', 'ok']);
  assert.equal(R.ctl.view()[1].runs[0].fg, '#4fc78a');
  R.ctl.input('ls\r');
  assert.ok(R.sent[0] instanceof Uint8Array); assert.equal(dec.decode(R.sent[0]), 'ls\r');   // 바이너리 프레임(글자 프레임은 노드가 제어 메시지로 읽는다)
});

test('열기는 승인 문 대상 — 계약 T3 · 스위치 node-shell · 앱 토큰 직접 아님', () => {
  assert.equal(viaDoor(OPS.open), true); const a = approvalOf(OPS.open); assert.equal(a.tier, 'T3'); assert.equal(a.switch, 'node-shell');
  assert.deepEqual(SCOPE.operations[OPS.open].scopes, ['local'], '원격에서는 열리지 않는 op');
  for (const k of ['close', 'resize', 'stream']) assert.deepEqual(SCOPE.operations[OPS[k]].scopes, ['local']);
});

test('승인 분기 — 사람이 거절하면 셸이 열리지 않고 조용히 처음 상태, 스트림도 부르지 않는다', async () => {
  const R = rig({ open: () => { throw err('APPROVAL_DECLINED', '거절'); } });
  assert.equal(await R.ctl.open({}), false);
  const s = R.ctl.state(); assert.equal(s.phase, 'idle'); assert.equal(s.code, 'APPROVAL_DECLINED'); assert.match(s.text, /승인하지 않음/);
  assert.equal(R.calls.filter((c) => c[0] === OPS.stream).length, 0);
});

test('승인 분기 — 승인 문 없음 · 만료 · 그 밖의 거절은 §2.5 문구로 실패 상태', async () => {
  for (const [code, re] of [['APPROVAL_UNAVAILABLE', /승인 문 없음/], ['APPROVAL_EXPIRED', /만료됨/], ['DELEGATION_NOT_OPEN', /위임 안 됨/], ['APPROVAL_REQUIRED', /승인 화면/], ['TERMINAL_SESSION_LIMIT', /너무 많음/]]) {
    const R = rig({ open: () => { throw err(code); } });
    assert.equal(await R.ctl.open({}), false, code); assert.equal(R.ctl.state().phase, 'error'); assert.match(R.ctl.state().text, re, code);
  }
});

test('스위치 꺼짐 — NODE_SHELL_DISABLED 는 off 상태 + 스위치로 안내(창이 위험 영역 단추를 보인다)', async () => {
  const R = rig({ open: () => { throw err('NODE_SHELL_DISABLED', 'off', 403); } });
  assert.equal(await R.ctl.open({ node: 'desk' }), false);
  const s = R.ctl.state(); assert.equal(s.phase, 'off'); assert.match(s.text, /desk 의 "노드 셸"이 꺼져 있음 — 위험 영역에서 켜기/);
  const P = shellPanel({ mode: 'real', shell: s }); assert.equal(P.kind, 'off'); assert.equal(P.toSwitch, true); assert.equal(P.canOpen, false);
  // 읽어 둔 스위치가 꺼짐이면 열기 전에도 안내한다
  const P2 = shellPanel({ mode: 'real', sw: { state: 'ok', on: false }, shell: { phase: 'idle' } }); assert.equal(P2.kind, 'off'); assert.equal(P2.text, OFF_TEXT); assert.equal(P2.toSwitch, true);
  assert.equal(shellPanel({ mode: 'real', sw: { state: 'ok', on: true }, shell: { phase: 'idle' } }).canOpen, true);
});

test('elevated — 응답이 관리자 · root 면 상태에 경고를 싣는다(창 머리 띠)', async () => {
  const R = rig({ elevated: true }); await R.ctl.open({});
  assert.equal(R.ctl.state().elevated, true); assert.match(R.ctl.state().warning, /관리자/);
  const R2 = rig(); await R2.ctl.open({}); assert.equal(R2.ctl.state().elevated, false);
  // 승인 문이 { data: { session … } } 로 한 겹 싸 줘도 읽는다
  const R3 = rig({ open: () => ({ status: 'ok', data: { session: { session_id: 'ts_9', shell: 'bash', cols: 80, rows: 24 }, elevated: true, warning: 'root' } }) });
  await R3.ctl.open({}); assert.equal(R3.ctl.state().sessionId, 'ts_9'); assert.equal(R3.ctl.state().elevated, true);
});

test('위험 영역 스위치 줄 — get 모양 · 켜기는 Scene 이벤트 · elevated 는 note 로', () => {
  const W = SWITCHES.nodeShell; assert.equal(W.get, OPS.switchGet); assert.equal(W.set, OPS.switchSet); assert.equal(W.event, 'dangerShell');
  const off = dangerView({ data: { allow: false } }, { which: 'nodeShell', canAsk: true }); assert.equal(off.on, false); assert.equal(off.label, '노드 셸'); assert.equal(off.btnOff, false);
  const on = dangerView({ data: { allow: true, changed_by: 'user:a', elevated: true, warning: '관리자 Daemon' } }, { which: 'nodeShell', canAsk: true });
  assert.equal(on.on, true); assert.match(on.banner, /노드 셸 허용 중/); assert.match(on.note, /관리자 Daemon/);
  assert.equal(dangerView({ data: { allow: true } }, { which: 'nodeShell', remote: true }).btnOff, true, '원격 제어기는 읽기만');
  assert.equal(dangerView({ err: { code: 'NOT_FOUND' } }, { which: 'nodeShell' }).state, 'unsupported');
  assert.match(dangerView({ data: { allow: true } }, { which: 'nodeShell', canAsk: true }).hint, /node-shell\.post/);
});

test('붙기 실패 — 세션을 바로 닫는다(60초 기다리지 않게) · 실패 상태', async () => {
  const R = rig({ stream: () => { throw err('DELEGATION_NOT_OPEN', '', 403); } });
  assert.equal(await R.ctl.open({}), false);
  assert.ok(R.calls.some((c) => c[0] === OPS.close && c[1].session_id === 'ts_1'), '붙지 못한 세션 DELETE');
  assert.equal(R.ctl.state().phase, 'error'); assert.match(R.ctl.state().text, /위임 안 됨/);
});

test('닫기 — 스트림을 닫고 세션을 DELETE, 그 뒤 입력은 나가지 않는다 · 끊김 안내가 뜨지 않는다', async () => {
  const R = rig(); await R.ctl.open({});
  await R.ctl.close();
  assert.equal(R.closes.length, 1); assert.deepEqual(R.calls.at(-1), [OPS.close, { session_id: 'ts_1' }]);
  assert.equal(R.ctl.state().phase, 'idle'); assert.equal(R.ctl.input('x'), false);
  R.onClose({ code: 1000, reason: '' }); assert.equal(R.ctl.state().phase, 'idle', '우리가 닫은 스트림의 onClose 는 끊김이 아니다');
  // 열려 있지 않을 때의 close 는 DELETE 하지 않는다
  const n = R.calls.length; await R.ctl.close(); assert.equal(R.calls.length, n);
});

test('크기 — 붙은 뒤 칸 수가 바뀌면 resize.post · 화면도 같이 · 같으면 부르지 않는다', async () => {
  const R = rig(); await R.ctl.open({ cols: 80, rows: 24 });
  const n = R.calls.length; R.ctl.fit(80, 24); assert.equal(R.calls.length, n);
  R.ctl.fit(120, 40);
  assert.deepEqual(R.calls.at(-1), [OPS.resize, { session_id: 'ts_1', cols: 120, rows: 40 }]);
  assert.equal(R.ctl.state().cols, 120); assert.equal(R.ctl.view().length, 40); assert.equal(R.ctl.view()[0].runs.map((r) => r.t).join('').length, 120);
});

test('크기 — resize.post 가 실패하면 스트림 제어 프레임으로 · 승인 문이 cols/rows 를 못 실었으면 붙은 직후 맞춘다', async () => {
  const R = rig({ resizeFails: true }); await R.ctl.open({ cols: 80, rows: 24 });
  R.ctl.fit(100, 30); await new Promise((r) => setTimeout(r, 5));
  assert.ok(R.sent.some((v) => typeof v === 'string' && JSON.parse(v).type === 'resize' && JSON.parse(v).cols === 100), '제어 프레임(텍스트)');
  const R2 = rig({ sessCols: 80, sessRows: 24 }); await R2.ctl.open({ cols: 132, rows: 43 });   // 세션은 기본 80×24 로 열렸다
  assert.deepEqual(R2.calls.at(-1), [OPS.resize, { session_id: 'ts_1', cols: 132, rows: 43 }]);
});

test('끊김 · 셸 종료 — 상태와 안내, 입력은 막고 다시 열 수 있다', async () => {
  const R = rig(); await R.ctl.open({});
  R.onClose({ code: 1000, reason: 'shell exited' });
  assert.equal(R.ctl.state().phase, 'closed'); assert.equal(R.ctl.state().code, 'SHELL_EXITED'); assert.match(R.ctl.state().text, /셸이 끝남/);
  assert.equal(R.ctl.input('x'), false);
  assert.equal(shellPanel({ mode: 'real', shell: R.ctl.state() }).canOpen, true);
  const R2 = rig(); await R2.ctl.open({}); R2.onClose({ code: 1006, reason: '' });
  assert.equal(R2.ctl.state().code, 'DISCONNECTED'); assert.match(R2.ctl.state().text, /끊김/);
  R2.ctl.reset(); assert.equal(R2.ctl.state().phase, 'idle');
});

test('노드가 묻는 질의(커서 위치) — 창이 바이트로 답한다', async () => {
  const R = rig(); await R.ctl.open({});
  R.push('ab\x1b[6n'); assert.equal(dec.decode(R.sent.at(-1)), '\x1b[1;3R');
});

test('열기 중 다시 열기 · 열린 채 다시 열기는 무시', async () => {
  const R = rig(); const a = R.ctl.open({}), b = R.ctl.open({}); assert.equal(await b, false); assert.equal(await a, true);
  assert.equal(await R.ctl.open({}), false); assert.equal(R.calls.filter((c) => c[0] === OPS.open).length, 1);
});

test('원격 제어기 — 열지 않고 §2.5 식 이유(원격 관리가 켜져 있어도 같다) · 승인 문 없음 · 시안', () => {
  const P = shellPanel({ mode: 'real', remote: true, node: 'server', shell: { phase: 'idle' } });
  assert.equal(P.kind, 'remote'); assert.equal(P.canOpen, false); assert.equal(P.text, remoteText('server')); assert.match(P.text, /server 의 제어기에서만/);
  assert.equal(shellPanel({ mode: 'real', canApprove: false, shell: { phase: 'idle' } }).kind, 'noDoor');
  assert.equal(shellPanel({ mode: 'sim' }).kind, 'sim');
  assert.match(errorLine(OPS.open, err('REMOTE_MANAGEMENT_DISABLED'), { node: 'server' }), /server 의 원격 관리가 꺼져 있음/);
});

test('키 변환 — 특수 키 · Ctrl · Alt · 글자는 입력 칸에 맡긴다', () => {
  const k = (key, o = {}) => keyBytes({ key, ...o });
  assert.equal(k('Enter'), '\r'); assert.equal(k('Backspace'), '\x7f'); assert.equal(k('Tab'), '\t'); assert.equal(k('Tab', { shiftKey: true }), '\x1b[Z'); assert.equal(k('Escape'), '\x1b');
  assert.equal(k('ArrowUp'), '\x1b[A'); assert.equal(k('ArrowLeft'), '\x1b[D'); assert.equal(k('Delete'), '\x1b[3~'); assert.equal(k('PageUp'), '\x1b[5~'); assert.equal(k('F5'), '\x1b[15~');
  assert.equal(k('c', { ctrlKey: true }), '\x03'); assert.equal(k('d', { ctrlKey: true }), '\x04'); assert.equal(k('l', { ctrlKey: true }), '\x0c'); assert.equal(k('ArrowRight', { ctrlKey: true }), '\x1b[1;5C');
  assert.equal(k('b', { altKey: true }), '\x1bb');
  assert.equal(k('a'), null, '보이는 글자는 입력 칸(input 이벤트)'); assert.equal(k('한'), null);
  assert.equal(k('c', { ctrlKey: true, shiftKey: true }), null, 'Ctrl+Shift+C 는 브라우저 복사'); assert.equal(k('v', { metaKey: true }), null);
  assert.equal(k('Enter', { isComposing: true }), null, '한글 조합 중 Enter 는 조합이 먼저'); assert.equal(k('Process'), null);
});

test('스크롤백 거슬러 보기 — 입력하면 맨 아래로', async () => {
  const R = rig(); await R.ctl.open({ cols: 10, rows: 3 });
  R.push('1\r\n2\r\n3\r\n4\r\n5');
  R.ctl.scroll(2); assert.equal(R.ctl.state().offset, 2); assert.deepEqual(R.ctl.text().map((l) => l.trim()), ['1', '2', '3']);
  R.ctl.input('x'); assert.equal(R.ctl.state().offset, 0);
  R.ctl.scroll(99); assert.equal(R.ctl.state().offset, 2, '있는 만큼만');
  R.push('y'); assert.equal(R.ctl.state().offset, 0, '새 출력은 맨 아래로');
});
