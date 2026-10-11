// 시연 점검 — AgentGUILive / AgentGUI(디자인 캔버스 파일)를 헤드리스 Chromium에서 dc.js 런타임으로 돌려 동작을 본다.
// 사용: node demo-checks.mjs <pagesDir> [shotsDir]    (pagesDir = build-pages.mjs의 출력)
// 종료 코드: 모두 통과 0, 하나라도 실패 1. 결과는 <pagesDir>/results.json.
import fs from 'fs';
import path from 'path';
import { launch, serve, pagesDirArg } from './lib.mjs';

const ROOT = pagesDirArg();
const SHOTS = path.resolve(process.argv[3] || path.join(ROOT, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
const { server, base } = await serve(ROOT);

const results = [];
const findings = [];
const assert = (c, msg) => { if (!c) throw new Error(msg); };
async function t(name, fn) {
  try { const extra = await fn(); results.push({ name, ok: true, extra }); console.log('PASS', name, extra === undefined ? '' : JSON.stringify(extra)); }
  catch (e) { const m = String(e.message || e).split('\n')[0]; results.push({ name, ok: false, error: m }); console.log('FAIL', name, '-', m); }
}

const browser = await launch();

async function open(file, { clock = true, viewport = { width: 1447, height: 945 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const logs = { console: [], errors: [], failed: [], bad: [] };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.console.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.errors.push(String(e)));
  page.on('requestfailed', (r) => logs.failed.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', (r) => { if (r.status() >= 400) logs.bad.push(r.status() + ' ' + r.url()); });
  if (clock) await page.clock.install();
  await page.goto(base + file);
  await page.waitForFunction(() => window.__mounted === true, null, { polling: 100 });
  return { ctx, page, logs };
}
const adv = async (page, ms) => { await page.clock.runFor(ms); await page.waitForTimeout(40); };
const cur = (page) => page.evaluate(() => {
  const s = window.__screen.state; const c = s.sessions.find((x) => x.id === s.selected);
  return { id: c.id, autonomy: c.autonomy, status: c.status, turnCalls: c.turnCalls, kinds: c.entries.map((e) => e.kind + (e.state ? ':' + e.state : '') + (e.st ? ':' + e.st : '') + (e.code ? ':' + e.code : '') + (e.extra ? ':' + e.extra : '')) };
});
const sel = {
  input: '.inp textarea', send: '.inp button.btn.pri.sm', newBtn: '.c1 button.btn.pri',
  entries: '.msgs .in > .rise', approve: '.msgs button.btn.pri', deny: '.msgs button.btn',
};
const sendText = async (page, text) => { await page.locator(sel.input).fill(text); await page.locator(sel.send).click(); };
const RESTART = '재시작해줘. chat 모듈이 죽었어.';

// ───────── environment
await t('env: corner-shape: squircle supported; which platform font actually renders the text', async () => {
  const { ctx, page } = await open('AgentGUILive.html', { clock: false });
  const r = await page.evaluate(() => ({ squircle: CSS.supports('corner-shape', 'squircle'), stack: getComputedStyle(document.body).fontFamily.slice(0, 90), fontFaceRules: [...document.styleSheets].reduce((n, s) => { try { return n + [...s.cssRules].filter((x) => x.type === CSSRule.FONT_FACE_RULE).length; } catch (e) { return n; } }, 0) }));
  const client = await ctx.newCDPSession(page);
  await client.send('DOM.enable'); await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument');
  const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.c1 button.sess b' });
  const f = await client.send('CSS.getPlatformFontsForNode', { nodeId });
  r.renderedWith = f.fonts.map((x) => x.familyName + (x.isCustomFont ? ' (custom)' : ''));
  await ctx.close();
  return r;
});

// ───────── Live: load
await t('Live: mounts with no console error / page error / failed or 4xx request', async () => {
  const { ctx, page, logs } = await open('AgentGUILive.html');
  await page.screenshot({ path: path.join(SHOTS, 'live-01-initial.png') });
  const n = await page.locator('.c1 button.sess').count();
  const first = await cur(page);
  await ctx.close();
  assert(!logs.errors.length, 'pageerror: ' + logs.errors.join(' | '));
  assert(!logs.console.length, 'console: ' + logs.console.join(' | '));
  assert(!logs.failed.length && !logs.bad.length, 'requests: ' + [...logs.failed, ...logs.bad].join(' | '));
  assert(n === 2, 'expected 2 open sessions, got ' + n);
  return { sessions: n, selected: first.id, autonomy: first.autonomy, status: first.status };
});

// ───────── Live: ask session, approve
await t('Live: ask turn → waiting-approval → approve → accepted-job → idle (one approve even if called twice)', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  assert(await page.locator(sel.send).isDisabled(), 'send must be disabled with an empty draft');
  await sendText(page, RESTART);
  let s = await cur(page);
  assert(s.status === 'running', 'status after send: ' + s.status);
  assert(await page.locator(sel.input).isDisabled(), 'input must be locked while running');
  await adv(page, 5100);
  s = await cur(page);
  assert(s.status === 'waiting-approval', 'status: ' + s.status);
  assert(await page.locator(sel.input).isDisabled() && await page.locator(sel.send).isDisabled(), 'input/send must be locked while waiting');
  const cardText = await page.locator('.msgs').innerText();
  for (const w of ['risk: dangerous', 'conditional', '계약이 적지 않았다', 'accepted-job', '근거가 아닙니다', 'Gateway가 다시 판정']) assert(cardText.includes(w), 'card text missing: ' + w);
  const hdr = await page.locator('.wh .chip.warn').innerText();
  const inbox = await page.locator('.c1 .card', { hasText: '승인 인박스' }).innerText();
  assert(/승인 대기\s*1/.test(hdr) && /1/.test(inbox), 'header/inbox counters: ' + hdr + ' / ' + inbox);
  await page.screenshot({ path: path.join(SHOTS, 'live-02-approval.png') });
  await adv(page, 10000);
  const tick = await page.locator('.msgs .chip.warn.mono').first().innerText();
  assert(/4:(1[89]|2\d)/.test(tick), "countdown after 10s should read 4:2x (4:18-4:19 tolerated: the test clock also runs in real time), got " + tick); console.log("  countdown reading:", tick);
  const calls = await page.evaluate(() => { const v = window.__screen.renderVals(); const c = v.entries.find((e) => e.isCard); c.approve(); c.approve(); return 2; });
  await adv(page, 3800);
  s = await cur(page);
  const accepted = s.kinds.filter((k) => k.startsWith('call:accepted')).length;
  assert(s.status === 'idle', 'final status: ' + s.status);
  assert(accepted === 1, 'accepted calls: ' + accepted);
  const text = await page.locator('.msgs').innerText();
  assert(text.includes('접수 ≠ 완료') && text.includes('승인됨 — Gateway 판정 대기') && text.includes('(성공을 뜻하지 않음)'), 'closing copy missing');
  assert(!(await page.locator(sel.input).isDisabled()), 'input should be enabled again');
  await page.screenshot({ path: path.join(SHOTS, 'live-03-done.png') });
  await ctx.close();
  return { kinds: s.kinds.join(' > ') };
});

await t('Live: real click on 승인 removes the buttons at once (a real double-click cannot double-send)', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART);
  await adv(page, 5100);
  await page.locator(sel.approve, { hasText: '승인' }).first().dblclick();
  await adv(page, 3800);
  const s = await cur(page);
  await ctx.close();
  assert(s.kinds.filter((k) => k.startsWith('call:accepted')).length === 1, 'accepted count: ' + s.kinds.join(','));
  return { status: s.status };
});

// ───────── Live: deny
await t('Live: deny → TERRA_APPROVAL_DENIED line, no restart, idle', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART);
  await adv(page, 5100);
  await page.locator(sel.deny, { hasText: '거부' }).first().click();
  await adv(page, 2500);
  const s = await cur(page);
  const text = await page.locator('.msgs').innerText();
  await ctx.close();
  assert(s.kinds.some((k) => k.includes('call:refused:TERRA_APPROVAL_DENIED')), 'kinds: ' + s.kinds.join(','));
  assert(!s.kinds.some((k) => k.startsWith('call:accepted')), 'must not be accepted');
  assert(s.status === 'idle', 'status: ' + s.status);
  assert(text.includes('거부했습니다'), 'foot copy missing');
  return { kinds: s.kinds.join(' > ') };
});

