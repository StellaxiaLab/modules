// node --test — 실행 모드 고르기
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMode, frameRole } from './mode.js';

const win = (parent, sameOrigin) => { const w = {}; w.parent = parent === 'self' ? w : { get document() { if (!sameOrigin) throw new Error('SecurityError'); return {}; } }; return w; };

test('pickMode — ?demo · ?mode · 셸 안(다른 origin 부모)이면 앱, 아니면 제품 셸', () => {
  assert.equal(pickMode(new URLSearchParams('demo'), win('self')), 'demo');
  assert.equal(pickMode(new URLSearchParams('mode=app'), win('self')), 'app');
  assert.equal(pickMode(new URLSearchParams(''), win('self')), 'shell');
  assert.equal(pickMode(new URLSearchParams(''), win('p', false)), 'app');
  assert.equal(pickMode(new URLSearchParams(''), win('p', true)), 'shell');   // 같은 origin 부모 = 보드 미리보기 — 셸이 아니다
  assert.equal(frameRole(win('p', false)), 'frame');
});
