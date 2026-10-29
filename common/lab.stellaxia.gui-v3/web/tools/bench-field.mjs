// 글자 장 렌더러 비교를 브라우저에서 돌린다 — node tools/bench-field.mjs [--dpr 1,2] [--frames 240] [--gpu]
//   web/ 을 작은 정적 서버로 내고, Chromium 으로 bench/field.html 을 열어 window.__bench 를 읽는다.
//   --gpu 를 주지 않으면 헤드리스 Chromium 의 소프트웨어 GL(SwiftShader)로 돈다 — GPU 쪽 숫자는 실제 GPU 보다 크게 나온다(보수적).
//   playwright 는 optionalDependencies 다(CI 러너에는 브라우저가 없어 npm test 에 넣지 않는다).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DPRS = arg('dpr', '1,2').split(',').map(Number), FRAMES = +arg('frames', '240'), GPU = process.argv.includes('--gpu');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try { const body = await readFile(join(root, p)); res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch({ args: GPU ? ['--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const all = [];
for (const dpr of DPRS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => console.error('page error', e.message));
  page.on('console', (m) => { if (process.argv.includes('--verbose')) console.error('console', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/bench/field.html?frames=${FRAMES}&dpr=${dpr}&modes=${arg('modes', '2d,gl,worker')}&kinds=${arg('kinds', 'idle,mask,labels')}`);
  const tick = setInterval(async () => { try { console.error((await page.evaluate(() => document.getElementById('out').textContent)).split('\n').slice(-2)[0]); } catch {} }, 15000);
  await page.waitForFunction(() => window.__bench, null, { timeout: 600000, polling: 500 });
  clearInterval(tick);
  const b = await page.evaluate(() => window.__bench);
  all.push(b);
  console.log(`\n## dpr ${dpr} · ${b.cols}×${b.rows} = ${b.cols * b.rows} 칸 · GL: ${b.gl}`);
  console.log('| 장면 | 렌더러 | 실행 | 기록 ms | 그리기 ms (중앙 · p95) | 메인 합계 ms | 프레임 간격 ms (중앙 · p95) | Worker ms |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of b.results) console.log(r.error ? `| ${r.scene} | ${r.mode} | 실패 | ${r.error} |` : `| ${r.scene} | ${r.kind} | ${r.where} | ${r.recordMs} | ${r.drawMs} · ${r.drawP95} | ${r.mainMs} | ${r.frameMs} · ${r.frameP95} | ${r.workerMs ?? '—'} |`);
  await page.close();
}
await browser.close(); server.close();
if (arg('json')) { const { writeFile } = await import('node:fs/promises'); await writeFile(arg('json'), JSON.stringify(all, null, 2)); }
