// node --test — 보드 마크업의 이벤트 속성은 파서에 닿기 전에 data-dcon-* 로 바뀐다(앱 CSP 의 인라인 핸들러 위반 제거)
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.window = globalThis;
globalThis.document = { createElement: () => ({ style: {}, dataset: {}, content: { childNodes: [] } }) };
const { holdHandlers } = await import(pathToFileURL(fileURLToPath(new URL('../src/ui/dc/runtime.js', import.meta.url))).href);

test('on* 속성은 data-dcon-* 로, dc-import 의 on-close 와 일반 속성 · 글자는 그대로', () => {
  const o = holdHandlers('<div onClick="{{a.b}}" onPointerDown="{{c}}" class="x"><dc-import name="N" on-close="{{f}}" on-full="{{g}}"></dc-import>only= once</div><input onChange = "{{h}}">');
  assert.equal(o, '<div data-dcon-click="{{a.b}}" data-dcon-pointerdown="{{c}}" class="x"><dc-import name="N" on-close="{{f}}" on-full="{{g}}"></dc-import>only= once</div><input data-dcon-change = "{{h}}">');
  assert.ok(!/\son[a-z]+=/.test(o.replace(/\son-/g, '')), '파서가 보는 인라인 핸들러 속성이 없다');
});
