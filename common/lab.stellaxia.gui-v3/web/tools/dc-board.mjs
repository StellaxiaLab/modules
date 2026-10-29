// 캔버스 보드(web/design/*.dc.html) → ES 모듈. 빌드(vite.config.js 의 boards() 플러그인)와 시험이 같이 쓴다.
//
// 보드 파일의 조각:
//   <helmet> … </helmet>             글꼴 링크 · <style> — <style> 내용만 가져온다. 캔버스 저장소의 글꼴(/_blob/…)과 외부 글꼴 링크는 버린다
//                                    (앱 CSP 가 font-src 'self' 라 밖에서 못 받는다 — 글꼴은 src/ui/fonts.css 가 앱 안에서 낸다)
//   마크업                            </helmet> 뒤부터 </x-dc>(있으면) 또는 로직 <script> 앞까지
//   <script type="text/x-dc" data-props='…'>   로직(class Component extends DCLogic …)과 속성 기본값
// 로직 코드는 모듈 코드가 된다 — 보드마다 자기 모듈 범위라 맨 위 상수(APPS · CFG …)가 서로 부딪치지 않는다.

const ENT = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#39': "'" };
const decode = (s) => s.replace(/&(quot|amp|lt|gt|apos|#39);/g, (_, k) => ENT[k]);

export function parseBoard(html) {
  const hs = html.indexOf('<helmet>'), he = html.indexOf('</helmet>');
  const helmet = hs >= 0 && he > hs ? html.slice(hs + 8, he) : '';
  const css = [...helmet.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    .replace(/@font-face\s*\{[^}]*\/_blob\/[^}]*\}\s*/g, '');
  const sOpen = html.search(/<script type="text\/x-dc"/);
  if (sOpen < 0) throw new Error('로직 <script type="text/x-dc"> 가 없음');
  const tagEnd = html.indexOf('>', sOpen), sClose = html.lastIndexOf('</script>');
  const tag = html.slice(sOpen, tagEnd + 1), script = html.slice(tagEnd + 1, sClose);
  const mStart = he >= 0 ? he + 9 : html.indexOf('<x-dc>') + 6;
  let mEnd = html.lastIndexOf('</x-dc>', sOpen); if (mEnd < mStart) mEnd = sOpen;
  const markup = html.slice(mStart, mEnd).trim();
  const pm = tag.match(/data-props='([^']*)'/) || tag.match(/data-props="([^"]*)"/);
  const props = {};
  if (pm) {
    const raw = JSON.parse(decode(pm[1]));
    for (const [k, v] of Object.entries(raw)) if (k !== '$preview' && v && typeof v === 'object' && 'default' in v) props[k] = v.default;
  }
  return { css, markup, script, props };
}

/** @param {string} html 보드 파일 @param {string} name 보드 이름(dc-import name) @param {string} runtime 실행기 모듈 경로 */
export function boardModule(html, name, runtime) {
  const B = parseBoard(html);
  if (!/class\s+Component\s+extends\s+DCLogic/.test(B.script)) throw new Error(name + ': class Component extends DCLogic 가 없음');
  return 'import { DCLogic, defineBoard } from ' + JSON.stringify(runtime) + ';\n'
    + B.script.trim() + '\n'
    + 'export default defineBoard({ name: ' + JSON.stringify(name) + ', Logic: Component, markup: ' + JSON.stringify(B.markup)
    + ', css: ' + JSON.stringify(B.css) + ', props: ' + JSON.stringify(B.props) + ' });\n';
}

/** dc-import 로 부르는 보드 이름들 */
export const importsOf = (html) => [...new Set([...html.matchAll(/<dc-import name="([^"]+)"/g)].map((m) => m[1]))];
