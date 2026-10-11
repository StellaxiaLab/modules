// 글자 대비와 선호 설정 폴백 (DC-29, 요구 §6.5)
//  - 글자 대비: 창 뒤 배경을 검정·회색·흰색으로 가정하고 겹친 배경색을 쌓아 WCAG 대비를 센다. 4.5:1(큰 글자 3:1) 미만이면 실패.
//  - 폴백: prefers-reduced-transparency · prefers-contrast:more · forced-colors에서 창(.win)이 흐림 없는 단색이어야 한다.
// 사용: node contrast-fallback.mjs <pagesDir> [shotsDir]    (결과 JSON은 <pagesDir>/contrast-fallback.json)
import fs from 'fs'; import path from 'path';
import { launch, serve, pagesDirArg } from './lib.mjs';
const root = pagesDirArg();
const shotsDir = path.resolve(process.argv[3] || path.join(root, 'shots')); fs.mkdirSync(shotsDir, { recursive: true });
const { server, base } = await serve(root);
const browser = await launch();
const MODES = ['none', 'reduced-transparency', 'contrast-more', 'forced-colors'];
const RESTART = '재시작해줘. chat 모듈이 죽었어.';
const adv = async (page, ms) => { await page.clock.runFor(ms); await page.waitForTimeout(40); };
const sendText = async (page, text) => { await page.locator('.inp input, .inp textarea').first().fill(text); await page.locator('.inp button.btn.pri.sm').click(); };

async function open(mode) {
  const ctx = await browser.newContext({ viewport: { width: 1447, height: 945 } });
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto(base + 'AgentGUILive.html');
  await page.waitForFunction(() => window.__mounted === true, null, { polling: 100 });
  if (mode === 'reduced-transparency') { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] }); }
  if (mode === 'forced-colors') await page.emulateMedia({ forcedColors: 'active' });
  if (mode === 'contrast-more') await page.emulateMedia({ contrast: 'more' });
  await page.waitForTimeout(250);
  return { ctx, page };
}

const measure = (backdrops) => {
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }; return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (f, b) => { const L1 = lum(f), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  const cn = (e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const root = document.querySelector('.win');
  const all = [root, ...root.querySelectorAll('*')];
  const blur = [], transl = [];
  for (const e of all) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const bf = cs.backdropFilter, wbf = cs.webkitBackdropFilter;
    if ((bf && bf !== 'none') || (wbf && wbf !== 'none')) blur.push({ el: cn(e), bf, bg: cs.backgroundColor, area: Math.round(r.width * r.height) });
    const c = parse(cs.backgroundColor); const area = r.width * r.height;
    if (c && c.a > 0 && c.a < 1 && area > 3000) transl.push({ el: cn(e), bg: cs.backgroundColor, area: Math.round(area) });
  }
  // text contrast on the layered backgrounds, for black / white page behind the window
  const items = []; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const seen = new Set();
  let skipped = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (!t) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('svg,script,style,option')) continue;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
    const path = []; for (let p = el; p; p = p.parentElement) { path.unshift(p); if (p === root) break; }
    let op = 1; for (const p of path) op *= parseFloat(getComputedStyle(p).opacity);
    if (op < 0.99) { skipped++; continue; }
    const fg = parse(cs.color); if (!fg) continue;
    const layers = path.map((p) => parse(getComputedStyle(p).backgroundColor)).filter((c) => c && c.a > 0);
    const px = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700; const large = px >= 24 || (px >= 18.66 && bold);
    const entry = { text: t.slice(0, 22), el: cn(el), px, large, ratios: {} };
    for (const [name, bd] of Object.entries(backdrops)) {
      let bg = { r: bd[0], g: bd[1], b: bd[2], a: 1 };
      for (const l of layers) bg = over(l, bg);
      entry.ratios[name] = +ratio(over(fg, bg), bg).toFixed(2);
    }
    items.push(entry);
  }
  const summary = {};
  for (const name of Object.keys(backdrops)) {
    const need = (e) => (e.large ? 3 : 4.5);
    summary[name] = { total: items.length, below: items.filter((e) => e.ratios[name] < need(e)).length, min: Math.min(...items.map((e) => e.ratios[name])), worst: [...items].sort((a, b) => a.ratios[name] - b.ratios[name]).slice(0, 3).map((e) => `${e.ratios[name]} ${e.el} "${e.text}" ${e.px}px`) };
  }
  const win = getComputedStyle(root);
  return { winBg: win.backgroundColor, winBackdrop: win.backdropFilter, blurCount: blur.length, blur: blur.slice(0, 8), translCount: transl.length, translTop: transl.sort((a, b) => b.area - a.area).slice(0, 6), summary, skipped };
};

const states = [
  { state: 'initial', setup: async () => {} },
  { state: 'approval', setup: async (page) => { await sendText(page, RESTART); await adv(page, 5300); } },
];
const BACKDROPS = { black: [0, 0, 0], gray: [128, 128, 128], white: [255, 255, 255] };
const out = { chromium: browser.version(), modes: {} };
const fails = [];
let checks = 0;
for (const mode of MODES) {
  out.modes[mode] = {};
  for (const st of states) {
    const { ctx, page } = await open(mode);
    await st.setup(page);
    const r = await page.evaluate(measure, BACKDROPS);
    out.modes[mode][st.state] = r;
    await page.screenshot({ path: path.join(shotsDir, `${mode}-${st.state}.png`), animations: 'disabled' });
    await ctx.close();
    for (const [bd, sm] of Object.entries(r.summary)) {
      checks++;
      const line = `${mode}/${st.state}/뒤 배경 ${bd}: 글자 ${sm.total}개, 최저 ${sm.min}, 미달 ${sm.below}`;
      if (sm.below > 0) { fails.push('대비 ' + line); console.log('FAIL', line); } else console.log('PASS', line);
    }
    if (mode !== 'none') {
      checks++;
      // 창(.win)이 단색이어야 한다 — 안쪽 카드의 흐림은 불투명(.99) 면 위라 뒤를 비추지 않으므로 세지 않는다.
      const opaque = /^rgb\(/.test(r.winBg) || /,\s*1\)$/.test(r.winBg);
      const line = `${mode}/${st.state}: 창 배경 ${r.winBg}, 창 흐림 ${r.winBackdrop}`;
      if (r.winBackdrop !== 'none' || !opaque) { fails.push('폴백 ' + line); console.log('FAIL', line); } else console.log('PASS', line);
    }
  }
}
fs.writeFileSync(path.join(root, 'contrast-fallback.json'), JSON.stringify(out, null, 1));
await browser.close(); server.close();
console.log(`\n${checks - fails.length}/${checks} passed`);
process.exit(fails.length ? 1 : 0);
