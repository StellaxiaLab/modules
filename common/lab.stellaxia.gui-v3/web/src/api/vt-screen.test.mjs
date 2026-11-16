// node --test — 최소 터미널 화면(노드 셸): 글자 · 줄바꿈 · 색 · 커서 · 지우기 · 스크롤백 · 대체 화면 · 질의 응답 · 크기
import test from 'node:test';
import assert from 'node:assert/strict';
import { VtScreen, charWidth, color256 } from './vt-screen.js';

test('글자 · CRLF · 자동 줄바꿈 · 스크롤과 스크롤백', () => {
  const v = new VtScreen(5, 3);
  v.write('ab\r\ncd');
  assert.deepEqual(v.text(), ['ab', 'cd', '']);
  v.write('\r\nef\r\ngh');                       // 4번째 줄 → 한 줄 밀림
  assert.deepEqual(v.text(), ['cd', 'ef', 'gh']); assert.equal(v.history, 1);
  assert.deepEqual(v.text(1), ['ab', 'cd', 'ef']); // 스크롤백을 한 줄 거슬러
  const w = new VtScreen(4, 2); w.write('abcdef');
  assert.deepEqual(w.text(), ['abcd', 'ef']);      // 자동 줄바꿈
});

test('SGR — 16색 · 256색 · 24비트 · 굵게 · 밑줄 · 반전 · 초기화', () => {
  const v = new VtScreen(10, 1);
  v.write('\x1b[31mR\x1b[1;4mB\x1b[0mn\x1b[38;5;196mX\x1b[48;2;1;2;3mY\x1b[7mZ');
  const r = v.view()[0].runs;
  assert.equal(r[0].t, 'R'); assert.equal(r[0].fg, '#e5604f'); assert.equal(r[1].fl & 1, 1); assert.equal(r[1].fl & 4, 4);
  assert.equal(r[2].t, 'n'); assert.equal(r[2].fg, '');
  assert.equal(r[3].fg, color256(196)); assert.equal(r[4].bg, '#010203');
  assert.equal(r[5].t, 'Z'); assert.ok(r[5].bg, '반전은 색을 맞바꿔 반영');
});

test('커서 이동 · 지우기 · 줄 넣고 빼기 · 글자 지우기', () => {
  const v = new VtScreen(6, 3);
  v.write('abcdef\r\nghijkl\r\nmnopqr');
  v.write('\x1b[1;3H\x1b[K');                       // (1,3)부터 줄 끝까지
  assert.equal(v.text()[0], 'ab');
  v.write('\x1b[2;2H\x1b[2P');                      // 두 글자 빼기
  assert.equal(v.text()[1], 'gjkl');
  v.write('\x1b[3;1H\x1b[2K'); assert.equal(v.text()[2], '');
  v.write('\x1b[2J\x1b[H'); assert.deepEqual(v.text(), ['', '', '']);
  v.write('x\x1b[2Cy\x1b[1Dz'); assert.equal(v.text()[0], 'x  z');   // C 2칸 뒤 y, D 1칸 앞 z 가 y 를 덮음
});

test('BS · TAB · 결합 글자 · 넓은 글자(한글)', () => {
  const v = new VtScreen(12, 1);
  v.write('ab\bX\tZ'); assert.equal(v.text()[0], 'aX      Z');
  const k = new VtScreen(6, 2); k.write('한글a'); assert.equal(k.text()[0], '한글a');
  assert.equal(charWidth('한'.codePointAt(0)), 2); assert.equal(charWidth(0x301), 0); assert.equal(charWidth(65), 1);
  const w = new VtScreen(5, 2); w.write('abcd한');   // 남은 칸이 1 이라 넘어간다
  assert.deepEqual(w.text(), ['abcd', '한']);
});

test('스크롤 영역(DECSTBM) · 역방향 인덱스', () => {
  const v = new VtScreen(3, 4);
  v.write('1\r\n2\r\n3\r\n4'); v.write('\x1b[2;3r');   // 2~3 줄만 스크롤
  v.write('\x1b[3;1H\r\nX');                            // 영역 끝에서 줄바꿈 → 2~3 줄만 밀림
  assert.deepEqual(v.text(), ['1', '3', 'X', '4']);
  assert.equal(v.history, 0, '영역 스크롤은 스크롤백에 안 쌓는다');
});

test('대체 화면(1049) — 들어갔다 나오면 원래 화면 · 스크롤백 안 쌓음', () => {
  const v = new VtScreen(4, 2); v.write('main');
  v.write('\x1b[?1049h'); assert.deepEqual(v.text(), ['', '']); v.write('vim\r\nzz\r\nq'); assert.equal(v.history, 0);
  v.write('\x1b[?1049l'); assert.equal(v.text()[0], 'main');
});

test('질의 응답 — 커서 위치(6n) · 장치 속성(c) · 제목(OSC) · 커서 숨김', () => {
  const replies = [], titles = [];
  const v = new VtScreen(10, 5, { onReply: (s) => replies.push(s), onTitle: (t) => titles.push(t) });
  v.write('ab\x1b[6n\x1b[c'); assert.deepEqual(replies, ['\x1b[1;3R', '\x1b[?1;2c']);
  v.write('\x1b]0;내 셸\x07'); v.write('\x1b]2;둘째\x1b\x5c'); assert.deepEqual(titles, ['내 셸', '둘째']);
  v.write('\x1b[?25l'); assert.equal(v.view()[0].cur, -1); v.write('\x1b[?25h'); assert.equal(v.view()[0].cur, 2);
});

test('모르는 순서 · 잘린 순서는 화면을 깨지 않는다', () => {
  const v = new VtScreen(8, 2);
  v.write('a\x1b[?9999z\x1b(Bb\x1bPxyz\x1b\x5cc\x1b['); v.write('1mD');
  assert.equal(v.text()[0], 'abcD');
});

test('크기 바꾸기 — 줄이면 커서 위 줄이 스크롤백으로, 키우면 아래가 빈칸', () => {
  const v = new VtScreen(6, 4); v.write('1\r\n2\r\n3\r\n4');
  v.resize(6, 2); assert.deepEqual(v.text(), ['3', '4']); assert.equal(v.history, 2);
  v.resize(8, 3); assert.equal(v.rows, 3); assert.equal(v.cols, 8); assert.equal(v.view()[0].runs.map((r) => r.t).join('').length, 8);
});

test('커서 칸 — 마지막 줄 · 맨 아래에서만 반전으로 보인다', () => {
  const v = new VtScreen(4, 2); v.write('ab');
  const l = v.view()[0]; assert.equal(l.cur, 2); const cur = l.runs.find((r) => r.bg); assert.ok(cur && cur.t === ' ');
  assert.equal(v.view(0)[1].cur, -1);
});
