// 승인 카드를 다루는 시험들이 같이 쓰는 도구 — 서버 쪽에서 심은 세션을 앱으로 열고, 카드가 서길 기다린다.

import { agentApi, openApp } from './app.mjs';

/** 세션을 서버 쪽에서 심고(시나리오를 못 박는다) 앱으로 연다. */
export async function openAsk(t, { id, scenario = 'approval-flow', autonomy = 'ask', principal = 'alice', ...rest }) {
  const api = agentApi(t, principal);
  await api.open({ id, autonomy, scenario, ...rest });
  const app = await openApp(t, { principal, route: `#/s/${id}` });
  await app.pane.waitFor({ state: 'visible' });
  return { api, app };
}

export const pendingCard = (app) => app.$('.appr[data-card-state="pending"]');
export const slot = (app, state) => app.$(`.approval-slot[data-card-state="${state}"]`);

/** 대기 카드가 설 때까지 — 상태 칩 "승인 대기" 와 카드 둘 다. */
export async function waitCard(app) {
  await app.waitChip('승인 대기');
  await pendingCard(app).waitFor({ state: 'visible' });
  return pendingCard(app);
}