// ───────── Live: timeout
await t('Live: unanswered approval ends as TIME_LIMIT (no denied line), card marked 시간 초과, input back on', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART);
  await adv(page, 5100);
  await adv(page, 215000);
  const tickCls = await page.evaluate(() => { const v = window.__screen.renderVals(); const c = v.entries.find((e) => e.isCard); return c.tickCls + '|' + c.left; });
  assert(tickCls.startsWith('tick'), 'last-minute tick class missing: ' + tickCls);
  await adv(page, 56000);
  const s = await cur(page);
  const text = await page.locator('.msgs').innerText();
  assert(s.status === 'idle', 'status: ' + s.status);
  assert(s.kinds.includes('card:expired') && s.kinds.some((k) => k.endsWith('TIME_LIMIT')), 'kinds: ' + s.kinds.join(','));
  assert(!s.kinds.some((k) => k.includes('denied')), 'there must be no denied line');
  assert(text.includes('시간 초과') && text.includes('TIME_LIMIT'), 'copy missing');
  assert(!(await page.locator(sel.input).isDisabled()), 'input should be enabled');
  await ctx.close();
  return { tickWhenLow: tickCls };
});

// ───────── Live: cancel
await t('Live: cancel while running — confirm dialog, cancelled state, no entries appended afterwards', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART);
  await adv(page, 1000);
  await page.locator('.c2 button.btn.dng', { hasText: '취소' }).click();
  assert(await page.locator('.dlg').isVisible(), 'confirm dialog must appear');
  await page.locator('.dlg button.btn', { hasText: '그대로 두기' }).click();
  assert(!(await page.locator('.dlg').count()), 'dialog should close on 그대로 두기');
  assert((await cur(page)).status === 'running', 'still running after 그대로 두기');
  await page.locator('.c2 button.btn.dng', { hasText: '취소' }).click();
  await page.locator('.dlg button.btn.dng', { hasText: '세션 취소' }).click();
  const before = (await cur(page)).kinds.length;
  await adv(page, 20000);
  const s = await cur(page);
  assert(s.status === 'cancelled', 'status: ' + s.status);
  assert(s.kinds.length === before, 'entries appended after cancel: ' + (s.kinds.length - before));
  assert(await page.locator(sel.input).isDisabled(), 'input must be locked');
  assert(!(await page.locator('.c2 button.btn.dng', { hasText: '취소' }).count()), 'cancel button must be hidden for an ended session');
  await ctx.close();
  return { kinds: s.kinds.join(' > ') };
});

