// 점검 스크립트 공용 — Playwright 불러오기, 정적 서버, Chromium 실행.
// 디자인 파일은 읽기만 한다(고치지 않는다).
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// playwright는 저장소에 의존으로 두지 않는다(package.json 없음). 전역/임시 설치를 쓴다:
//   NODE_PATH=$(npm root -g) node ...   또는   PLAYWRIGHT_MODULE=/경로/node_modules/playwright
export function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* 다음 후보 */ } }
  console.error('playwright를 찾지 못했다. NODE_PATH=$(npm root -g) 로 전역 설치를 가리키거나 PLAYWRIGHT_MODULE을 지정한다. (playwright install 은 쓰지 않는다)');
  process.exit(2);
}

// Chromium은 미리 깔린 것을 쓴다. 기본 /opt/pw-browsers/chromium, CHROMIUM_PATH로 바꾼다.
export async function launch() {
  const { chromium } = loadPlaywright();
  const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  return chromium.launch({ headless: true, executablePath });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
export function serve(root) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}/`, root })));
}

// 첫 인자 = build-pages.mjs가 만든 페이지 디렉터리
export function pagesDirArg() {
  const d = process.argv[2];
  if (!d || !fs.existsSync(path.join(d, 'AgentGUILive.html'))) {
    console.error('사용: node <스크립트> <pagesDir>   (pagesDir는 build-pages.mjs의 출력 디렉터리)');
    process.exit(2);
  }
  return path.resolve(d);
}
