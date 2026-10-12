// 앱 토큰은 같은 앱 · 사용자당 하나 — 새로 발급하면 앞의 것이 죽는다. 모듈이 동시에 여러 번 갱신을 요청해 스스로 토큰을 죽이지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlightFrame } from '../src/api/frame-token.js';

/** 호스트 흉내: refresh 마다 새 토큰 t2, t3… 를 발급하고 앞의 것은 죽인다 */
function host() {
  let issued = 0, live = 't1', tok = 't1';
  const frame = {
    apiBase: '/api/modules/m', token: () => tok,
    refresh: async () => { issued++; await new Promise((r) => setTimeout(r, 5)); live = 't' + (issued + 1); tok = live; return tok; }
  };
  const fetch = async (url, init) => {
    const b = new Headers(init.headers).get('Authorization');
    return new Response('{}', { status: b === 'Bearer ' + live ? 200 : 401 });
  };
  return { frame, fetch, issued: () => issued };
}

test('동시에 401 을 맞은 요청들은 토큰을 한 번만 새로 받고, 모두 살아 있는 토큰으로 다시 보낸다', async () => {
  const h = host();
  await h.frame.refresh();   // 다른 창이 발급했다: t1 은 죽었고 t2 가 산다
  const before = h.issued();
  let cur = 't1';            // 이 창은 아직 t1 을 들고 있다
  const frame = { apiBase: '/api/modules/m', token: () => cur, refresh: async () => { cur = await h.frame.refresh(); return cur; } };
  const g = singleFlightFrame(frame, { fetch: h.fetch });
  const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => g.fetch('/x' + i)));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.equal(h.issued() - before, 1, '갱신은 한 번만 나간다');
});

test('다른 요청이 이미 갱신했으면(보낸 토큰이 지금 토큰과 다르다) 새로 발급하지 않고 지금 토큰으로 다시 보낸다', async () => {
  const h = host();
  await h.frame.refresh();   // t2 가 살아 있다 · t1 은 죽었다
  const before = h.issued();
  let calls = 0;
  const frame = { apiBase: '/api/modules/m', refresh: h.frame.refresh, token: () => (calls++ === 0 ? 't1' : h.frame.token()) };
  const g = singleFlightFrame(frame, { fetch: h.fetch });
  const r = await g.fetch('/x');
  assert.equal(r.status, 200);
  assert.equal(h.issued(), before, '발급 없음');
});

test('절대 주소에는 토큰을 싣지 않고, 이미 감싼 연결은 다시 감싸지 않는다', async () => {
  const h = host();
  let auth = 'none';
  const g = singleFlightFrame(h.frame, { fetch: async (u, init) => { auth = new Headers(init.headers).get('Authorization'); return new Response('{}', { status: 200 }); } });
  await g.fetch('https://other.example/x');
  assert.equal(auth, null);
  assert.equal(singleFlightFrame(g), g);
  assert.equal(g.apiBase, '/api/modules/m');
});