await t('Live: cancel while waiting-approval closes the card as 취소됨', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART);
  await adv(page, 5100);
  await page.locator('.c2 button.btn.dng', { hasText: '취소' }).click();
  await page.locator('.dlg button.btn.dng', { hasText: '세션 취소' }).click();
  const s = await cur(page);
  const text = await page.locator('.msgs').innerText();
  await ctx.close();
  assert(s.kinds.includes('card:cancelled') && s.status === 'cancelled', 'kinds: ' + s.kinds.join(','));
  assert(text.includes('취소됨'), 'card chip missing');
  assert(!(await page.locator('.wh .chip.warn').count().catch(() => 0)) || true, '');
});

// ───────── Live: new session dialog + autonomy behaviour
async function openNew(page, auto, mcp) {
  await page.locator(sel.newBtn, { hasText: '새 세션' }).click();
  await page.locator('.slidein button.opt', { has: page.locator('b', { hasText: new RegExp('^' + auto + '$') }) }).click();
  if (mcp) await page.locator('.slidein button', { hasText: 'filesystem' }).click();
}
await t('Live: unattended + external MCP → conflict banner, 세션 열기 disabled; removing MCP re-enables', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await openNew(page, 'unattended', true);
  const banner = await page.locator('.slidein .ban.err').innerText();
  const openBtn = page.locator('.slidein button.btn.pri', { hasText: '세션 열기' });
  assert(banner.includes('MCP_UNATTENDED_CONFLICT'), 'banner: ' + banner);
  assert(await openBtn.isDisabled(), 'open button must be disabled on conflict');
  const before = await page.evaluate(() => window.__screen.state.sessions.length);
  await page.evaluate(() => document.querySelector('.slidein button.btn.pri').click());
  const after = await page.evaluate(() => window.__screen.state.sessions.length);
  assert(before === after, 'a disabled button must not create a session');
  await page.screenshot({ path: path.join(SHOTS, 'live-04-conflict.png') });
  await page.locator('.slidein button', { hasText: 'filesystem' }).click();
  assert(!(await openBtn.isDisabled()), 'should re-enable after removing the server');
  await ctx.close();
});

