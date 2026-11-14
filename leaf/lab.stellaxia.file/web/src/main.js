// terra.web/frame 안에서 도는 lab.stellaxia.file 의 화면이다.
//
// 모듈의 Scene 은 이 웹을 감싸는 얇은 껍데기이고 로그인도 그쪽이 맡는다. 이 웹은 frame 이 건넨 스코프 토큰
// (사용자 권한 ∩ module.json 의 앱 권한)으로 Gateway 의 operation 을 부를 뿐이다.
import { connectTerra } from './terra-frame-client.js';
import { mountApp } from './app.js';
import './style.css';

const root = document.getElementById('app');

function notice(text) {
  const p = document.createElement('p');
  p.className = 'state muted';
  p.textContent = text;
  root.replaceChildren(p);
}

async function main() {
  let terra;
  try {
    terra = await connectTerra({
      // `npm run dev` 로 frame 밖에서 돌릴 때만 쓴다. 빌드에서는 import.meta.env.DEV 가 false 로 접혀 번들에 들어가지 않는다.
      devToken: import.meta.env.DEV ? import.meta.env.VITE_TERRA_DEV_TOKEN : undefined,
      devModuleId: import.meta.env.DEV ? 'lab.stellaxia.file' : undefined,
    });
  } catch (error) {
    notice(`Terra 화면 밖에서 열렸습니다: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  mountApp(root, terra);
}

void main();
