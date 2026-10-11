// e2e 스택 — 셸 서버(호스트 페이지) + Gateway 서버(가짜 모듈 + 앱 정적 서빙)를 세운다. 둘은 **다른 origin** 이다.
//
//   셸     http://127.0.0.1:<a>/shell-host.html?…        브리지를 구현하고 앱을 iframe 에 올린다
//   Gateway http://127.0.0.1:<b>/api/v1/gui/apps/io.terra.agent/files/ui/…   앱 자산(CSP 헤더)
//                              /api/modules/io.terra.agent/v1/…              가짜 모듈 API (Bearer fake.<이름> 이 호출자)
//                              /__control/…                                  제어
//
// 앱 origin = Gateway origin 이라 앱의 connect-src 'self' 는 Gateway 를 가리키지만, 앱은 토큰이 없어 직접 부르지 못한다
// (strict gateway: 토큰 없는 호출은 401 UNAUTHORIZED). 앱의 API 호출은 브리지를 거쳐야 한다.
//
// 직접 띄우기(눈으로 보기):  node e2e/stack.mjs [--app probe|ui|<폴더>] [--port 4030]

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFakeAgent } from './fake-agent-server.mjs';
import { createControl } from './lib/control.mjs';
import { APP_ID, APP_MOUNT, appCsp, createStaticHandler } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROBE_APP_DIR = path.join(HERE, 'fixtures', 'probe-app');
export const BUILT_UI_DIR = path.resolve(HERE, '..', '..', 'ui');
const SHELL_FILES = {
  '/shell-host.html': 'text/html; charset=utf-8',
  '/shell-host.mjs': 'text/javascript; charset=utf-8',
  '/shell-bridge.mjs': 'text/javascript; charset=utf-8',
};

export function resolveAppDir(app) {
  if (app === undefined || app === 'probe') return PROBE_APP_DIR;
  if (app === 'ui') return BUILT_UI_DIR;
  return path.resolve(app);
}

const listen = (server, port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
const closeServer = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(() => resolve());
});

export async function startStack({ appDir = PROBE_APP_DIR, gatewayPort = 0, shellPort = 0 } = {}) {
  let gatewayOrigin = '';
  const shell = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname === '/shell-config.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ gatewayOrigin, appId: APP_ID, defaultAppPath: `${APP_MOUNT}index.html` }));
      return;
    }
    const type = SHELL_FILES[pathname === '/' ? '/shell-host.html' : pathname];
    if (!type) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404 page not found\n');
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    fs.createReadStream(path.join(HERE, pathname === '/' ? '/shell-host.html' : pathname)).pipe(res);
  });
  const shellActual = await listen(shell, shellPort);
  const shellOrigin = `http://127.0.0.1:${shellActual}`;

  const agent = await createFakeAgent({ strictGateway: true, corsOrigin: shellOrigin });
  const serveApp = createStaticHandler({ root: appDir, csp: appCsp(shellOrigin) });
  const gateway = http.createServer((req, res) => {
    res.setHeader('connection', 'close'); // fake-agent-server.mjs handler 의 주석 참고(응답 유실 주입이 재전송되지 않게)
    if (serveApp(req, res)) return;
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    void agent.handler(req, res);
  });
  agent.server.close(); // 쓰지 않는 자체 서버 — handler 만 쓴다
  const gatewayActual = await listen(gateway, gatewayPort);
  gatewayOrigin = `http://127.0.0.1:${gatewayActual}`;
  const control = createControl(gatewayOrigin);

  return {
    agent,
    control,
    gatewayOrigin,
    shellOrigin,
    appDir,
    appUrl: (file = 'index.html') => `${gatewayOrigin}${APP_MOUNT}${file}`,
    /** 셸 호스트 페이지 주소. 질의는 shell-host.mjs 머리말 참고. */
    shellUrl(params = {}) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        query.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
      return `${shellOrigin}/shell-host.html${query.size ? `?${query}` : ''}`;
    },
    async close() {
      await agent.close().catch(() => {});
      await Promise.all([closeServer(gateway), closeServer(shell)]);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const get = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const appDir = resolveAppDir(get('--app'));
  if (!fs.existsSync(path.join(appDir, 'index.html'))) {
    console.error(`${appDir}/index.html 이 없다 — ui 는 먼저 \`npm run build\` 로 만든다`);
    process.exit(2);
  }
  const stack = await startStack({ appDir, gatewayPort: Number(get('--port', 0)) });
  console.log(`셸 호스트  ${stack.shellUrl()}`);
  console.log(`Gateway    ${stack.gatewayOrigin}   (제어 ${stack.gatewayOrigin}/__control/state)`);
  console.log('Ctrl-C 로 끝낸다.');
}
