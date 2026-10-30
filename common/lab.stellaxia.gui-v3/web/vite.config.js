import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { boardModule, importsOf } from './tools/dc-board.mjs';

// 빌드 결과는 ../ui — 모듈 패키지가 싣는 자리이고 module.json 의 앱 entry(ui/index.html)가 가리킨다.
// web/ 은 terra module pack 의 허용 목록 밖이라 이 소스는 출하되지 않는다.
// base './' — Gateway 는 앱 자산을 /api/v1/gui/apps/<앱 id>/files/ 아래에서 내준다. 절대 경로(/assets/…)는 깨진다.
// Worker 는 파일로 낸다(format 'es') — 앱 CSP script-src 'self' 가 이미 허락한다. blob: Worker 로 인라인하지 않는다(capabilities 'workers' 가 필요해진다).
// bench/ 는 개발용이라 빌드에 넣지 않는다. design/ 의 보드는 아래 boards() 가 모듈로 바꿔 싣는다.

const DESIGN = resolve(import.meta.dirname, 'design');
const RUNTIME = '/src/ui/dc/runtime.js';

// 캔버스 보드 → 모듈. 'board:이름' 하나 · 'virtual:boards' = 씬(Scene)에서 dc-import 로 닿는 보드 전부
function boards() {
  const file = (name) => resolve(DESIGN, name + '.dc.html');
  const closure = (root) => { const seen = new Set(), q = [root]; while (q.length) { const n = q.shift(); if (seen.has(n)) continue; seen.add(n); for (const m of importsOf(readFileSync(file(n), 'utf8'))) q.push(m); } return [...seen]; };
  return {
    name: 'terra-boards',
    resolveId(id) { if (id === 'virtual:boards' || id.startsWith('board:')) return '\0' + id; return null; },
    load(id) {
      if (id === '\0virtual:boards') { const L = closure('Scene'); for (const n of L) this.addWatchFile(file(n)); return L.map((n) => 'import ' + JSON.stringify('board:' + n) + ';').join('\n') + '\nexport const boards = ' + JSON.stringify(L) + ';\n'; }
      if (id.startsWith('\0board:')) { const name = id.slice(7), f = file(name); this.addWatchFile(f); return boardModule(readFileSync(f, 'utf8'), name, RUNTIME); }
      return null;
    }
  };
}

export default defineConfig({
  base: './',
  server: { port: 5174 },
  plugins: [boards()],
  worker: { format: 'es' },
  build: { outDir: '../ui', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2000, rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html') } } }
});