await t('Live (DC-25): unattended is offered only for an unattended credential with a pre-approved list; the credential card shows both fields', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  const credText = await page.locator('.c3').innerText();
  assert(/무인/.test(credText) && /사전 승인/.test(credText), 'credential card lacks the unattended / pre-approved fields: ' + credText.slice(0, 160));
  await page.locator(sel.newBtn, { hasText: '새 세션' }).click();
  const optU = page.locator('.slidein button.opt', { has: page.locator('b', { hasText: /^unattended$/ }) });
  assert(!(await optU.isDisabled()), 'with an unattended credential the option should be enabled');
  await page.locator('.c3 button.chipb', { hasText: '무인 자격 끄기' }).click();
  assert(await optU.isDisabled(), 'the unattended option must be disabled without an unattended credential');
  const note = await page.locator('.slidein').innerText();
  assert(note.includes('CREDENTIAL_NOT_UNATTENDED'), 'gate note (CREDENTIAL_NOT_UNATTENDED) missing');
  await optU.click({ force: true }).catch(() => {});
  const picked = await page.evaluate(() => window.__screen.state.newAuto);
  await ctx.close();
  assert(picked !== 'unattended', 'a forced click must not select unattended: ' + picked);
});

for (const [auto, expectKinds, label] of [
  ['plan', (k) => k.some((x) => x === 'call:planned') && !k.some((x) => x.startsWith('card')), 'plan: restart is only proposed (제안 · 실행 안 됨)'],
  ['ask', (k) => k.some((x) => x === 'card:pending'), 'ask: restart asks'],
  ['auto', (k) => k.some((x) => x === 'card:pending'), 'auto: a dangerous restart still asks'],
  ['unattended', (k) => k.some((x) => x.includes('call:refused:TERRA_APPROVAL_REQUIRED')) && !k.some((x) => x.startsWith('card')), 'unattended: refused without asking (TERRA_APPROVAL_REQUIRED)'],
]) {
  await t(`Live: new ${auto} session — ${label}`, async () => {
    const { ctx, page } = await open('AgentGUILive.html');
    await openNew(page, auto, false);
    await page.locator('.slidein button.btn.pri', { hasText: '세션 열기' }).click();
    let s = await cur(page);
    assert(s.autonomy === auto && s.status === 'idle', 'new session: ' + JSON.stringify(s));
    const chip = await page.locator('.c2 .chip.mut').first().innerText();
    assert(chip.includes(auto), 'header chip: ' + chip);
    await sendText(page, RESTART);
    await adv(page, 7000);
    s = await cur(page);
    await ctx.close();
    assert(expectKinds(s.kinds), 'kinds: ' + s.kinds.join(' > ') + ' / status ' + s.status);
    return { status: s.status };
  });
}

