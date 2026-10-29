// 연기 시험 — 구운 ../ui 를 Chromium 으로 열어 글자 장이 서는지(렌더러 · 실행 자리 · 오류 없음)와 창 층이 도는지 본다.
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
for (const qs of ['', '?render=main', '?gl=2d&render=main']) {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html${qs}`);
  await page.waitForFunction(() => window.__terra && window.__terra.host.kind !== 'none', null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const T = window.__terra, el = document.createElement('div');
    const w = T.windows.open('res', 'gpio', { title: 'gpio', mount: (b) => { b.textContent = 'ok'; } });
    T.windows.open('res', 'gpio', { title: 'gpio', mount: () => {} });   // 같은 대상 — 다시 쓴다
    const n = T.windows.wins.length; T.windows.close(w);
    return { kind: T.host.kind, mode: T.host.mode, status: document.getElementById('status').textContent, wins: n, after: T.windows.wins.length };
  });
  const ok = r.kind !== 'none' && r.wins === 1 && r.after === 0;
  if (!ok) fail++;
  console.log((ok ? 'ok  ' : 'FAIL') + ` ${qs || '(기본)'} → ${r.kind} · ${r.mode} · 창 ${r.wins}→${r.after} · "${r.status}"`);
}
if (errors.length) { fail++; console.log('오류:', errors.join(' | ')); }
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
