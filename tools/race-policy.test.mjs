// node --test tools/race-policy.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideRace } from './race-policy.mjs';

const linux = { platform: 'linux' };

test('리눅스 + cgo 가 있으면 돈다', () => {
  for (const requireRace of [false, true]) {
    const d = decideRace({ ...linux, cgoEnabled: true, requireRace });
    assert.equal(d.run, true);
    assert.equal(d.fail, false);
  }
});

test('리눅스 + cgo 없음 + 강제 아님 — 건너뛰되 notice 로 사유를 남긴다 (실패 아님)', () => {
  const d = decideRace({ ...linux, cgoEnabled: false, requireRace: false });
  assert.equal(d.run, false);
  assert.equal(d.fail, false);
  assert.equal(d.level, 'notice');
  assert.match(d.message, /cgo/);
  assert.match(d.message, /--require-race/);
});

test('리눅스 + cgo 없음 + --require-race — 건너뛰지 않고 실패한다', () => {
  const d = decideRace({ ...linux, cgoEnabled: false, requireRace: true });
  assert.equal(d.run, false);
  assert.equal(d.fail, true);
  assert.equal(d.level, 'error');
  assert.match(d.message, /cgo/);
});

test('리눅스가 아니면 cgo 와 강제 여부와 무관하게 돌지 않고 실패도 아니다', () => {
  for (const platform of ['win32', 'darwin']) {
    for (const cgoEnabled of [true, false]) {
      for (const requireRace of [true, false]) {
        const d = decideRace({ platform, cgoEnabled, requireRace });
        assert.equal(d.run, false, `${platform}/${cgoEnabled}/${requireRace}`);
        assert.equal(d.fail, false, `${platform}/${cgoEnabled}/${requireRace}`);
        assert.match(d.message, new RegExp(platform));
      }
    }
  }
});

test('건너뜀 사유는 비어 있지 않다 — 말없이 건너뛰지 않는다', () => {
  for (const requireRace of [false, true]) {
    const d = decideRace({ ...linux, cgoEnabled: false, requireRace });
    assert.ok(d.message.length > 20);
  }
});
