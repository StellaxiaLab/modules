import { describe, expect, it } from 'vitest';
import { parseEntry, type Entry } from '../src/api/types';
import { callFromTransport } from '../src/app/call-adapter';
import { formatCount, formatKB, formatRemaining, formatTokens, relativeTime } from '../src/app/format';
import { composerHeight, draftStatus, isImeKey, shouldSubmitOnKey } from '../src/app/input';
import { parseHash, routeHash } from '../src/app/router';
import { FOLLOW_THRESHOLD_PX, isFollowing, scrollTopAfterAppend, scrollTopAfterPrepend } from '../src/app/scroll';
import { turnCallsByDone } from '../src/app/turns';
import { FakeTransport, reply } from '../src/transport';
import { raw } from './helpers';

const entry = (seq: number, kind: string, extra: Record<string, unknown> = {}): Entry => parseEntry(raw(seq, kind, extra)) as Entry;

describe('router', () => {
  it('hash 를 경로로 읽고 되돌린다', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/new')).toEqual({ name: 'new' });
    expect(parseHash('#/s/abc-1')).toEqual({ name: 'session', id: 'abc-1' });
    expect(routeHash({ name: 'session', id: 'abc-1' })).toBe('#/s/abc-1');
    expect(routeHash({ name: 'new' })).toBe('#/new');
    expect(routeHash({ name: 'home' })).toBe('#/');
  });
  it('세션 id 패턴에 맞지 않으면 홈으로 떨어진다', () => {
    expect(parseHash('#/s/')).toEqual({ name: 'home' });
    expect(parseHash('#/s/.bad')).toEqual({ name: 'home' });
    expect(parseHash('#/s/a b')).toEqual({ name: 'home' });
    expect(parseHash('#/s/%E0%A4%A')).toEqual({ name: 'home' });
    expect(parseHash('#/s/a/b')).toEqual({ name: 'home' });
  });
});

describe('format', () => {
  const T = 1_700_000_000_000;
  it('상대 시각은 앱이 계산한다', () => {
    expect(relativeTime(T - 5_000, T)).toBe('방금');
    expect(relativeTime(T - 12 * 60_000, T)).toBe('12분 전');
    expect(relativeTime(T - 3 * 3_600_000, T)).toBe('3시간 전');
    expect(relativeTime(T - 30 * 3_600_000, T)).toBe('어제');
    expect(relativeTime(T - 5 * 86_400_000, T)).toBe('5일 전');
    expect(relativeTime(0, T)).toBe('');
  });
  it('토큰·바이트·남은 시간', () => {
    expect(formatTokens(18_200)).toBe('18.2k');
    expect(formatTokens(950)).toBe('950');
    expect(formatCount(14060)).toBe('14,060');
    expect(formatKB(12_698)).toBe('12.4');
    expect(formatRemaining(270_000)).toBe('4:30');
    expect(formatRemaining(-5)).toBe('0:00');
  });
});

describe('입력 규칙', () => {
  const key = (over: Partial<Parameters<typeof shouldSubmitOnKey>[0]> = {}) => ({ key: 'Enter', shiftKey: false, ...over });
  it('Enter 만 보낸다', () => {
    expect(shouldSubmitOnKey(key())).toBe(true);
    expect(shouldSubmitOnKey(key({ key: 'a' }))).toBe(false);
  });
  it('Shift+Enter 는 줄바꿈이다', () => {
    expect(shouldSubmitOnKey(key({ shiftKey: true }))).toBe(false);
  });
  it('한글 조합 중 Enter 는 보내지 않는다 — isComposing · keyCode 229 · 조합 이벤트 상태', () => {
    expect(shouldSubmitOnKey(key({ isComposing: true }))).toBe(false);
    expect(shouldSubmitOnKey(key({ keyCode: 229 }))).toBe(false);
    expect(shouldSubmitOnKey(key(), true)).toBe(false);
    expect(isImeKey({ keyCode: 13 })).toBe(false);
    expect(shouldSubmitOnKey(key({ keyCode: 13, isComposing: false }))).toBe(true);
  });
  it('글자 수는 문자(코드 포인트)로 센다 — 20000 은 되고 20001 은 안 된다', () => {
    expect(draftStatus('a'.repeat(20000)).over).toBe(false);
    expect(draftStatus('a'.repeat(20001)).over).toBe(true);
    expect(draftStatus('a'.repeat(20001)).sendable).toBe(false);
    expect(draftStatus('😀'.repeat(20000)).over).toBe(false); // UTF-16 으로는 40000
    expect(draftStatus('😀'.repeat(20000)).length).toBe(20000);
    expect(draftStatus('  \n ').blank).toBe(true);
    expect(draftStatus('  \n ').sendable).toBe(false);
    expect(draftStatus('안녕').label).toBe('2 / 20000');
  });
  it('높이는 32px 에서 120px 까지 자란다 (GAP-3)', () => {
    expect(composerHeight(20)).toBe(32);
    expect(composerHeight(112)).toBe(112);
    expect(composerHeight(400)).toBe(120);
  });
});

