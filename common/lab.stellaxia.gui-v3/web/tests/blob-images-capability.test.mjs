// node --test — AUD-74(blob 부분): 웹 앱이 blob: 이미지(StarMaker 의 createObjectURL · 파일 미리보기)를 띄우려면
//   module.json 의 contributions.gui.apps[].capabilities 에 Gateway 가 내는 "blob-images" 를 선언해야 한다(img-src blob: · media-src blob: 만 열린다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mod = JSON.parse(readFileSync(fileURLToPath(new URL('../../module.json', import.meta.url)), 'utf8'));

test('gui-v3 웹 앱은 blob-images 를 선언한다 (다른 것은 열지 않는다)', () => {
  const app = mod.contributions.gui.apps.find((a) => a.id === 'lab.stellaxia.gui-v3.web');
  assert.ok(app, '웹 앱 선언');
  assert.deepEqual(app.capabilities, ['blob-images']);   // workers · wasm 은 필요 없다 — 넓히지 않는다
});