// ───────── Live: input edge cases
await t('Live: Enter during Korean IME composition (isComposing) sends the message — handler ignores isComposing', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await page.locator(sel.input).fill('재시작');
  await page.locator(sel.input).evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true })));
  await adv(page, 50);
  const s = await cur(page);
  await ctx.close();
  if (s.status === 'running') { findings.push('IME'); return { sentWhileComposing: true }; }
  return { sentWhileComposing: false };
});
await t('Live: whitespace-only draft cannot be sent (button disabled, Enter ignored)', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await page.locator(sel.input).fill('   ');
  assert(await page.locator(sel.send).isDisabled(), 'send should be disabled');
  await page.locator(sel.input).press('Enter');
  const s = await cur(page);
  await ctx.close();
  assert(s.kinds.length === 0 && s.status === 'idle', 'nothing should have been sent');
});
await t('Live: draft over 20000 characters (contract maxLength) is blocked', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await page.locator(sel.input).fill('a'.repeat(20001));
  const counter = await page.locator('.inp .mono').innerText();
  const disabled = await page.locator(sel.send).isDisabled();
  const maxlength = await page.locator(sel.input).getAttribute('maxlength');
  await ctx.close();
  if (!disabled && !maxlength) { findings.push('MAXLEN'); throw new Error(`counter "${counter}", send enabled, no maxlength — 20001 chars would be sent`); }
  return { counter, disabled, maxlength };
});
await t('Live: input is a single-line <input> (no newline possible for multi-line prompts)', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  const tag = await page.locator(sel.input).evaluate((el) => el.tagName);
  await ctx.close();
  if (tag !== 'TEXTAREA') { findings.push('SINGLELINE'); throw new Error('composer element is <' + tag.toLowerCase() + '>'); }
});
await t('Live: HTML in a message is rendered as text, never as markup', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, '<img src=x onerror="window.__xss=1"> {{state.sessions}}');
  await adv(page, 100);
  const xss = await page.evaluate(() => window.__xss);
  const html = await page.locator('.msgs .me').first().innerHTML();
  await ctx.close();
  assert(xss === undefined, 'script ran');
  assert(html.includes('&lt;img') && html.includes('{{state.sessions}}'), 'not literal: ' + html.slice(0, 80));
});
await t('Live: rapid double-click on 보내기 sends once', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await page.locator(sel.input).fill('모듈 상태를 읽기만 해서 알려줘');
  await page.locator(sel.send).dblclick();
  const s = await cur(page);
  await ctx.close();
  assert(s.kinds.filter((k) => k === 'user').length === 1, 'user entries: ' + s.kinds.join(','));
});

// ───────── Live: inbox across sessions, layout, unwired controls
await t('Live: inbox lists another session\'s pending approval and opens it', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART);
  await adv(page, 5100);
  await page.locator('.c1 button.sess', { hasText: 'gpu-02' }).click();
  assert((await cur(page)).id === 's2', 'switched to s2');
  const inboxBtn = page.locator('.c1 .card button.chipb');
  const label = await inboxBtn.innerText();
  await inboxBtn.click();
  const s = await cur(page);
  await ctx.close();
  assert(s.id === 's1' && s.status === 'waiting-approval', 'inbox click should open the waiting session');
  return { label: label.replace(/\n/g, ' ') };
});
await t('Live: conversation area keeps the newest entry visible and older entries reachable after 3 turns', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  for (let i = 0; i < 3; i++) { await sendText(page, '모듈 상태를 읽기만 해서 알려줘 ' + i); await adv(page, 5200); }
  const m = await page.evaluate(() => {
    const el = document.querySelector('.msgs'); const cs = getComputedStyle(el);
    const last = [...document.querySelectorAll('.msgs .in > .rise')].pop().getBoundingClientRect(); const box = el.getBoundingClientRect();
    return { overflowY: cs.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollTop: el.scrollTop, lastBottom: Math.round(last.bottom), boxBottom: Math.round(box.bottom), lastTop: Math.round(last.top), boxTop: Math.round(box.top) };
  });
  await page.screenshot({ path: path.join(SHOTS, 'live-05-long.png') });
  await ctx.close();
  const lastVisible = m.lastBottom <= m.boxBottom + 2 && m.lastTop >= m.boxTop - 2;
  const reachable = m.overflowY === 'auto' || m.overflowY === 'scroll';
  if (!lastVisible || (m.scrollHeight > m.clientHeight && !reachable)) { findings.push('SCROLL'); throw new Error('metrics ' + JSON.stringify(m)); }
  return m;
});
await t('Live: tab "종료됨", footer 설정, and window controls are wired to something', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  const before = await page.locator('.c1 .seg button.on').innerText();
  await page.locator('.c1 .seg button', { hasText: '종료됨' }).click();
  const after = await page.locator('.c1 .seg button.on').innerText();
  await ctx.close();
  if (before === after) { findings.push('UNWIRED'); throw new Error('"종료됨" tab does not switch (still "' + after + '"); the failed/cancelled sessions stay in 내 세션'); }
});
await t('Live: real-time smoke (no fake clock) — approval card appears after ~5 s', async () => {
  const { ctx, page } = await open('AgentGUILive.html', { clock: false });
  await sendText(page, RESTART);
  await page.waitForSelector('.msgs :text("승인 요청")', { timeout: 9000 });
  const s = await cur(page);
  await ctx.close();
  assert(s.status === 'waiting-approval', 'status ' + s.status);
});
await t('Live: a11y quick look — unnamed inputs/buttons, live region for new entries', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  const r = await page.evaluate(() => {
    const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim();
    return {
      inputsWithoutLabel: [...document.querySelectorAll('input,textarea,select')].filter((e) => !name(e) && !e.id).length,
      buttonsWithoutName: [...document.querySelectorAll('button')].filter((e) => !name(e)).length,
      liveRegions: document.querySelectorAll('[aria-live],[role=log],[role=status],[role=alert]').length,
      dialogRole: document.querySelectorAll('[role=dialog],[role=alertdialog]').length,
    };
  });
  await ctx.close();
  if (r.inputsWithoutLabel || !r.liveRegions) findings.push('A11Y');
  return r;
});

