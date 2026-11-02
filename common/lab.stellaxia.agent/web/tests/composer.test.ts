// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createCancelDialog } from '../src/views/cancel-dialog';
import { createComposer, type ComposerModel, type ComposerView } from '../src/views/composer';

function model(over: Partial<ComposerModel> = {}): ComposerModel {
  return { sessionId: 's1', draft: '', resetKey: 0, locked: false, placeholder: '이어서 물어보세요', lockReason: null, sending: false, footNote: '', notice: null, ...over };
}

function setup(over: Partial<ComposerModel> = {}): { c: ComposerView; sent: string[]; drafts: Array<[string, string]> } {
  const sent: string[] = [];
  const drafts: Array<[string, string]> = [];
  const c = createComposer({ onSubmit: (t) => sent.push(t), onDraft: (id, t) => drafts.push([id, t]) });
  document.body.replaceChildren(c.el);
  c.update(model(over));
  return { c, sent, drafts };
}

function type(c: ComposerView, text: string): void {
  c.textarea.value = text;
  c.textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(c: ComposerView, init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { get: () => init.keyCode });
  c.textarea.dispatchEvent(e);
  return e;
}

beforeEach(() => document.body.replaceChildren());

describe('화면 7 — 입력', () => {
  it('<textarea> 이고 이름이 있다', () => {
    const { c } = setup();
    expect(c.textarea.tagName).toBe('TEXTAREA');
    expect(c.textarea.getAttribute('aria-label')).toBe('세션에 보낼 글');
  });

  it('Enter 는 보낸다, Shift+Enter 는 줄바꿈이다 (보내지 않고 기본 동작을 막지 않는다)', () => {
    const { c, sent } = setup();
    type(c, '안녕');
    const shift = press(c, { key: 'Enter', shiftKey: true });
    expect(sent).toEqual([]);
    expect(shift.defaultPrevented).toBe(false);
    const enter = press(c, { key: 'Enter' });
    expect(sent).toEqual(['안녕']);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('한글 조합 중 Enter 는 보내지 않는다 — isComposing · keyCode 229 · compositionstart', () => {
    const { c, sent } = setup();
    type(c, '한');
    press(c, { key: 'Enter', isComposing: true });
    press(c, { key: 'Enter', keyCode: 229 });
    c.textarea.dispatchEvent(new Event('compositionstart'));
    press(c, { key: 'Enter' });
    expect(sent).toEqual([]);
    c.textarea.dispatchEvent(new Event('compositionend'));
    press(c, { key: 'Enter' });
    expect(sent).toEqual(['한']);
  });

  it('공백만은 보낼 수 없다 (버튼 꺼짐 · Enter 무시)', () => {
    const { c, sent } = setup();
    type(c, '   \n  ');
    expect(c.sendButton.disabled).toBe(true);
    press(c, { key: 'Enter' });
    c.sendButton.click();
    expect(sent).toEqual([]);
  });

  it('글자 수 표시와 20000자 제한 — 20001자면 표시가 바뀌고 버튼이 꺼지고 Enter 도 무시된다', () => {
    const { c, sent } = setup();
    type(c, 'a'.repeat(20000));
    expect(c.el.querySelector('.count')?.textContent).toBe('20000 / 20000');
    expect(c.sendButton.disabled).toBe(false);
    type(c, 'a'.repeat(20001));
    const count = c.el.querySelector('.count') as HTMLElement;
    expect(count.classList.contains('over')).toBe(true);
    expect(count.textContent).toContain('20001 / 20000');
    expect(c.sendButton.disabled).toBe(true);
    press(c, { key: 'Enter' });
    c.sendButton.click();
    expect(sent).toEqual([]);
  });

  it('높이가 내용에 따라 자라되 120px 을 넘지 않는다 (GAP-3)', () => {
    const { c } = setup();
    let scrollHeight = 20;
    Object.defineProperty(c.textarea, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    type(c, 'a');
    expect(c.textarea.style.height).toBe('32px');
    scrollHeight = 112;
    type(c, 'a\nb\nc\nd\ne');
    expect(c.textarea.style.height).toBe('112px');
    scrollHeight = 480;
    type(c, 'x\n'.repeat(30));
    expect(c.textarea.style.height).toBe('120px');
    expect(c.textarea.style.overflowY).toBe('auto');
  });

  it('잠그면 입력칸과 버튼이 꺼지고 이유가 안내 글로 보인다', () => {
    const { c, sent } = setup({ locked: true, placeholder: '모델이 답하는 중', lockReason: '모델이 답하는 중' });
    expect(c.textarea.disabled).toBe(true);
    expect(c.sendButton.disabled).toBe(true);
    expect(c.textarea.placeholder).toBe('모델이 답하는 중');
    press(c, { key: 'Enter' });
    expect(sent).toEqual([]);
  });

  it('보내는 중에는 연타해도 한 번이다', () => {
    const { c, sent } = setup({ draft: '안녕' });
    expect(c.textarea.value).toBe('안녕');
    c.sendButton.click();
    expect(sent).toEqual(['안녕']);
    c.update(model({ draft: '안녕', sending: true }));
    expect(c.sendButton.disabled).toBe(true);
    c.sendButton.click();
    press(c, { key: 'Enter' });
    expect(sent).toEqual(['안녕']);
  });

  it('갱신이 타이핑을 덮어쓰지 않고, 세션이 바뀌거나 resetKey 가 바뀔 때만 값을 되돌린다 (초점·조합 유지)', () => {
    const { c, drafts } = setup({ draft: '' });
    type(c, '쓰는 중');
    c.update(model({ draft: '' })); // 폴링으로 같은 세션이 다시 그려진다
    expect(c.textarea.value).toBe('쓰는 중');
    expect(drafts.at(-1)).toEqual(['s1', '쓰는 중']);
    c.update(model({ sessionId: 's2', draft: '다른 세션 초안' }));
    expect(c.textarea.value).toBe('다른 세션 초안');
    c.update(model({ sessionId: 's2', draft: '', resetKey: 1 })); // 보낸 뒤 비운다
    expect(c.textarea.value).toBe('');
  });

  it('알림(outcomeUnknown 안내 등)이 role=status 로 보이고 지워진다', () => {
    const { c } = setup({ notice: { tone: 'warn', text: '처리됐는지 알 수 없습니다' } });
    const n = c.el.querySelector<HTMLElement>('[role=status]');
    expect(n?.hidden).toBe(false);
    expect(n?.textContent).toBe('처리됐는지 알 수 없습니다');
    c.update(model({ notice: null }));
    expect(n?.hidden).toBe(true);
  });

  it('모델·외부 텍스트가 아니라 사용자의 글도 글자 그대로 다룬다 (value 로만)', () => {
    const { c, sent } = setup();
    type(c, '<script>alert(1)</script> {{x}}');
    press(c, { key: 'Enter' });
    expect(sent).toEqual(['<script>alert(1)</script> {{x}}']);
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('취소 확인창', () => {
  function dialog(): { d: ReturnType<typeof createCancelDialog>; log: string[]; app: HTMLElement; opener: HTMLButtonElement } {
    const log: string[] = [];
    const app = document.createElement('div');
    const opener = document.createElement('button');
    opener.textContent = '취소';
    app.append(opener);
    const d = createCancelDialog({ onKeep: () => log.push('keep'), onConfirm: () => log.push('confirm') }, app);
    document.body.append(app, d.el);
    return { d, log, app, opener };
  }

  it('role=dialog · aria-modal 이고, 열면 안전한 쪽(그대로 두기)에 초점이 가고 뒤는 inert 다', () => {
    const { d, app, opener } = dialog();
    opener.focus();
    d.update({ open: true, title: '로그 정리', busy: false, error: null });
    const dlg = d.el.querySelector('[role=dialog]');
    expect(dlg?.getAttribute('aria-modal')).toBe('true');
    expect(dlg?.getAttribute('aria-labelledby')).toBe('cancel-title');
    expect(d.el.hidden).toBe(false);
    expect(document.activeElement?.getAttribute('data-role')).toBe('cancel-keep');
    expect(app.hasAttribute('inert')).toBe(true);
    expect(d.el.textContent).toContain('로그 정리');
    expect(d.el.textContent).toContain('취소는 되돌릴 수 없습니다');
  });

  it('Esc 는 그대로 두기, 확인 버튼은 취소 확정 — 닫히면 초점이 돌아간다', () => {
    const { d, log, app, opener } = dialog();
    opener.focus();
    d.update({ open: true, title: 't', busy: false, error: null });
    d.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(log).toEqual(['keep']);
    d.el.querySelector<HTMLButtonElement>('[data-role=cancel-confirm]')?.click();
    expect(log).toEqual(['keep', 'confirm']);
    d.update({ open: false, title: 't', busy: false, error: null });
    expect(d.el.hidden).toBe(true);
    expect(app.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('Tab 은 창 안에서만 돈다', () => {
    const { d } = dialog();
    d.update({ open: true, title: 't', busy: false, error: null });
    const keep = d.el.querySelector<HTMLButtonElement>('[data-role=cancel-keep]') as HTMLButtonElement;
    const confirm = d.el.querySelector<HTMLButtonElement>('[data-role=cancel-confirm]') as HTMLButtonElement;
    confirm.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    confirm.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(keep);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    keep.dispatchEvent(back);
    expect(document.activeElement).toBe(confirm);
  });

  it('취소하는 중에는 두 버튼이 꺼지고, 실패하면 이유가 role=alert 로 보인다', () => {
    const { d } = dialog();
    d.update({ open: true, title: 't', busy: true, error: null });
    expect(d.el.querySelector<HTMLButtonElement>('[data-role=cancel-confirm]')?.disabled).toBe(true);
    expect(d.el.querySelector<HTMLButtonElement>('[data-role=cancel-keep]')?.disabled).toBe(true);
    d.update({ open: true, title: 't', busy: false, error: '연결할 수 없습니다.' });
    expect(d.el.querySelector('[role=alert]')?.textContent).toBe('연결할 수 없습니다.');
  });
});