describe('스크롤 규칙 (GAP-4)', () => {
  const m = (scrollTop: number, scrollHeight: number, clientHeight = 600) => ({ scrollTop, scrollHeight, clientHeight });
  it('맨 아래 40px 안이면 따라간다', () => {
    expect(isFollowing(m(400, 1000))).toBe(true);
    expect(isFollowing(m(360, 1000))).toBe(true);
    expect(isFollowing(m(360 - 1, 1000))).toBe(false);
    expect(FOLLOW_THRESHOLD_PX).toBe(40);
  });
  it('새 줄: 따라가는 중이면 바닥으로, 올려 읽는 중이면 읽던 자리(scrollTop) 그대로', () => {
    expect(scrollTopAfterAppend(true, m(400, 1000), m(400, 1331))).toBe(731);
    expect(scrollTopAfterAppend(false, m(120, 1000), m(120, 1331))).toBe(120);
  });
  it('오래된 줄을 위에 붙이면 늘어난 만큼 내려 읽던 줄이 그대로 있다', () => {
    expect(scrollTopAfterPrepend(m(30, 1000), m(30, 1450))).toBe(480);
  });
});

describe('차례 줄 재료', () => {
  it('done 줄마다 그 차례의 model 줄 수를 센다', () => {
    const entries = [
      entry(1, 'user'),
      entry(2, 'model'),
      entry(3, 'call'),
      entry(4, 'model'),
      entry(5, 'done'),
      entry(6, 'user'),
      entry(7, 'model'),
      entry(8, 'done'),
    ];
    const turns = turnCallsByDone(entries);
    expect(turns.get(5)).toBe(2);
    expect(turns.get(8)).toBe(1);
  });
});

describe('transport → CallFn 어댑터', () => {
  const P = '/api/modules/io.terra.agent/v1';
  it('성공은 그대로, 모듈·Gateway 코드는 code 로 옮긴다', async () => {
    const t = new FakeTransport();
    t.on(`GET ${P}/status`, reply.ok({ status: 'ok', version: '0.1.0' }));
    t.on(`GET ${P}/credentials`, reply.fail(409, 'CREDENTIAL_MISSING', 'no credential'));
    t.on(`GET ${P}/models`, reply.gatewayFail(403, 'MODULE_PERMISSION_DENIED', 'denied'));
    const call = callFromTransport(t);
    expect(await call({ method: 'GET', path: `${P}/status` })).toEqual({ ok: true, status: 200, data: { status: 'ok', version: '0.1.0' } });
    const missing = await call({ method: 'GET', path: `${P}/credentials` });
    expect(missing).toMatchObject({ ok: false, status: 409, code: 'CREDENTIAL_MISSING' });
    const denied = await call({ method: 'GET', path: `${P}/models` });
    expect(denied).toMatchObject({ ok: false, status: 403, code: 'MODULE_PERMISSION_DENIED' });
  });
  it('전송이 스스로 만든 실패는 code 를 비우고 outcomeUnknown 을 싣는다 — 사전은 상태·outcomeUnknown 으로 푼다', async () => {
    const t = new FakeTransport();
    t.on(`POST ${P}/sessions/s1/messages`, reply.networkError('boom'));
    const call = callFromTransport(t);
    const r = await call({ method: 'POST', path: `${P}/sessions/s1/messages`, body: { text: 'x' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBeUndefined();
      expect(r.outcomeUnknown).toBe(true);
    }
  });
  it('사전에 없는 서버 코드는 원문 코드를 code 로 둔다', async () => {
    const t = new FakeTransport();
    t.on(`GET ${P}/status`, reply.fail(418, 'TEAPOT', 'short and stout'));
    const r = await callFromTransport(t)({ method: 'GET', path: `${P}/status` });
    expect(r).toMatchObject({ ok: false, status: 418, code: 'TEAPOT' });
  });
});
