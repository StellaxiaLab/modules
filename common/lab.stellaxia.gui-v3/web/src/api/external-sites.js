// 외부 사이트를 창 안 브라우저에서 어떻게 열지 — ADR-GW-015 §6.1 분기 · §5.3 막힘 목록 · 사용자 "늘 밖에서" 기억 · §4.1 iframe 속성
//   순수 함수(DOM · 네트워크 없음). 웹 브라우저 창 보드가 window.TerraExternalSites 로 쓴다(main.js 가 꽂는다). 외부로 요청을 보내지 않는다.
//   분기: Terra 자신의 주소(Gateway · 데스크톱 셸 · *.localhost 앱 origin) → 거절 · 그 밖 루프백(이 PC) → iframe · 평문 http 가 사설/링크로컬/루프백이 아니면 → 밖으로 · 막힘 목록/기억 호스트 → 밖으로 · 앱에 external-frames 없음 → 밖으로 · 그 밖 → iframe
import BLOCK from '../data/external-block-list.json' with { type: 'json' };

export const CAPABILITY = 'external-frames';
// 외부 iframe 속성 — 안쪽은 바깥 프레임(Scene 의 WEB_FRAME_SANDBOX)보다 좁다: allow-downloads · popups · top-navigation · modals 없음
export const FRAME_SANDBOX = 'allow-scripts allow-forms allow-same-origin';
export const FRAME_ALLOW = '';
export const FRAME_REFERRER = 'no-referrer';
export const MEMORY_KEY = 'terra.web.out';
// Terra 자신이 이 PC 에 여는 포트 — terra-shell endpoints_gen.go 의 기본 배치: Gateway 8787 · 앱 origin(Gateway) 8788 · 셸 17421/17422 · 셸 backend 17321/8080.
//   옮긴 배치는 classify 의 o.gateway(지금 페이지가 온 host:port)로 함께 거절한다. 루프백 호스트에만 적용(다른 호스트의 같은 번호는 Terra 가 아니다)
export const TERRA_OWN_PORTS = Object.freeze([8080, 8787, 8788, 17321, 17421, 17422]);
export const BLOCK_HOSTS = Object.freeze(BLOCK.hosts.slice());

const stripBr = (h) => String(h || '').replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
function v4(h) { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h); if (!m) return null; const o = m.slice(1).map(Number); return o.every((n) => n <= 255) ? o : null; }
// ::ffff:7f00:1 · ::ffff:127.0.0.1 → 점 4개 꼴로(URL 은 뒤쪽을 16진 둘로 바꿔 놓는다)
function mapped(h) { const m = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h); if (!m) return null;
  if (m[1]) return m[1]; const a = parseInt(m[2], 16), b = parseInt(m[3], 16); return [a >> 8, a & 255, b >> 8, b & 255].join('.'); }