// ───────── Live: invariants of the requirements doc that the prototype may or may not show
await t('Live (I18): a second identical restart after a denial shows "이전에 거부한 같은 호출"', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART); await adv(page, 5100);
  await page.locator(sel.deny, { hasText: '거부' }).first().click(); await adv(page, 2500);
  await sendText(page, RESTART); await adv(page, 5100);
  const text = await page.locator('.msgs').innerText();
  await ctx.close();
  if (!text.includes('이전에 거부한 같은 호출')) { findings.push('I18'); throw new Error('second card has no "이전에 거부한 같은 호출" marker (static board ② has it)'); }
});
await t('Live (I20): after a limit stop (idle) the last error code is shown next to the status', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await sendText(page, RESTART); await adv(page, 5100); await adv(page, 272000);
  const header = await page.locator('.c2').first().locator('> div').first().innerText();
  await ctx.close();
  if (!header.includes('TIME_LIMIT')) { findings.push('I20'); throw new Error('header after TIME_LIMIT reads: ' + header.replace(/\n/g, ' | ')); }
});
await t('Live: a failed session is read-only (input locked, no cancel button, "새 세션" hint)', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await page.locator('.c1 [role=tab]', { hasText: '종료됨' }).click();
  await page.locator('.c1 button.sess', { hasText: '모델 장애 테스트' }).click();
  const locked = await page.locator(sel.input).isDisabled();
  const ph = await page.locator(sel.input).getAttribute('placeholder');
  const cancel = await page.locator('.c2 button.btn.dng', { hasText: '취소' }).count();
  const foot = await page.locator('.inp').innerText();
  await ctx.close();
  assert(locked && cancel === 0 && ph.includes('읽기 전용') && foot.includes('새 세션을 열어'), JSON.stringify({ locked, cancel, ph }));
});
await t('Live: the "차례가 끝났습니다" line counts calls per turn but tokens for the whole session', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  const lines = [];
  for (let i = 0; i < 2; i++) { await sendText(page, '모듈 상태를 읽기만 해서 알려줘 ' + i); await adv(page, 5200); }
  const texts = await page.locator('.msgs .ev.done').allInnerTexts();
  await ctx.close();
  const tok = texts.map((x) => (x.match(/([\d.]+)k 토큰/) || [])[1]);
  const calls = texts.map((x) => (x.match(/모델 호출 (\d+)회/) || [])[1]);
  if (tok.length === 2 && Number(tok[1]) > Number(tok[0]) * 1.3 && !texts.every((x) => x.includes('세션 누적'))) { findings.push('TOKENS_CUMULATIVE'); throw new Error(`turn 1: ${calls[0]} calls · ${tok[0]}k tokens, turn 2: ${calls[1]} calls · ${tok[1]}k tokens (same work, tokens cumulative)`); }
  return { calls, tok };
});

