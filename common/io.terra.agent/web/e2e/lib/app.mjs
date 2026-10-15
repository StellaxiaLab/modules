// 실제 앱(`--app ui`) 점검의 공용 도구 — 세션을 서버 쪽에서 심고, 앱을 그 세션에서 열고, 화면의 상태를 읽는다.
//
// 세션은 **앱 밖에서** 심는다(가짜 Gateway 에 `Authorization: Bearer fake.<이름>` 으로 직접). 앱의 새 세션 화면은 `plan` 만 열 수 있어서
// (자율성 `ask`·`auto`·`unattended` 는 G2 이후) 다른 자율성의 세션은 이렇게 심어야 한다. 앱 자신은 늘 셸 브리지를 거친다.
// 화면은 문구가 아니라 `data-role`·`data-kind`·`data-status`·`role` 로 읽는다(README 규칙).

import { APP_MOUNT } from '../serve.mjs';
import { MODULE, assert, openShell, until } from './harness.mjs';

export { MODULE, assert, until };

/** 서버 쪽 호출자. 앱과 같은 길(Gateway)이지만 브리지를 거치지 않는다 — 시험이 상태를 심고 읽는 용도다. */
export function agentApi(t, principal = 'alice') {
  const call = async (method, path, body) => {
    const response = await fetch(`${t.stack.gatewayOrigin}${MODULE}${path}`, {
      method,
      headers: { authorization: `Bearer fake.${principal}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data };
  };
  return {
    call,
    /** 세션을 연다(멱등 id). 시나리오를 못 박으려면 `scenario` 를 준다. */
    async open({ id, autonomy = 'plan', scenario, ...rest }) {
      if (scenario) await t.control.pin(scenario, id);
      const opened = await call('POST', '/sessions', { session_id: id, autonomy, ...rest });
      assert.equal(opened.status, 200, `세션 ${id} 를 열지 못했다: ${JSON.stringify(opened.data)}`);
      return opened.data;
    },
    /** 글을 보낸다(차례가 시작된다). */
    async say(id, text) {
      const posted = await call('POST', `/sessions/${id}/messages`, { text });
      assert.equal(posted.status, 201, `글을 보내지 못했다: ${JSON.stringify(posted.data)}`);
      return posted.data;
    },
    session: async (id) => (await call('GET', `/sessions/${id}`)).data,
    entries: async (id) => (await call('GET', `/sessions/${id}/messages?limit=5000`)).data.entries,
    /** 상태가 되고 `until` 이 참일 때까지 기다린다(시계가 아니라 조건). */
    async waitState(id, state, message) {
      return until(async () => {
        const s = await call('GET', `/sessions/${id}`);
        return s.data.state === state && s.data;
      }, { message: message ?? `${id} 가 ${state} 가 되지 않았다` });
    },
  };
}

/** 앱을 셸 안에서 연다. `route` 가 있으면 그 해시에서 시작한다(`#/s/<id>`). 앱 본체가 그려질 때까지 기다린다. */
export async function openApp(t, { principal = 'alice', route = '', permissions, ...rest } = {}) {
  const params = { principal, ...rest };
  if (permissions !== undefined) params.permissions = permissions;
  if (route) params.app = `${APP_MOUNT}index.html${route}`;
  const shell = await openShell(t, params, { wait: '[data-role="app"]' });
  const f = shell.frame;
  const app = {
    ...shell,
    f,
    /** 앱 안의 요소. */
    $: (selector) => f.locator(selector),
    pane: f.locator('[data-role="session-pane"]'),
    log: f.locator('[data-role="log"]'),
    textarea: f.locator('#composer-input'),
    send: f.locator('[data-role="send"]'),
    cancel: f.locator('[data-role="cancel"]'),
    dialog: f.locator('[role="dialog"]'),
    stateChip: f.locator('[data-role="state-chip"] span:last-child'),
    lastError: f.locator('[data-role="last-error"]'),
    /** 세션을 연다 — 사이드바의 링크를 누르는 것과 같다(해시 이동). */
    async goto(id) {
      await f.evaluate((hash) => {
        window.location.hash = hash;
      }, `#/s/${encodeURIComponent(id)}`);
      await f.locator('[data-role="session-pane"]').waitFor({ state: 'visible' });
    },
    /** 화면의 줄들: [{seq, kind}]. */
    lines: () => f.locator('.line[data-seq]').evaluateAll((els) => els.map((el) => ({ seq: Number(el.dataset.seq), kind: el.dataset.kind, text: el.textContent ?? '' }))),
    lineKinds: async () => (await app.lines()).map((l) => l.kind),
    /** 상태 칩이 `label` 이 될 때까지. */
    waitChip: (label, message) => until(async () => (await app.stateChip.textContent()) === label, { message: message ?? `상태 칩이 '${label}' 이 되지 않았다` }),
    /** 입력칸에 글을 쓰고 Enter 로 보낸다. */
    async type(text) {
      await app.textarea.fill(text);
      await app.textarea.press('Enter');
    },
  };
  return app;
}

/**
 * 줄이 들어오는 애니메이션(rise 등)이 끝나기를 기다린다 — 도중의 위치·반투명을 재지 않게. 끝없는 애니메이션(생각 중 점)은 뺀다.
 * 시계가 아니라 브라우저가 아는 "애니메이션이 끝났다"를 기다린다.
 */
export function settle(app) {
  return app.f.evaluate(async () => {
    const finite = () => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite().map((a) => a.finished.catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

/** 서버가 받은 요청 중 이 operation 의 것. 시험이 시작한 뒤 것만 보려면 `since`(요청 번호). */
export async function requestsOf(t, op, since = 0) {
  return t.control.requests(`?op=${encodeURIComponent(op)}${since ? `&since=${since}` : ''}`);
}

export const OP = {
  messagesPost: 'io.terra.agent.messages.post',
  messagesList: 'io.terra.agent.messages.list',
  sessionsGet: 'io.terra.agent.sessions.get',
  sessionsList: 'io.terra.agent.sessions.list',
  sessionsPost: 'io.terra.agent.sessions.post',
  sessionsCancel: 'io.terra.agent.sessions.cancel',
  approvalsPost: 'io.terra.agent.approvals.post',
};

/** 요청 로그의 마지막 번호 — 이 뒤로 온 요청만 세려고 시험이 잡아 둔다. */
export async function mark(t) {
  const all = await t.control.requests('');
  return all.length ? all[all.length - 1].n : 0;
}
