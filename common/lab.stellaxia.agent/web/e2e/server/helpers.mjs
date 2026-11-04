// 서버 단위 시험 공용 — 가짜 서버를 세우고 HTTP 로 부른다(브라우저 없이).

import { createFakeAgent } from '../fake-agent-server.mjs';
import { createControl } from '../lib/control.mjs';
import { API_PREFIX } from '../lib/routes.mjs';

export { API_PREFIX };

export async function startAgent(options = {}) {
  const agent = await createFakeAgent(options);
  const origin = await agent.listen();
  const control = createControl(origin);
  await control.config({ model_delay_ms: options.modelDelayMs ?? 5 });
  /**
   * @param {string} method
   * @param {string} rel  API_PREFIX 뒤의 경로(쿼리 포함)
   * @param {{principal?: string|null, body?: unknown, raw?: string, headers?: Record<string,string>}} [opts]
   */
  const api = async (method, rel, { principal = 'alice', body, raw, headers = {} } = {}) => {
    const init = { method, headers: { ...headers } };
    if (principal) init.headers['x-terra-principal'] = principal;
    if (raw !== undefined) init.body = raw;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const response = await fetch(`${origin}${API_PREFIX}${rel}`, init);
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, json, text, headers: response.headers };
  };
  return {
    agent, origin, control, api,
    async close() {
      await agent.close();
    },
  };
}

export async function until(fn, { timeout = 5000, interval = 10, message = '조건이 서지 않았다' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`${message} — 마지막 값 ${JSON.stringify(last)}`);
}

export const waitState = (api, id, state, who = 'alice') =>
  until(async () => {
    const r = await api('GET', `/sessions/${id}`, { principal: who });
    return r.json?.state === state && r.json;
  }, { message: `${id} 가 ${state} 가 되지 않았다` });
