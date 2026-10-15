// 제어 엔드포인트(/__control/…)의 작은 클라이언트 — 시험과 러너가 쓴다.

export function createControl(origin) {
  const call = async (method, path, body) => {
    const response = await fetch(`${origin}/__control${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || json.ok === false) throw new Error(`제어 호출 실패 ${method} ${path}: ${JSON.stringify(json)}`);
    return json;
  };
  return {
    call,
    /** 프리셋: ready | empty | no-model | no-credential | expired-credential | unattended-credential */
    reset: (preset = 'ready') => call('POST', '/reset', { preset }),
    state: () => call('GET', '/state'),
    scenarios: () => call('GET', '/scenarios'),
    /** 전역 기본 시나리오. */
    scenario: (id) => call('POST', '/scenario', { id }),
    /** 한 세션에 못 박는다. */
    pin: (id, sessionId, times) => call('POST', '/scenario', { id, session_id: sessionId, ...(times ? { times } : {}) }),
    /** 다음 n 번의 턴에만(전역 대기열). */
    queue: (id, times = 1) => call('POST', '/scenario', { id, queue: true, times }),
    advance: (seconds) => call('POST', '/clock', { advance_s: seconds }),
    inject: (match, effect, extra = {}) => call('POST', '/inject', { match, effect, ...extra }),
    clearInjections: () => call('DELETE', '/inject'),
    config: (patch) => call('POST', '/config', patch),
    features: (features) => call('POST', '/config', { features }),
    account: (principal, permissions) => call('POST', '/accounts', { principal, permissions }),
    credential: (principal, flags = {}) => call('POST', '/credential', { principal, ...flags }),
    seed: (body) => call('POST', '/seed', body),
    restartModule: () => call('POST', '/restart-module'),
    requests: async (query = '') => (await call('GET', `/requests${query}`)).requests,
    calls: async () => (await call('GET', '/calls')).calls,
    sessions: async () => (await call('GET', '/sessions')).sessions,
  };
}