/** 루프백 — 127/8 · 0.0.0.0 · ::1 · localhost · *.localhost. 보는 사람의 PC 를 가리킨다(원격 노드 창이어도). Terra 자신의 것만 classify 가 거절한다 */
export function isLoopbackHost(host) {
  const h = stripBr(host), mp = mapped(h), x = mp || h, a = v4(x);
  if (a) return a[0] === 127 || a.every((n) => n === 0);
  return h === '::1' || h === '::' || h === 'localhost' || h.endsWith('.localhost');
}
/** `*.localhost` (점 있는 이름) — Terra 앱 origin(예: app-x.localhost:8788). 점 없는 `localhost` 는 해당 없음 */
export const isLocalhostSub = (host) => stripBr(host).endsWith('.localhost');
const portOf = (u) => Number(u.port || (u.protocol === 'https:' ? 443 : 80));
function gwPort(g) { try { const x = new URL(/^[a-z]+:\/\//i.test(String(g)) ? String(g) : 'http://' + g); return isLoopbackHost(x.hostname) ? portOf(x) : 0; } catch { return 0; } }
/** 루프백 주소가 Terra 자신의 것인가 — *.localhost · 기본 Terra 포트 · 지금 페이지가 온 Gateway 포트(o.gateway: host:port 또는 origin, 하나 또는 여러 개) */
export function isTerraOwn(u, gateway) {
  if (!isLoopbackHost(u.hostname)) return false;
  if (isLocalhostSub(u.hostname)) return true;
  const p = portOf(u), gs = (Array.isArray(gateway) ? gateway : [gateway]).filter(Boolean).map(gwPort);
  return TERRA_OWN_PORTS.includes(p) || gs.includes(p);
}
/** 사설 · 링크로컬 — 10/8 · 172.16/12 · 192.168/16 · 169.254/16 · fc00::/7 · fe80::/10 · .local · .lan · .home.arpa · .internal · 점 없는 이름(사내 이름). 루프백은 아니다 */
export function isPrivateHost(host) {
  const h = stripBr(host); if (!h || isLoopbackHost(h)) return false;
  const mp = mapped(h), a = v4(mp || h);
  if (a) return a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168) || (a[0] === 169 && a[1] === 254);
  if (h.includes(':')) return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  return !h.includes('.') || /\.(local|lan|internal)$/.test(h) || h.endsWith('.home.arpa');
}
/** host 가 list 의 어느 항목이거나 그 하위 도메인인가 */
export function hostMatches(host, list) { const h = stripBr(host); return (list || []).some((d) => { d = stripBr(d); return !!d && (h === d || h.endsWith('.' + d)); }); }
export const isKnownBlocked = (host) => hostMatches(host, BLOCK_HOSTS);

/** 이 앱(gui-v3 웹)이 앱 목록에서 external-frames 를 선언했는가 — true | false | null(목록을 아직 못 받음 · 자기 항목을 못 찾음) */
export function frameCapability(apps) {
  if (!Array.isArray(apps)) return null;
  const me = apps.find((a) => a && /(^|[./])lab\.stellaxia\.gui-v3\.web$|gui-v3\.web$/.test(String(a.id || a.appId || '')));
  return me ? Array.isArray(me.capabilities) && me.capabilities.includes(CAPABILITY) : null;
}

/** 사용자 기억("이 사이트는 늘 밖에서") — 호스트 단위. store 는 localStorage 꼴(getItem/setItem); 없거나 던지면 빈 기억 */
export function createMemory(store) {
  const rd = () => { try { const v = JSON.parse(store.getItem(MEMORY_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []; } catch { return []; } };
  const wr = (v) => { try { store.setItem(MEMORY_KEY, JSON.stringify(v)); return true; } catch { return false; } };
  return {
    list: rd,
    has: (host) => hostMatches(host, rd()),
    add(host) { const h = stripBr(host); if (!h) return false; const v = rd(); if (!v.includes(h)) v.push(h); return wr(v); },
    remove(host) { const h = stripBr(host); return wr(rd().filter((x) => x !== h)); },
    clear: () => wr([]),
  };
}

/** 호스트 이름 → punycode(ASCII). URL 이 이미 바꿔 준다. 읽지 못하면 '' */
export function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

/**
 * 외부 주소를 어디에 어떻게 열지.
 * @param {string} url  http(s) 주소
 * @param {{ memory?: {has:(h:string)=>boolean}, apps?: any[]|null, shell?: boolean, gateway?: string|string[] }} o  gateway = 지금 페이지가 온 Gateway host:port(location.host). shell = 실제 셸 안(기본 브라우저 경로가 있다)
 * @returns {{ route: 'frame'|'out'|'reject', why: string, host: string, plain: boolean, local: boolean, thisPc?: boolean }}
 */
export function classify(url, o = {}) {
  let u; try { u = new URL(String(url)); } catch { return { route: 'reject', why: 'bad-url', host: '', plain: false, local: false }; }
  const host = u.hostname, plain = u.protocol === 'http:', priv = isPrivateHost(host), base = { host, plain, local: priv, thisPc: isLoopbackHost(host) };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ...base, route: 'reject', why: 'scheme' };
  if (isTerraOwn(u, o.gateway)) return { ...base, route: 'reject', why: 'terra-own' };   // Gateway · 셸 · Terra 앱 origin 을 외부 틀로 띄워 셸의 앱 열기 경로(토큰 · 격리)를 우회하는 것을 막는다
  if (u.username || u.password) return { ...base, route: 'out', why: 'credentials' };          // https://google.com@evil — 주소창이 속이지 못하게 밖으로
  if (plain && !priv && !base.thisPc) return { ...base, route: 'out', why: 'plain-http' };
  if (o.memory && o.memory.has(host)) return { ...base, route: 'out', why: 'remembered' };
  if (isKnownBlocked(host)) return { ...base, route: 'out', why: 'known-blocked' };
  const cap = frameCapability(o.apps);
  if (cap === false || (cap === null && o.shell)) return { ...base, route: 'out', why: 'no-capability' };   // 옛 Gateway — iframe 이 CSP 에 막혀 빈 화면이 되는 것을 피한다
  return { ...base, route: 'frame', why: 'frame' };
}
