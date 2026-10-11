// 대화 스크롤 따라가기 — 맨 아래면 새 줄을 따라가고, 올려 읽는 중이면 읽던 줄이 밀리는지 잰다 (DC-23). 측정만 하고 통과/실패를 가르지 않는다.
// 사용: node scroll-follow.mjs <pagesDir>
import fs from 'fs'; import path from 'path';
import { launch, serve, pagesDirArg } from './lib.mjs';
const root = pagesDirArg();
const outDir = path.resolve(process.argv[3] || path.join(root, 'shots')); fs.mkdirSync(outDir, { recursive: true });
const { server, base } = await serve(root);
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1447, height: 945 } });
const page = await ctx.newPage(); await page.clock.install();
await page.goto(base + 'AgentGUILive.html'); await page.waitForFunction(() => window.__mounted === true, null, { polling: 100 });
const adv = async (ms) => { await page.clock.runFor(ms); await page.waitForTimeout(40); };
const send = async (t) => { await page.locator('.inp textarea').fill(t); await page.locator('.inp button.btn.pri.sm').click(); };
for (let i = 0; i < 3; i++) { await send('모듈 상태를 읽기만 해서 알려줘 ' + i); await adv(5200); }
const snap = () => page.evaluate(() => { const el = document.querySelector('.msgs'); const rows = [...document.querySelectorAll('.msgs .in > .rise')]; const box = el.getBoundingClientRect(); const a = rows[3]; return { scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, rows: rows.length, anchorText: a.textContent.trim().slice(0, 20), anchorTop: Math.round(a.getBoundingClientRect().top - box.top), lastBottomGap: Math.round(box.bottom - rows[rows.length - 1].getBoundingClientRect().bottom) }; });
const before0 = await snap();
// (1) at the bottom: a new turn must stay visible
await send('한 번 더 읽어줘'); await adv(5200);
const afterAtBottom = await snap();
// (2) scrolled up: new lines must not pull the reader back down / must not shove what they read away
await page.evaluate(() => { const el = document.querySelector('.msgs'); el.scrollTo(0, -(el.scrollHeight - el.clientHeight) / 2); });
await page.waitForTimeout(80);
const readerBefore = await snap();
await send('또 한 번 읽어줘'); await adv(5200);
const readerAfter = await snap();
console.log(JSON.stringify({ before0, afterAtBottom, readerBefore, readerAfter }, null, 1));
const moved = Math.abs(readerAfter.anchorTop - readerBefore.anchorTop);
console.log('at bottom: last entry gap to the bottom edge =', afterAtBottom.lastBottomGap, 'px (<=~20 means it follows)');
console.log('scrolled up: scrollTop', readerBefore.scrollTop, '->', readerAfter.scrollTop, '| the line being read moved', moved, 'px; rows', readerBefore.rows, '->', readerAfter.rows);
await browser.close(); server.close();
