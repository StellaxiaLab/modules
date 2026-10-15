// 입력칸 자동 높이 — 비었을 때와 5줄일 때의 높이를 잰다 (DC-22). 측정만 한다.
// 사용: node textarea-grow.mjs <pagesDir> [shotsDir]
import fs from 'fs'; import path from 'path';
import { launch, serve, pagesDirArg } from './lib.mjs';
const root = pagesDirArg();
const outDir = path.resolve(process.argv[3] || path.join(root, 'shots')); fs.mkdirSync(outDir, { recursive: true });
const { server, base } = await serve(root);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1447, height: 945 } });
const page = await ctx.newPage(); await page.clock.install();
await page.goto(base + 'AgentGUILive.html'); await page.waitForFunction(() => window.__mounted === true, null, { polling: 100 });
const ta = page.locator('.inp textarea');
const m = () => ta.evaluate((e) => { const b = e.closest('.box').getBoundingClientRect(); return { h: Math.round(e.getBoundingClientRect().height), clientH: e.clientHeight, scrollH: e.scrollHeight, rows: e.getAttribute('rows'), boxH: Math.round(b.height), value: e.value.split('\n').length + ' lines' }; });
console.log('empty    ', JSON.stringify(await m()));
await ta.click();
for (let i = 1; i <= 5; i++) { await page.keyboard.type('줄 ' + i); if (i < 5) await page.keyboard.press('Shift+Enter'); }
console.log('5 lines  ', JSON.stringify(await m()));
await page.screenshot({ path: path.join(outDir, 'textarea-5lines.png'), clip: { x: 0, y: 700, width: 1447, height: 245 }, animations: 'disabled' });
await browser.close(); server.close();
