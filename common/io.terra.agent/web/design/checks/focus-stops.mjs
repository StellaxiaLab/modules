// 키보드 초점 — Tab으로 모든 정지점을 훑어 :focus-visible과 고리(outline)를 적는다 (DC-28, 요구 §6.5).
// 사용: node focus-stops.mjs <pagesDir> [shotsDir]
import fs from 'fs'; import path from 'path';
import { launch, serve, pagesDirArg } from './lib.mjs';
const root = pagesDirArg();
const outDir = path.resolve(process.argv[3] || path.join(root, 'shots')); fs.mkdirSync(outDir, { recursive: true });
const { server, base } = await serve(root);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1447, height: 945 } });
const page = await ctx.newPage(); await page.clock.install();
await page.goto(base + 'AgentGUILive.html'); await page.waitForFunction(() => window.__mounted === true, null, { polling: 100 });
// walk the keyboard tab order and record every stop
const stops = [];
await page.keyboard.press('Tab');
for (let i = 0; i < 40; i++) {
  const info = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), cls: String(e.className).trim(), role: e.getAttribute('role'), label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24), fv: e.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth, rect: { x: r.x, y: r.y, w: r.width, h: r.height } }; });
  if (!info) break;
  if (stops.length && JSON.stringify(stops[0].rect) === JSON.stringify(info.rect) && stops[0].label === info.label) break; // wrapped
  stops.push(info);
  if (i < 12) { const pad = 10; await page.screenshot({ path: path.join(outDir, `tab${String(i).padStart(2, '0')}.png`), clip: { x: Math.max(0, info.rect.x - pad), y: Math.max(0, info.rect.y - pad), width: Math.min(1447, info.rect.w + 2 * pad), height: Math.min(300, info.rect.h + 2 * pad) }, animations: 'disabled' }); }
  await page.keyboard.press('Tab');
}
console.log('tab stops:', stops.length);
for (const s of stops) console.log(' ', s.tag + (s.role ? '[' + s.role + ']' : ''), JSON.stringify(s.label), 'focus-visible=' + s.fv, s.outline);
await browser.close(); server.close();

const bad = stops.filter((s) => !s.fv);
console.log(bad.length ? `실패: :focus-visible 아닌 정지점 ${bad.length}곳` : `통과: 정지점 ${stops.length}곳 모두 :focus-visible`);
process.exit(bad.length ? 1 : 0);
