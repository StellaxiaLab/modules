// 접근성·초점·대비·폴백 묶음(§5.3, 요구 §6.5·Q-2). 원본: demo-checks.mjs 의 a11y·DC-27, focus-stops.mjs, contrast-fallback.mjs.
// 서버에 의존하지 않는 점검이라 세션 몇 개만 심고 화면의 성질을 잰다. 선호 설정은 CDP `Emulation.setEmulatedMedia`(prefers-reduced-transparency 는 CDP 로만 켠다).

import { agentApi, assert, openApp, settle, until } from '../lib/app.mjs';
import { check } from '../lib/harness.mjs';

const UI = { apps: ['ui'] };

/** 대화 화면에 줄 종류를 두루 쌓는다 — call(제안·거절)·error·done·assistant·사용자 줄과 마지막 오류 칩. */
async function richSession(t, id = 'rich') {
  const api = agentApi(t);
  await api.open({ id, scenario: 'step-limit', max_steps: 3, topic: '두루 쌓인 세션' });
  const app = await openApp(t, { route: `#/s/${id}` });
  await app.pane.waitFor({ state: 'visible' });
  await app.type('끝까지 읽어 줘');
  await until(async () => (await app.lineKinds()).includes('error'), { message: '오류 줄이 오르지 않았다' });
  await app.waitChip('대기');
  return { api, app };
}

