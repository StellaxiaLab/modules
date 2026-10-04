import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// 여러 페이지 앱: 화면마다 html 하나. 페이지 목록은 tools/pages.json (tools/gen-pages.py가 만든다)
// screens.html(화면 목록)은 개발용이라 빌드에 넣지 않는다 — npm run dev 에서는 그대로 열린다
const pages = JSON.parse(readFileSync(resolve(import.meta.dirname, 'tools/pages.json'), 'utf8'));
const input = {};
for (const p of pages) input[p.page.replace(/\.html$/, '')] = resolve(import.meta.dirname, p.page);

// 빌드 결과는 ../ui 로 간다 — 모듈 패키지가 싣는 자리이고 module.json 의 앱 entry(ui/index.html = 시작 화면)가 가리킨다.
// 최상위 web/ 은 terra module pack 의 허용 목록 밖이라 이 소스는 출하되지 않는다.
// base './' — 게이트웨이는 앱 자산을 /api/v1/gui/apps/<앱 id>/files/ 아래에서 내준다. 절대 경로(/assets/…)는 깨진다.
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { outDir: '../ui', emptyOutDir: true, rollupOptions: { input } }
});