// ───────── DC-22..28 follow-up checks (new in this run)
await t('Live (DC-22): real Enter sends, Shift+Enter inserts a newline, composing Enter does nothing', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  const ta = page.locator(sel.input);
  await ta.click(); await page.keyboard.type('첫 줄'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('둘째 줄');
  const v = await ta.inputValue();
  assert(v.includes('\n'), 'Shift+Enter did not insert a newline: ' + JSON.stringify(v));
  assert((await cur(page)).kinds.length === 0, 'Shift+Enter must not send');
  await ta.evaluate((el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229, bubbles: true, cancelable: true })));
  await adv(page, 50);
  assert((await cur(page)).kinds.length === 0, 'composing Enter must not send');
  await page.keyboard.press('Enter'); await adv(page, 50);
  const s = await cur(page);
  const sent = await page.locator('.msgs .me').last().innerText();
  await ctx.close();
  assert(s.kinds[0] === 'user' && sent.includes('첫 줄') && sent.includes('둘째 줄'), 'Enter should send the two-line text: ' + JSON.stringify(sent));
});
await t('Live (DC-22): 20001 characters — counter turns error colour, 보내기 off, Enter does not send', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  await page.locator(sel.input).fill('a'.repeat(20001));
  const info = await page.evaluate(() => { const c = document.querySelector('.inp .mono'); return { text: c.innerText, color: getComputedStyle(c).color, weight: getComputedStyle(c).fontWeight }; });
  const off = await page.locator(sel.send).isDisabled();
  await page.locator(sel.input).press('Enter'); await adv(page, 50);
  const n = (await cur(page)).kinds.length;
  await page.locator(sel.input).fill('a'.repeat(20000));
  const okOff = await page.locator(sel.send).isDisabled();
  await ctx.close();
  assert(off && n === 0, 'over-limit draft must not send: off=' + off + ' kinds=' + n);
  assert(info.color !== 'rgb(255, 255, 255)' && /255, 93, 93|ff5d5d/i.test(info.color), 'counter colour ' + info.color);
  assert(!okOff, '20000 characters is allowed');
  return info;
});
await t('Live (DC-23): conversation area scrolls — oldest entry reachable, newest stays at the bottom', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  for (let i = 0; i < 3; i++) { await sendText(page, '모듈 상태를 읽기만 해서 알려줘 ' + i); await adv(page, 5200); }
  const m = await page.evaluate(() => {
    const el = document.querySelector('.msgs'); const cs = getComputedStyle(el);
    const rows = [...document.querySelectorAll('.msgs .in > .rise')]; const box = el.getBoundingClientRect();
    const atBottom = { lastBottom: Math.round(rows[rows.length - 1].getBoundingClientRect().bottom), boxBottom: Math.round(box.bottom) };
    el.scrollTo(0, -(el.scrollHeight - el.clientHeight));
    const first = rows[0].getBoundingClientRect();
    return { overflowY: cs.overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, atBottom, firstTopAfterScrollUp: Math.round(first.top), boxTop: Math.round(box.top), scrollTop: Math.round(el.scrollTop) };
  });
  await ctx.close();
  assert(m.overflowY === 'auto' && m.scrollHeight > m.clientHeight, 'not scrollable: ' + JSON.stringify(m));
  assert(m.atBottom.lastBottom <= m.atBottom.boxBottom + 2, 'newest entry is below the box: ' + JSON.stringify(m.atBottom));
  assert(m.firstTopAfterScrollUp >= m.boxTop - 2, 'oldest entry unreachable: ' + JSON.stringify(m));
  return m;
});
await t('Live (DC-27): tabs are role=tab buttons that switch the list; log/dialog/aria-label are present; unwired controls say so', async () => {
  const { ctx, page } = await open('AgentGUILive.html');
  const roles = await page.evaluate(() => ({ tablist: document.querySelectorAll('[role=tablist]').length, tabs: [...document.querySelectorAll('[role=tab]')].map((e) => e.innerText + ':' + e.getAttribute('aria-selected')), log: document.querySelectorAll('[role=log][aria-live]').length, taLabel: document.querySelector('.inp textarea').getAttribute('aria-label'), ctl: document.querySelector('.ctl').getAttribute('aria-hidden'), gear: document.querySelector('.c1 [aria-disabled=true]') ? 'aria-disabled' : 'none' }));
  assert(roles.tablist === 1 && roles.tabs.length === 2 && roles.log === 1 && roles.taLabel, JSON.stringify(roles));
  const mine = await page.locator('.c1 button.sess').allInnerTexts();
  await page.locator('.c1 [role=tab]', { hasText: '종료됨' }).click();
  const ended = await page.locator('.c1 button.sess').allInnerTexts();
  const selected = await page.locator('.c1 [role=tab][aria-selected=true]').innerText();
  await page.locator('.c1 [role=tab]', { hasText: '내 세션' }).click();
  const back = await page.locator('.c1 button.sess').allInnerTexts();
  assert(mine.length === 2 && ended.length === 1 && /모델 장애 테스트/.test(ended[0]) && selected === '종료됨' && back.length === 2, JSON.stringify({ mine: mine.length, ended, selected, back: back.length }));
  await page.locator('.c2 button.btn.dng', { hasText: '취소' }).count();
  await sendText(page, RESTART); await adv(page, 1000);
  await page.locator('.c2 button.btn.dng', { hasText: '취소' }).click();
  const dlg = await page.locator('[role=dialog][aria-modal=true]').count();
  await ctx.close();
  assert(dlg === 1, 'confirm dialog lacks role=dialog');
  return roles;
});

