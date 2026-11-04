// node --test — Scene.dc.html 은 생성물이다(build/mkglobal.py 가 scene_base.html + Field.dc.html + 부품으로 굽는다).
//   보드에만 고친 것은 다시 구우면 사라진다: 31619b7(로그아웃 줄 호버) · 65d5364(역할 칸 · 로컬 노드)가 그렇게 Scene 에만 있었다.
//   사본에 구워 보고 지금 보드와 한 글자도 다르지 않은지 본다. python 이 없는 곳에서는 건너뛴다
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const design = fileURLToPath(new URL('../design/', import.meta.url));
const py = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
const norm = (s) => s.replace(/\r/g, '');

test('Scene.dc.html = 원본(Field · build)을 다시 구운 것', { skip: !py && 'python 없음' }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gui-v3-bake-'));
  try {
    cpSync(design, join(tmp, 'design'), { recursive: true });
    const r = spawnSync(py, ['-I', '-X', 'utf8', 'mkglobal.py'], { cwd: join(tmp, 'design', 'build'), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const want = norm(readFileSync(join(design, 'Scene.dc.html'), 'utf8')), got = norm(readFileSync(join(tmp, 'design', 'Scene.dc.html'), 'utf8'));
    if (got !== want) {
      const a = want.split('\n'), b = got.split('\n'); let i = 0; while (i < a.length && a[i] === b[i]) i++;
      assert.fail('다시 구운 Scene 이 보드와 다르다 — ' + (i + 1) + '행\n  보드: ' + (a[i] || '').slice(0, 160) + '\n  구움: ' + (b[i] || '').slice(0, 160));
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