check('접근성: 이름 있는 입력·단추, role=log(aria-live)·role=dialog(aria-modal)·role=tablist/tab, 아직 없는 기능은 없다고 말한다 (DC-27)', async (t) => {
  const { app } = await richSession(t);
  // 이름 없는 입력·단추·링크가 없다.
  const unnamed = await app.f.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input:not([type=hidden]), textarea, select, button, a[href], [role=tab], [role=log], [role=dialog]')) {
      if (el.closest('[hidden]')) continue; // 숨은 것(아직 안 연 확인창의 단추)은 뺀다
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length > 0) || (el.textContent ?? '').trim() !== '';
      if (!labelled) out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`);
    }
    return out;
  });
  assert.deepEqual(unnamed, [], '이름이 없는 조작 요소가 있다');
  assert.equal(await app.textarea.getAttribute('aria-label'), '세션에 보낼 글');
  assert.equal(await app.log.getAttribute('aria-live'), 'polite');
  assert.equal(await app.log.getAttribute('role'), 'log');
  assert.equal(await app.log.getAttribute('tabindex'), '0', '기록 영역은 키보드로 스크롤할 수 있어야 한다');
  assert.equal(await app.$('[role="tablist"]').getAttribute('aria-label'), '세션 목록');
  assert.equal(await app.$('[role="tabpanel"]').getAttribute('aria-labelledby'), 'tab-mine');
  assert.equal(await app.$('[data-role="inbox"], nav[aria-label="세션"]').first().count(), 1);
  // 확인창은 닫혀 있을 때 접근성 트리에서 빠지고(hidden), 열리면 이름을 가진 modal 이다.
  assert.equal(await app.$('[data-role="cancel-overlay"]').evaluate((el) => el.hidden), true);
  // 아직 없는 기능은 켜진 척하지 않는다.
  const settings = app.$('.settings-stub');
  assert.equal(await settings.getAttribute('aria-disabled'), 'true');
  assert.match((await settings.textContent()) ?? '', /아직 없음/);
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('접근성: 탭 "내 세션"/"종료됨" — role=tab 단추로 목록이 바뀌고 방향키로 옮긴다, 숨은 탭은 Tab 정지점이 아니다 (DC-27)', async (t) => {
  const api = agentApi(t);
  await api.open({ id: 'tab-live', topic: '진행 세션' });
  await api.open({ id: 'tab-dead', scenario: 'model-failure', topic: '죽은 세션' });
  await api.say('tab-dead', '죽어라');
  await api.waitState('tab-dead', 'failed');
  const app = await openApp(t, { route: '#/s/tab-live' });
  await app.pane.waitFor({ state: 'visible' });
  const titles = () => app.$('a.sess .sess-title').allTextContents();
  await until(async () => (await titles()).length === 1, { message: '목록이 서지 않았다' });
  assert.deepEqual(await titles(), ['진행 세션']);
  assert.equal(await app.$('#tab-mine').getAttribute('aria-selected'), 'true');
  assert.equal(await app.$('#tab-ended').getAttribute('tabindex'), '-1');

  await app.$('#tab-ended').click();
  await until(async () => (await titles()).join() === '죽은 세션', { message: '종료됨 탭이 종료된 세션을 보이지 않는다' });
  assert.equal(await app.$('#tab-ended').getAttribute('aria-selected'), 'true');
  assert.equal(await app.$('[role="tabpanel"]').getAttribute('aria-labelledby'), 'tab-ended');
  assert.match((await app.$('#tab-ended').textContent()) ?? '', /1/);

  // 방향키: 탭 사이를 옮기고 초점이 따라간다.
  await app.$('#tab-ended').focus();
  await app.page.keyboard.press('ArrowLeft');
  await until(async () => (await app.$('#tab-mine').getAttribute('aria-selected')) === 'true', { message: '←가 내 세션으로 옮기지 않았다' });
  assert.equal(await app.f.evaluate(() => document.activeElement?.id), 'tab-mine');
  await app.page.keyboard.press('ArrowRight');
  await until(async () => (await app.$('#tab-ended').getAttribute('aria-selected')) === 'true', { message: '→가 종료됨으로 옮기지 않았다' });
  assert.deepEqual(app.problems.all(), []);
}, UI);

check('초점: Tab 으로 닿는 모든 정지점이 :focus-visible 이고 안쪽 고리(2px #b9aeff)가 보인다 — 입력칸은 상자 전체의 고리', async (t) => {
  const { app } = await richSession(t, 'focus');
  await app.$('a[data-role="new-session"]').focus();
  const stops = [];
  for (let i = 0; i < 40; i += 1) {
    const stop = await app.f.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const box = el.closest('.box');
      const boxCs = box ? getComputedStyle(box) : null;
      const label = el.getAttribute('data-role') || el.id || `${el.tagName.toLowerCase()}.${(el.className ?? '').toString().split(' ')[0]}`;
      return {
        label,
        tag: el.tagName.toLowerCase(),
        focusVisible: el.matches(':focus-visible'),
        outline: { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, offset: parseFloat(cs.outlineOffset) },
        boxShadow: boxCs ? boxCs.boxShadow : null,
        visible: el.getBoundingClientRect().width > 0,
      };
    });
    if (!stop) break;
    if (stops.length > 0 && stop.label === stops[0].label) break; // 한 바퀴
    stops.push(stop);
    await app.page.keyboard.press('Tab');
  }
  assert.ok(stops.length >= 5, `정지점이 너무 적다: ${stops.map((s) => s.label)}`);
  const labels = stops.map((s) => s.label);
  for (const wanted of ['new-session', 'tab-mine', 'log', 'composer-input']) assert.ok(labels.includes(wanted), `${wanted} 가 Tab 정지점에 없다: ${labels}`);
  const bad = [];
  for (const s of stops) {
    if (!s.visible) bad.push(`${s.label}: 보이지 않는 정지점`);
    if (!s.focusVisible) bad.push(`${s.label}: :focus-visible 이 아니다`);
    if (s.label === 'composer-input') {
      // 입력칸은 자기 고리 대신 상자(.box)의 :focus-within 고리 — 안쪽 2px #b9aeff.
      if (!/rgb\(185, 174, 255\)/.test(s.boxShadow ?? '') || !/inset/.test(s.boxShadow ?? '')) bad.push(`composer-input: 상자 고리가 없다 (${s.boxShadow})`);
    } else if (s.outline.style === 'none' || s.outline.width < 2 || s.outline.offset >= 0) {
      bad.push(`${s.label}: 안쪽 2px 고리가 아니다 ${JSON.stringify(s.outline)}`);
    }
  }
  assert.deepEqual(bad, [], `정지점 ${stops.length}개 중 고리가 틀린 것\n${JSON.stringify(stops.map((s) => s.label))}`);
  assert.deepEqual(app.problems.all(), []);
}, UI);

// ── 글자 대비 4.5:1 ──
// 창 뒤 배경을 검정·회색·흰색으로 가정하고 겹친 배경색을 쌓아 WCAG 대비를 센다(원본 contrast-fallback.mjs 의 측정 그대로).
// 앱 본문(body)이 불투명 단색 위에 서므로 셋의 값은 같게 나와야 한다 — 그게 "뒤 배경에 흔들리지 않는다"의 증거다.
function measureContrast(backdrops) {
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bot) => {
    const a = top.a + bot.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a };
  };
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (f, b) => {
    const l1 = lum(f);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const name = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '');
  const root = document.documentElement;
  const items = [];
  const seen = new Set();
  let skipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('svg,script,style,option,[hidden],details:not([open]) > :not(summary)')) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
    const path = [];
    for (let p = el; p; p = p.parentElement) {
      path.unshift(p);
      if (p === root) break;
    }
    let opacity = 1;
    for (const p of path) opacity *= parseFloat(getComputedStyle(p).opacity);
    if (opacity < 0.99) {
      skipped += 1;
      continue;
    }
    const fg = parse(cs.color);
    if (!fg) continue;
    const layers = path.map((p) => parse(getComputedStyle(p).backgroundColor)).filter((c) => c && c.a > 0);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const entry = { text: text.slice(0, 22), el: name(el), px, large, ratios: {} };
    for (const [key, bd] of Object.entries(backdrops)) {
      let bg = { r: bd[0], g: bd[1], b: bd[2], a: 1 };
      for (const l of layers) bg = over(l, bg);
      entry.ratios[key] = +ratio(over(fg, bg), bg).toFixed(2);
    }
    items.push(entry);
  }
  const summary = {};
  for (const key of Object.keys(backdrops)) {
    const need = (e) => (e.large ? 3 : 4.5);
    summary[key] = {
      total: items.length,
      below: items.filter((e) => e.ratios[key] < need(e)).length,
      worst: [...items].sort((a, b) => a.ratios[key] - b.ratios[key]).slice(0, 4).map((e) => `${e.ratios[key]} ${e.el} "${e.text}" ${e.px}px`),
    };
  }
  return { summary, skipped };
}

const measureIn = async (app) => {
  await settle(app);
  return app.f.evaluate(measureContrast, BACKDROPS);
};

const BACKDROPS = { 검정: [0, 0, 0], 회색: [128, 128, 128], 흰색: [255, 255, 255] };
const MODES = ['기본', 'reduced-transparency', 'contrast-more', 'forced-colors'];

async function emulate(t, app, mode) {
  if (mode === 'reduced-transparency') {
    const cdp = await t.context.newCDPSession(app.page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  }
  if (mode === 'contrast-more') await app.page.emulateMedia({ contrast: 'more' });
  if (mode === 'forced-colors') await app.page.emulateMedia({ forcedColors: 'active' });
  const query = { 기본: null, 'reduced-transparency': '(prefers-reduced-transparency: reduce)', 'contrast-more': '(prefers-contrast: more)', 'forced-colors': '(forced-colors: active)' }[mode];
  if (query) await until(() => app.f.evaluate((q) => matchMedia(q).matches, query), { message: `${mode} 가 앱 프레임까지 닿지 않았다` });
}

for (const mode of MODES) {
  check(`대비·폴백(${mode}): 홈과 쌓인 대화에서 모든 글자가 4.5:1(큰 글자 3:1) 이상이다${mode === '기본' ? '' : ' — 창이 흐림 없는 불투명 단색으로 떨어진다'}`, async (t) => {
    const { app } = await richSession(t, 'contrast');
    await emulate(t, app, mode);
    const states = [];
    // ① 쌓인 대화(마지막 오류 칩·거절·오류 줄·완료 줄 …)
    states.push(['대화', await measureIn(app)]);
    // ② 확인창이 선 모습 — 별도 세션이 필요 없다(대기 세션이 아니어도 취소 단추가 있다: idle).
    await app.cancel.click();
    await app.dialog.waitFor({ state: 'visible' });
    states.push(['확인창', await measureIn(app)]);
    await app.page.keyboard.press('Escape');
    await app.dialog.waitFor({ state: 'hidden' });
    // ③ 홈(준비 상태 카드)
    await app.f.evaluate(() => {
      window.location.hash = '#/';
    });
    await app.$('[data-role="session-pane"]').waitFor({ state: 'hidden' });
    states.push(['홈', await measureIn(app)]);
    const fails = [];
    for (const [state, result] of states) {
      for (const [backdrop, sm] of Object.entries(result.summary)) {
        assert.ok(sm.total > 5, `${state}: 잴 글자가 너무 적다(${sm.total})`);
        if (sm.below > 0) fails.push(`${state}/뒤 배경 ${backdrop}: 글자 ${sm.total}개 중 ${sm.below}개 미달 — ${sm.worst.join(' | ')}`);
      }
    }
    assert.deepEqual(fails, []);

    if (mode !== '기본') {
      // 폴백: 앱 창이 흐림 없는 불투명 단색이고 배경 그림이 없다.
      const surface = await app.f.evaluate(() => {
        const a = getComputedStyle(document.querySelector('.app'));
        const b = getComputedStyle(document.body);
        return { bg: a.backgroundColor, backdrop: a.backdropFilter, bodyImage: b.backgroundImage };
      });
      assert.match(surface.bg, /^rgb\(/, `${mode}: 창 배경이 불투명 단색이 아니다 (${surface.bg})`);
      assert.equal(surface.backdrop, 'none', `${mode}: 창에 흐림이 남아 있다`);
      assert.equal(surface.bodyImage, 'none', `${mode}: 배경 그림이 남아 있다`);
    } else {
      // 기본 모드는 반투명 유리다 — 폴백이 정말 무언가를 바꾼다는 대조군.
      const bg = await app.f.evaluate(() => getComputedStyle(document.querySelector('.app')).backgroundColor);
      assert.match(bg, /^rgba\(/, `기본 모드의 창 배경이 반투명이 아니다 (${bg}) — 폴백 점검의 대조군이 사라졌다`);
    }
    assert.deepEqual(app.problems.all(), []);
  }, { ...UI, timeoutMs: 40_000 });
}
