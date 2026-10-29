import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 빌드 결과는 ../ui — 모듈 패키지가 싣는 자리이고 module.json 의 앱 entry(ui/index.html)가 가리킨다.
// web/ 은 terra module pack 의 허용 목록 밖이라 이 소스는 출하되지 않는다.
// base './' — Gateway 는 앱 자산을 /api/v1/gui/apps/<앱 id>/files/ 아래에서 내준다. 절대 경로(/assets/…)는 깨진다.
// Worker 는 파일로 낸다(format 'es') — 앱 CSP script-src 'self' 가 이미 허락한다. blob: Worker 로 인라인하지 않는다(capabilities 'workers' 가 필요해진다).
// bench/ · design/ 은 개발용이라 빌드에 넣지 않는다.
export default defineConfig({
  base: './',
  server: { port: 5174 },
  worker: { format: 'es' },
  build: { outDir: '../ui', emptyOutDir: true, target: 'es2022', rollupOptions: { input: { index: resolve(import.meta.dirname, 'index.html') } } }
});
