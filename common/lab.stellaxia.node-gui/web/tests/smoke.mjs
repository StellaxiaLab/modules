#!/usr/bin/env node
// 연기 시험(smoke) — 모든 페이지가 오류 없이 뜨고, 노드 화면의 주요 흐름이 도는지 본다.
// 사용: npm install && npx playwright install chromium && npm run test:smoke
// 자체 정적 서버(포트 4173)를 띄우므로 dev 서버가 없어도 된다. 스크린숏은 tests/shots/
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/pages.json') p = '/public/pages.json';
  try { const buf = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(buf); }
  catch { res.writeHead(404); res.end(); }
}).listen(4173);
const BASE = 'http://127.0.0.1:4173/';
await mkdir(join(ROOT, 'tests/shots'), { recursive: true });

// 브라우저 경로를 따로 줄 때: PW_CHROMIUM=/경로/chrome npm run test:smoke
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1447, height: 945 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : '')); if (!ok) fails++; };

const pages = JSON.parse(await readFile(join(ROOT, 'public/pages.json'), 'utf8'));
for (const p of pages.filter((x) => x.page !== 'node.html')) {
  const before = errors.length;
  await page.goto(BASE + p.page); await page.waitForTimeout(1200);
  const len = await page.evaluate(() => document.querySelector('#stage').innerText.length);
  check(p.title, len > 50 && errors.length === before, '글자 ' + len);
}

await page.goto(BASE + 'node.html'); await page.waitForTimeout(2500);
await page.screenshot({ path: join(ROOT, 'tests/shots/node.png') });
// 조타륜 올리기 → 가운데 로고 → 앱 바
await page.locator('[data-hx-name]').click(); await page.waitForTimeout(1300);
const cv = await page.locator('[data-hx-cv]').boundingBox(); const k = cv.width / 600;
await page.mouse.click(cv.x + 300 * k, cv.y + 65 * k); await page.waitForTimeout(800);
check('조타륜 앱 바', await page.evaluate(() => !!document.querySelector('[data-hb-key]')));
// 앱 전체 화면 → 리스트에 들어감 → 파인 곳 눌러 맵으로
await page.evaluate(() => document.querySelector('[data-hb-fs]').click()); await page.waitForTimeout(600);
check('조타륜 앱 전체 화면', await page.evaluate(() => !!document.querySelector('section.fs-hb')));
await page.mouse.click(723, 70); await page.waitForTimeout(500);
check('파인 곳 → 맵', await page.evaluate(() => !document.querySelector('[data-fs-notch]')));
await page.locator('[data-fs-box]').click(); await page.waitForTimeout(400);
check('전체 화면 리스트에 보관', await page.evaluate(() => document.querySelectorAll('[data-fsl]').length === 1));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
// 폴더 보관함 → 메모장 → 새 메모 저장
await page.locator('[data-fb-pod]').click(); await page.waitForTimeout(600);
await page.locator('[data-fb-go="memo"]').click(); await page.waitForTimeout(300);
await page.locator('[data-fb-new]').click(); await page.waitForTimeout(400);
await page.locator('[data-memo-name]').fill('연기 시험'); await page.locator('[data-memo-text]').fill('한 줄');
await page.locator('[data-memo-save]').click(); await page.waitForTimeout(300);
check('메모 저장', await page.evaluate(() => !!document.querySelector('[data-fb-row="연기 시험.md"]')));
await page.screenshot({ path: join(ROOT, 'tests/shots/folder-memo.png') });
check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' / '));

await browser.close(); server.close();
console.log(fails ? `실패 ${fails}` : '모두 통과');
process.exit(fails ? 1 : 0);
