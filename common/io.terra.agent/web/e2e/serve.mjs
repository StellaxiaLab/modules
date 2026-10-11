// 앱 정적 서빙 — `ui/` 빌드 산출물(또는 점검용 앱)을 Gateway 의 앱 자산 경로처럼 내준다.
//
// 앱 자산의 CSP 를 **같은 헤더**로 건다(plan §5.1, gui_apps.go:458-460). 인라인 스크립트·바깥 스크립트·바깥 연결이
// 막히므로 앱이 CSP 를 어기면 e2e 의 콘솔 오류로 드러난다. 바꾸려면 Gateway 쪽이 바뀐 것이어야 한다.
//
// 직접 띄우기:  node e2e/serve.mjs --root ../ui --port 4020 --shell-origin http://127.0.0.1:4021
//   → http://127.0.0.1:4020/api/v1/gui/apps/io.terra.agent/files/ui/index.html

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_ID = 'io.terra.agent';
/** 앱 자산이 서는 자리 — 매니페스트 entry(`ui/index.html`)가 이 아래에 놓인다. */
export const APP_MOUNT = `/api/v1/gui/apps/${APP_ID}/files/ui/`;

/** frame-ancestors 만 셸 origin 으로 채워진다. 나머지는 고정이다. */
export function appCsp(shellOrigin) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${shellOrigin}`,
  ].join('; ');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * @returns {(req, res) => boolean}  요청을 처리했으면 true. 마운트 밖이면 false.
 */
export function createStaticHandler({ root, mount = APP_MOUNT, csp, extraHeaders = {} }) {
  const base = path.resolve(root);
  return (req, res) => {
    const url = new URL(req.url, 'http://static.invalid');
    if (!url.pathname.startsWith(mount)) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end('Method Not Allowed\n');
      return true;
    }
    let relative;
    try {
      relative = decodeURIComponent(url.pathname.slice(mount.length));
    } catch {
      res.writeHead(400);
      res.end('bad path\n');
      return true;
    }
    let file = path.resolve(base, relative);
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403);
      res.end('forbidden\n');
      return true;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 page not found\n');
      return true;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'content-security-policy': csp,
      'cache-control': 'no-store',
      ...extraHeaders,
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
  };
}

export function createStaticServer(options) {
  const handle = createStaticHandler(options);
  return http.createServer((req, res) => {
    if (!handle(req, res)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404 page not found\n');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const get = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const root = path.resolve(get('--root', new URL('../../ui', import.meta.url).pathname));
  const port = Number(get('--port', 4020));
  const shellOrigin = get('--shell-origin', 'http://127.0.0.1:4021');
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    console.error(`${root}/index.html 이 없다 — 먼저 \`npm run build\` (또는 --root 로 다른 폴더를 가리킨다)`);
    process.exit(2);
  }
  createStaticServer({ root, csp: appCsp(shellOrigin) }).listen(port, '127.0.0.1', () => {
    console.log(`앱 정적 서빙: http://127.0.0.1:${port}${APP_MOUNT}index.html  (CSP frame-ancestors ${shellOrigin})`);
  });
}
