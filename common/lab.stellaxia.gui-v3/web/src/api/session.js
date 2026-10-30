// B 모드(제품 셸) — GUI v3 가 스스로 로그인한다. 비밀번호는 Gateway 에 한 번 넘기고(POST /api/v1/auth/credentials),
// 받는 것은 토큰이 아니라 이름(handle)뿐이다 — 토큰은 Gateway 에 남는다(설계 §11.3). 그 뒤 모든 호출에 Authorization: Handle <id>.
// 핸들은 이 탭(sessionStorage)에만 둔다: 탭을 닫으면 사라지고, 로그아웃은 DELETE 로 Gateway 에서도 폐기한다.
//
// 앱 안(A 모드 — 다른 셸이 띄운 sandboxed 앱)에서는 쓰지 않는다: 그때는 셸이 준 스코프 토큰(Bearer tsa_)으로 부른다.

import { TerraError } from './terra.js';

const KEY = 'terra.handle';
const store = (s) => ({ get() { try { return JSON.parse(s.getItem(KEY) || 'null'); } catch { return null; } }, set(v) { try { if (v) s.setItem(KEY, JSON.stringify(v)); else s.removeItem(KEY); } catch {} } });

// 로그인 화면에 띄울 말 — 어느 쪽이 틀렸는지는 Gateway 도 말하지 않는다(CREDENTIAL_REJECTED 하나)
export const LOGIN_MSG = {
  CREDENTIAL_REJECTED: '이메일 또는 비밀번호가 맞지 않아요',
  CREDENTIAL_UNAVAILABLE: 'Master 에 닿지 못해요 — 이 노드가 Tree 에 이어져 있는지 확인',
  NETWORK: 'Gateway 에 닿지 못해요 — Terra 가 켜져 있는지 확인',
  GATEWAY_UNREACHABLE: 'Master 에 닿지 못해요', TIMEOUT: '응답이 늦어요 — 다시 시도', HTTP_501: '이 Gateway 는 Master 연결이 없어요',
};

/**
 * @param {{ fetch?: typeof fetch, storage?: Storage }} [o]
 */
export function createSession(o = {}) {
  const f = o.fetch || globalThis.fetch.bind(globalThis), S = store(o.storage || globalThis.sessionStorage);
  let cur = S.get();
  const subs = new Set(), emit = () => { for (const fn of subs) try { fn(cur); } catch {} };
  return {
    get handle() { return cur && cur.handle; },
    get who() { return cur && cur.session; },
    authorization() { return cur && cur.handle ? 'Handle ' + cur.handle : null; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    /** @returns {Promise<{ handle, session }>} 실패하면 TerraError(code, 화면 말) */
    async login(email, password) {
      let res;
      try { res = await f('/api/v1/auth/credentials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); }
      catch (e) { throw new TerraError('NETWORK', LOGIN_MSG.NETWORK, 0, true); }
      let body = null; try { body = await res.json(); } catch {}
      if (!res.ok || !body || (body.status === 'error') || body.error) {
        const e = (body && (body.error || body)) || {}, code = e.code || (res.status === 401 ? 'CREDENTIAL_REJECTED' : 'HTTP_' + res.status);
        throw new TerraError(code, LOGIN_MSG[code] || e.message || '로그인 못 함 (' + code + ')', res.status);
      }
      const d = 'data' in body ? body.data : body;
      if (!d || !d.handle) throw new TerraError('BAD_RESPONSE', '핸들이 없는 응답', res.status);
      cur = { handle: d.handle, session: d.session || {}, at: Date.now() }; S.set(cur); emit();
      return cur;
    },
    /** Gateway 에서도 폐기 — 핸들이 이미 없었어도 같은 답(떠보기 막기) */
    async logout() {
      const h = this.authorization(); cur = null; S.set(null); emit();
      if (h) try { await f('/api/v1/auth/credentials', { method: 'DELETE', headers: { authorization: h } }); } catch {}
    },
  };
}
