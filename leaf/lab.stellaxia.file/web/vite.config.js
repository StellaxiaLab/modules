import { defineConfig } from 'vite';

// 빌드 결과는 ../ui로 간다. `terra module pack`이 싣는 자리다. 최상위 web/은 패키지에서
// 빠지므로 이 소스는 출하되지 않는다(웹 프로그램 감싸기 설계 §3.4).
//
// base './': 게이트웨이는 이 앱을 /api/v1/gui/apps/lab.stellaxia.file.web/files/ 아래에서 내준다.
// 그래서 절대 경로(/assets/…)는 아무것도 가리키지 않는다. 같은 이유로 라우팅은 path가
// 아니라 hash(#/about)로 한다.
//
// 앱은 엄격한 CSP 아래에서 돈다. 인라인·외부 스크립트, 외부 폰트·이미지·연결을 쓸 수 없다.
// 전부 번들한다. 인라인 스타일은 된다.
export default defineConfig({
  base: './',
  build: {
    outDir: '../ui',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // `npm run dev`는 frame 밖에서 돈다. /api를 로컬 게이트웨이로 넘겨, frame 안에서와 같은
    // 모양으로 모듈을 부른다. 그때 쓸 토큰은 .env.development.local에 둔다(README.md).
    proxy: {
      '/api': {
        target: process.env.TERRA_GATEWAY ?? 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  }
});
