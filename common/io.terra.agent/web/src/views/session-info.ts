// 오른쪽 열 — 세션 사실. 값은 모두 응답의 것이다(요청한 값이 아니다 — I10). 비용은 토큰으로만(I14).
import { h, icon } from '../app/dom';
import { formatCount, formatKB } from '../app/format';
import type { SessionView } from '../data/view';
import type { View } from './types';

export interface SessionInfoModel {
  view: SessionView | null;
}

function kv(rows: ReadonlyArray<[string, string]>): HTMLElement {
  return h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

export function createSessionInfo(): View<SessionInfoModel> {
  const facts = h('div', { class: 'info-facts' });
  const usage = h('div', { class: 'info-usage' });
  const sent = h('div', { class: 'card info-sent' });
  const el = h(
    'aside',
    { class: 'c3', attrs: { 'aria-label': '세션 정보', 'data-role': 'session-info' } },
    h('section', { class: 'info-sec' }, h('span', { class: 'cap' }, '세션'), facts),
    h('section', { class: 'info-sec' }, h('span', { class: 'cap' }, '사용량 · 한도'), usage),
    sent,
  );
  return {
    el,
    update({ view }) {
      if (!view) {
        facts.replaceChildren(h('span', { class: 'dim' }, '읽는 중입니다.'));
        usage.replaceChildren();
        sent.replaceChildren();
        return;
      }
      const s = view.snapshot;
      const model = [s.provider, s.model].filter((v): v is string => !!v).join('/');
      facts.replaceChildren(
        kv([
          ['자율성', `${s.autonomy} (열 때 고정)`],
          ['모델', model ? `${model} (열 때 값)` : '알 수 없음'],
          ['소유자', s.owner],
        ]),
      );
      const limits = [`차례당 호출 ${s.max_steps}`, s.max_seconds !== undefined ? `시간 ${s.max_seconds}초(승인 대기 포함)` : null, s.token_budget !== undefined ? `토큰 ${formatCount(s.token_budget)}` : '토큰 무제한'].filter(
        (v): v is string => v !== null,
      );
      const u = s.usage;
      const pct = s.max_steps > 0 ? Math.min(100, Math.round((view.turnCalls / s.max_steps) * 100)) : 0;
      const bar = h('div', { class: 'bar', attrs: { role: 'progressbar', 'aria-label': '이번 차례 모델 호출', 'aria-valuemin': 0, 'aria-valuemax': s.max_steps, 'aria-valuenow': view.turnCalls } }, h('u'));
      (bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
      usage.replaceChildren(
        h('div', { class: 'turnrow' }, h('span', { class: 'dim' }, '이번 차례'), bar, h('span', { class: 'mono' }, `${view.turnCalls} / ${s.max_steps}`)),
        kv([
          ['입력', formatCount(u?.input_tokens ?? 0)],
          ['출력', formatCount(u?.output_tokens ?? 0)],
          ['캐시', formatCount(u?.cache_read_tokens ?? 0)],
        ]),
        h('p', { class: 'mono limits' }, limits.join(' · ')),
        h('div', { class: 'note' }, icon('info', 's'), h('span', {}, '비용은 통화로 환산하지 않고 토큰으로만 보입니다.')),
      );
      sent.replaceChildren(
        h('span', { class: 'cap' }, '노드 밖으로 나간 양'),
        h('div', { class: 'big' }, h('b', { class: 'mono' }, formatKB(view.sentBytes)), h('span', { class: 'mono dim' }, 'KB')),
        h('span', { class: 'note-s' }, '출력은 필터 없이 제공자로 갑니다'),
      );
    },
  };
}
