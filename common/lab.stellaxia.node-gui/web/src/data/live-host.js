// 보드(네트워크 · 설정)가 Terra 에 닿는 길.
//
// 보드는 세 자리에서 뜬다(src/api/frame-boot.js role):
//   board       노드 화면의 전체 화면 창(srcdoc) — 같은 origin 의 부모(노드 화면)가 이미 frame 토큰을 쥐고 있다.
//               노드 화면이 window.__terraLive(liveHub)에 클라이언트를 올려 두고, 보드는 그것을 빌려 쓴다.
//   frame       보드 페이지가 셸의 frame 안에 직접 열렸다 — 스스로 hello 를 보내 토큰을 받는다.
//   standalone  Terra 밖(npm run dev · 정적 서버) — 닿을 곳이 없다. 빈 화면과 그 이유만 보인다.

import { TerraClient } from '../api/client.js';
import { frameReady, role } from '../api/frame-boot.js';

/**
 * @typedef {{ client: TerraClient, terra: any, permissions: string[], principal: string, node?: { name: string, id?: string|null } }} Live
 */

/** 한 창 안의 실데이터 연결을 나눠 주는 곳 — 노드 화면(wire.js)이 set, 보드가 on */
export function liveHub(win) {
  if (!win.__terraLive) {
    const listeners = new Set();
    win.__terraLive = {
      value: null,
      on(fn) { listeners.add(fn); fn(this.value); return () => listeners.delete(fn); },
      set(v) { this.value = v; listeners.forEach((fn) => { try { fn(v); } catch (e) { console.warn('[terra] 보드 갱신 실패', e); } }); }
    };
  }
  return win.__terraLive;
}

/**
 * 보드가 부른다. 연결이 생기거나 바뀌거나 끊길 때마다 onChange(Live | null).
 * @param {(live: Live | null, why?: string) => void} onChange  why = 연결이 없는 이유
 * @returns {() => void} 그만 듣기
 */
export function connectLive(onChange) {
  if (role === 'board') {
    let hub = null;
    try { hub = window.parent.__terraLive || null; } catch { hub = null; }
    if (hub) return hub.on((v) => onChange(v, v ? undefined : 'NO_SESSION'));
    onChange(null, 'NO_HOST');
    return () => {};
  }
  if (role === 'frame') {
    let stopped = false, off = () => {};
    void frameReady.then(async (terra) => {
      if (stopped) return;
      if (!terra) { onChange(null, 'NO_FRAME'); return; }
      let gen = 0;
      const sync = async () => {
        const mine = ++gen;
        if (!terra.token()) { onChange(null, terra.absence() || 'NO_SESSION'); return; }
        const client = new TerraClient('', { fetch: terra.fetch.bind(terra), delegated: true });
        try { await client.refreshCatalog(); } catch (e) { console.warn('[terra] catalog 실패 — 카탈로그 없이 진행', e); }
        if (stopped || mine !== gen) return;
        const value = terra.value();
        onChange({ client, terra, permissions: terra.permissions().slice(), principal: (value && value.principal) || '' });
      };
      off = terra.onToken(() => { void sync(); });
      await sync();
    });
    return () => { stopped = true; off(); };
  }
  onChange(null, 'STANDALONE');
  return () => {};
}

/** 연결이 없는 이유 → 사람이 읽는 말 */
export function absenceText(why) {
  return {
    NO_SESSION: 'Terra에 로그인하지 않았다 — 노드 화면의 [로그인]으로 들어오면 이 노드의 값이 보인다',
    SCOPE_TOKEN_DENIED: '이 계정에는 이 화면이 쓰는 권한이 없다',
    NO_HOST: '노드 화면과 연결되지 않았다 — 노드 화면에서 이 보드를 다시 연다',
    NO_FRAME: 'Terra 셸이 화면 토큰을 주지 않았다',
    STANDALONE: 'Terra 밖에서 열었다 — 데이터가 없다. Terra 안(셸)에서 열어야 이 노드의 값이 보인다'
  }[why] || ('게이트웨이에서 화면 토큰을 받지 못했다 (' + (why || '알 수 없음') + ')');
}
