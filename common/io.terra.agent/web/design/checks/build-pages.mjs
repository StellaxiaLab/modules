// 디자인 캔버스 원본(*.dc.html)을 점검용 페이지로 만든다.
// node-gui의 tools/gen-pages.py와 같은 방식 — <helmet> → 머리, 템플릿 → <script type="text/x-template">,
// 스크립트 → dc.js의 DCLogic을 잇는 ES 모듈. 원본은 고치지 않는다.
// 사용: node build-pages.mjs [designDir] [outDir] [dcJs]
//   designDir 기본: 이 파일의 부모(web/design)   outDir 기본: ./.pages   dcJs 기본: modules의 node-gui dc.js
import fs from 'fs';
import path from 'path';
import { HERE } from './lib.mjs';

const designDir = path.resolve(process.argv[2] || path.join(HERE, '..'));
const outDir = path.resolve(process.argv[3] || path.join(HERE, '.pages'));
const dcJs = path.resolve(process.argv[4] || process.env.DC_JS || path.join(HERE, '../../../../lab.stellaxia.node-gui/web/src/runtime/dc.js'));
if (!fs.existsSync(dcJs)) { console.error('dc.js를 찾지 못했다: ' + dcJs + ' (DC_JS 환경변수나 넷째 인자로 지정)'); process.exit(2); }

fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
fs.copyFileSync(dcJs, path.join(outDir, 'dc.js'));
fs.copyFileSync(path.join(designDir, 'assets/map-sample.jpg'), path.join(outDir, 'assets/map-sample.jpg'));

for (const name of ['AgentGUI', 'AgentGUILive']) {
  const s = fs.readFileSync(path.join(designDir, name + '.dc.html'), 'utf8');
  const body = s.split('<x-dc>')[1].split('</x-dc>')[0];
  const m = body.match(/<helmet>([\s\S]*?)<\/helmet>/);
  const helmet = m ? m[1] : '';
  const tpl = body.replace(/<helmet>[\s\S]*?<\/helmet>/, '').trim();
  if (tpl.includes('</script')) throw new Error(name + ': 템플릿에 </script 가 있다');
  const js = s.split('data-dc-script')[1].split('>').slice(1).join('>').split('</script>')[0].trim();
  const props = JSON.parse(s.match(/data-props='([^']*)'/)[1]);
  const w = props.$preview.width;
  fs.writeFileSync(path.join(outDir, name + '.js'),
    "import { DCLogic } from './dc.js';\n" + js.replace('class Component extends DCLogic', 'export default class Component extends DCLogic') + '\n');
  fs.writeFileSync(path.join(outDir, name + '.html'), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${name}</title>
${helmet}
<style>html,body{margin:0;background:#07090c}#stage{width:${w}px}</style>
</head><body>
<div id="stage"></div>
<script type="text/x-template" id="view">
${tpl}
</script>
<script type="module">
import { mount } from './dc.js';
import Screen from './${name}.js';
window.__screen = mount(Screen, { template: document.getElementById('view').textContent, target: document.getElementById('stage'), props: {} });
window.__mounted = true;
</script>
</body></html>
`);
  console.log('만들었다', name, '템플릿', tpl.length, '글자, 스크립트', js.length, '글자');
}
console.log('출력:', outDir);
