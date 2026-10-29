// 연기 시험 — 구운 ../ui 를 Chromium 으로 열어 씬 보드가 서는지(보드 · 렌더러 세 길 · 오류 없음), 로그인 · 창(제어기 · 모듈 상태 · 브라우저)이 도는지 본다.
//   node tests/smoke.mjs   (npm run build 뒤에. 브라우저가 필요해 npm test 에 넣지 않는다)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('../../ui/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'";   // Gateway 앱 CSP(appAssetCSP) 와 같게
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '') || 'index.html';
  try { const body = await readFile(join(root, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'content-security-policy': CSP }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let fail = 0;
const ok = (c, msg) => { if (!c) fail++; console.log((c ? 'ok  ' : 'FAIL') + ' ' + msg); };
// 렌더러 세 길 — 기본(Worker · WebGL2) · 메인 스레드 · GPU 없이
for (const qs of ['', '?render=main', '?gl=2d&render=main']) {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html${qs}`);
  await page.waitForFunction(() => window.__terra && window.__terra.scene.__gpu && window.__terra.scene.__gpu.host, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => { const H = window.__terra.scene.__gpu.host; return { kind: H.kind, mode: H.mode, boards: document.querySelectorAll('.sc-host').length }; });
  ok(r.kind !== 'none' && r.boards >= 11, `${qs || '(기본)'} → ${r.kind} · ${r.mode} · 보드 ${r.boards}개`);
}
// 로그인 → 트리 뷰 → 창 (제어기 · 모듈 상태 · 브라우저)
await page.mouse.click(640, 420); await page.waitForTimeout(3500);
await page.locator('input[name=admin]').fill('admin'); await page.locator('input[name=password]').fill('pw'); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__terra.scene.state.loginOn === false, null, { timeout: 40000 });
ok(true, '로그인 → 트리 뷰');
await page.evaluate(() => { const s = window.__terra.scene; s.gf_ctlOpenWin(s.gf_localNode()); });
await page.waitForTimeout(2500);
ok(await page.evaluate(() => getComputedStyle(document.querySelector('[data-ctlwin][data-slot="0"]')).display !== 'none'), '제어기 창');
await page.evaluate(() => { const s = window.__terra.scene, L = s.gf_localNode(), m = s.gf_modsOf(L).find((q) => q.apps.length && q.st === 'run'); s.gf_ctlOpenWin(L, undefined, 'mod', m.id); });
await page.waitForTimeout(2000);
await page.locator('[data-ctlwin][data-slot="16"] .ms-gui').first().click();
await page.waitForTimeout(3000);
ok(await page.evaluate(() => !!document.querySelector('[data-ctlwin][data-slot="19"] iframe')), '모듈 상태 › GUI ↗ → 브라우저 창');
if (errors.length) { fail++; console.log('오류:', errors.join(' | ')); }
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
