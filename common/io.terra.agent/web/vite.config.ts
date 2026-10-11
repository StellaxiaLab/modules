import { defineConfig } from 'vitest/config';

// 빌드 결과는 ../ui — 모듈 패키지가 싣는 자리이고 module.json 의 앱 entry(ui/index.html)가 가리킨다.
// web/ 은 terra module pack 의 허용 목록 밖이라 소스는 출하되지 않는다.
// base './' — 게이트웨이는 앱 자산을 /api/v1/gui/apps/<앱 id>/files/ 아래에서 내준다. 절대 경로는 깨진다.
// 앱 CSP 가 script-src 'self' 라 인라인 스크립트는 쓰지 않는다. 라우팅은 hash 만 쓴다(서버 경로에 기대지 않는다).
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { outDir: '../ui', emptyOutDir: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