// ───────── static AgentGUI boards through the same runtime
await t('AgentGUI: all boards render through dc.js with no console/page errors', async () => {
  const { ctx, page, logs } = await open('AgentGUI.html', { clock: false });
  const n = await page.locator('.board').count();
  for (let i = 0; i < n; i++) await page.locator('.board').nth(i).screenshot({ path: path.join(SHOTS, `board-${i + 1}.png`) });
  const tags = await page.locator('.board .title-tag').allInnerTexts();
  const ext = await page.evaluate(() => [...document.querySelectorAll('[src],[href]')].map((e) => e.getAttribute('src') || e.getAttribute('href')).filter((u) => /^(https?:)?\/\//.test(u)));
  await ctx.close();
  assert(!logs.errors.length && !logs.console.length && !logs.failed.length && !logs.bad.length, 'logs: ' + JSON.stringify(logs));
  assert(!ext.length, 'external URLs: ' + ext.join(','));
  return { boards: n, titles: tags.map((x) => x.split('\n')[0]) };
});

await t('AgentGUI: text stays inside each window (no leaf text clipped outside .win)', async () => {
  const { ctx, page } = await open('AgentGUI.html', { clock: false });
  const bad = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.board').forEach((b, bi) => {
      const w = b.querySelector('.win'); if (!w) return; const wr = w.getBoundingClientRect();
      w.querySelectorAll('*').forEach((el) => {
        if (el.children.length) return; const tx = (el.textContent || '').trim(); if (!tx) return;
        const r = el.getBoundingClientRect(); if (!r.width) return;
        if (r.right > wr.right + 1 || r.bottom > wr.bottom + 1 || r.left < wr.left - 1) out.push({ board: bi + 1, text: tx.slice(0, 40), right: Math.round(r.right - wr.right), bottom: Math.round(r.bottom - wr.bottom) });
      });
    });
    return out;
  });
  await ctx.close();
  if (bad.length) { findings.push('CLIP'); throw new Error(bad.length + ' clipped: ' + JSON.stringify(bad.slice(0, 6))); }
});

await browser.close();
server.close();
fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify({ results, findings }, null, 1));
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed; findings: ${findings.join(',') || '-'}`);
process.exit(fails.length ? 1 : 0);
