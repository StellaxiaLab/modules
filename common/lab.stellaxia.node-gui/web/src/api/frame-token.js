// 앱 토큰을 모듈이 스스로 죽이지 않게 — frame 연결의 갱신을 한 줄로 만든다.
//
// 토큰은 호스트(Terra 셸)가 발급한다: 모듈은 문을 직접 부르지 않고 frame 의 `refresh`(= terra.frame.refresh 메시지)만 보낸다.
// 그런데 Terra 는 같은 앱 · 같은 사용자에게 토큰을 하나만 둔다 — 새로 발급하면 앞의 것은 바로 죽는다(whoami 가 anonymous · real-data-layer.md §5.11).
// 참조 frame 클라이언트(terra-frame-client.js — 스캐폴드 사본 그대로)는 401 하나마다 refresh 를 따로 보낸다. 요청이 동시에 여럿 401 을 맞으면
// 갱신이 여럿 나가 호스트가 토큰을 여럿 발급하고, 먼저 받은 토큰으로 다시 보낸 요청은 뒤에 발급된 토큰 때문에 또 401 이 된다.
// 그래서 모듈의 요청 길(terra.fetch)을 이 파일의 것으로 바꾼다:
//   · 갱신은 동시에 하나만 난다 — 진행 중이면 그 약속을 같이 기다린다
//   · 401 을 맞은 요청이 보낸 토큰이 이미 바뀌었으면(다른 요청이 갱신했다) 새로 발급하지 않고 지금 토큰으로 다시 보낸다
//   · 다시 보내는 것은 한 번뿐이다(참조 클라이언트와 같다)

/** @param {string} path */
const isRelative = (path) => !/^[a-z][a-z0-9+.-]*:/i.test(path) && !path.startsWith('//');

/**
 * @template {{ token: () => (string|undefined), refresh: () => Promise<string|undefined>, fetch: Function, apiBase: string }} F
 * @param {F} frame  connectTerra() 가 돌려준 연결
 * @param {{ fetch?: typeof fetch }} [opts]
 * @returns {F}  fetch · refresh 만 바뀐 연결(나머지는 그대로 따른다). 이미 감쌌으면 그대로
 */
export function singleFlightFrame(frame, opts = {}) {
  if (!frame || frame.__singleFlight) return frame;
  const doFetch = opts.fetch || ((input, init) => globalThis.fetch(input, init));
  /** @type {Promise<string|undefined>|null} */
  let inflight = null;
  const refresh = () => {
    if (!inflight) inflight = Promise.resolve(frame.refresh()).finally(() => { inflight = null; });
    return inflight;
  };
  const fetch = async (path, init) => {
    const relative = isRelative(path);
    const url = relative && !path.startsWith('/api/') ? `${frame.apiBase}${path.startsWith('/') ? '' : '/'}${path}` : path;
    const attempt = (bearer) => {
      const headers = new Headers(init && init.headers);
      if (relative && bearer) headers.set('Authorization', `Bearer ${bearer}`);
      return doFetch(url, Object.assign({}, init, { headers }));
    };
    const used = frame.token();
    const first = await attempt(used);
    if (first.status !== 401 || !relative || !used) return first;
    const now = frame.token();
    const renewed = now && now !== used ? now : await refresh();   // 다른 요청이 이미 갱신했으면 새로 발급하지 않는다
    return renewed ? attempt(renewed) : first;
  };
  const wrapped = Object.create(frame, { fetch: { value: fetch, enumerable: true }, refresh: { value: refresh, enumerable: true }, __singleFlight: { value: true } });
  return wrapped;
}
