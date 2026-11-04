// node --test — SVI 허가 주체 · 작업 · 기한이 Master 위임 가드(delegated_grant_guard.go)대로인지
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRANT_OPS, GUARD_OPS, GRANT_TTLS, GUARD_MAX_TTL, selfIdOf, subjectRule, allowedOps, toggleOp, checkGrant, opsText } from './svi-grant.js';

test('selfIdOf — principal 의 via 앞, user: 뒤', () => {
  assert.equal(selfIdOf({ principal: 'user:u-7 via lab.stellaxia.gui-v3.web' }), 'u-7'); assert.equal(selfIdOf({ principal: 'me@lab' }), 'me@lab');
  assert.equal(selfIdOf({ principal: 'anonymous' }), ''); assert.equal(selfIdOf(null), '');
});

test('subjectRule — 노드는 read · subscribe · bind.source, 사람(나)은 + inspect · bind.target, write · invoke 는 누구도', () => {
  const n = subjectRule('node', 'n1', 'u1'), u = subjectRule('user', 'u1', 'u1');
  assert.ok(n.ok); assert.ok(u.ok);
  assert.deepEqual(n.ops.filter((o) => o.ok).map((o) => o.op), ['read', 'subscribe', 'bind.source']);
  assert.deepEqual(u.ops.filter((o) => o.ok).map((o) => o.op), ['inspect', 'read', 'subscribe', 'bind.source', 'bind.target']);
  for (const r of [n, u]) for (const o of r.ops) if (o.op === 'write' || o.op === 'invoke') { assert.equal(o.ok, false); assert.match(o.why, /줄 수 없다/); }
  assert.equal(n.ops.find((o) => o.op === 'bind.target').ok, false);
  assert.deepEqual(GRANT_OPS.length, n.ops.length);
  for (const [, s] of n.ttls) assert.ok(s > 0 && s <= GUARD_MAX_TTL);
  const other = subjectRule('user', 'u2', 'u1'); assert.equal(other.ok, false); assert.match(other.why, /나 자신에게만/);
  assert.match(subjectRule('user', 'u1', '').why, /사용자를 알 수 없다/); assert.equal(subjectRule('application', 'a', 'u1').ok, false);
});

test('allowedOps · toggleOp — 못 주는 작업은 켜지지 않는다', () => {
  assert.deepEqual(allowedOps('node', ['write', 'read', 'inspect']), ['read']);
  assert.deepEqual(toggleOp('user', ['read'], 'bind.target'), ['read', 'bind.target']);
  assert.deepEqual(toggleOp('node', ['read'], 'bind.target'), ['read']); assert.deepEqual(toggleOp('node', ['read', 'subscribe'], 'read'), ['subscribe']);
});

test('checkGrant — 가드와 같은 거절(남 · 작업 · 기한)', () => {
  const ok = (g) => checkGrant(Object.assign({ subject_type: 'node', subject_id: 'n1', operations: ['read'], ttl_seconds: 86400 }, g), 'u1');
  assert.ok(ok({}).ok); assert.ok(ok({ subject_type: 'user', subject_id: 'u1', operations: GUARD_OPS.user }).ok);
  assert.match(ok({ subject_type: 'user', subject_id: 'u2' }).why, /나 자신/); assert.match(ok({ subject_type: 'application' }).why, /위임 가드/);
  assert.match(ok({ operations: ['inspect'] }).why, /노드에게 inspect/); assert.match(ok({ operations: [] }).why, /하나 이상/);
  assert.match(ok({ ttl_seconds: 0 }).why, /기한이 있어야/); assert.match(ok({ ttl_seconds: GUARD_MAX_TTL + 1 }).why, /90일까지/);
  assert.ok(ok({ ttl_seconds: GRANT_TTLS.at(-1)[1] }).ok);
  assert.equal(opsText(['read', 'bind.source']), '읽기 · 연결 원천'); assert.equal(opsText([]), '—');
});

test('GUARD_OPS — Terra 가드 원본과 같다(있으면)', async () => {
  const { readFileSync, existsSync } = await import('node:fs'), p = '/home/claude/terra/products/tree/master/src/terra_master/api/delegated_grant_guard.go';
  if (!existsSync(p)) return;
  const g = readFileSync(p, 'utf8'), block = (s) => g.slice(g.indexOf('coresvi.' + s + '):'), g.indexOf('},', g.indexOf('coresvi.' + s + '):')));
  const ops = (b) => [...b.matchAll(/Operation(\w+)\)/g)].map((m) => m[1].replace(/([a-z])([A-Z])/g, '$1.$2').toLowerCase());
  assert.deepEqual(ops(block('SubjectUser')), GUARD_OPS.user); assert.deepEqual(ops(block('SubjectNode')), GUARD_OPS.node);
  assert.match(g, /delegatedGrantMaxTTL = 90 \* 24 \* time\.Hour/);
});
