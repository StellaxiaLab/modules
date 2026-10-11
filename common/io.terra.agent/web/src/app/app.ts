// 앱 본체 — 저장소(data/)와 화면 조각(views/)을 잇는다.
//   · 폴링: PollScheduler 가 tick 을 부른다(running 1초 · 대기/유휴 5초 · 숨김 15초). 보낸 직후·취소 직후 refreshNow().
//   · 준비 상태: status.get + models.list + credentials.get 을 composeReadiness 로 합성한다(권한 없음 포함).
//   · 보내기·취소는 반드시 store.send / store.cancel 을 지난다(보내기 가드, 종료 상태 가드).
//   · 화면은 상태가 바뀔 때마다 update 로 맞춘다 — DOM 을 다시 만들지 않으므로 초점·한글 조합·스크롤이 유지된다.
// 확장 지점(WP-5): `renderers`(승인 카드), `onAfterRender`.

import type { AgentClient } from '../api/client';
import { generateSessionId } from '../api/client';
import { composeReadiness, type Readiness } from '../data/readiness';
import { describeFailure } from '../data/errors';
import { createDataStore, type DataStore } from '../data/store';
import { sessionTab, type SessionTab } from '../data/status';
import { PollScheduler, bindVisibility, type PollMode, type PollSchedulerOptions } from '../transport';
import { h, icon, setText } from './dom';
import { presentReadiness } from './readiness-model';
import { parseHash, routeHash, type Route } from './router';
import { buildInbox, buildRows, sessionTitle, tabCounts } from './session-rows';
import { createCancelDialog } from '../views/cancel-dialog';
import type { ComposerNotice } from '../views/composer';
import type { EntryRenderers } from '../views/entries';
import { defaultEntryRenderers } from '../views/entries';
import { createNewSession } from '../views/new-session';
import { createReadinessGuide } from '../views/readiness';
import { createSessionInfo } from '../views/session-info';
import { createSessionPane } from '../views/session-pane';
import { createSidebar } from '../views/sidebar';

export interface AppWindow {
  location: { hash: string };
  addEventListener(type: 'hashchange', listener: () => void): void;
  removeEventListener(type: 'hashchange', listener: () => void): void;
}

export interface AppDeps {
  root: HTMLElement;
  win: AppWindow;
  doc: Document;
  client: AgentClient;
  now?: () => number;
  random?: () => number;
  /** 폴링 시험용 — 타이머·간격 주입. */
  poll?: Pick<PollSchedulerOptions, 'timers' | 'intervals' | 'backoff' | 'now'>;
  /** 준비 상태를 다시 읽는 간격. 준비가 안 됐으면 절반. */
  readinessEveryMs?: number;
  /** 세션 목록을 다시 읽는 최소 간격(세션을 열어 둔 동안). */
  listEveryMs?: number;
  renderers?: EntryRenderers;
}

export interface App {
  readonly store: DataStore;
  readonly scheduler: PollScheduler;
  readonly root: HTMLElement;
  start(): void;
  stop(): void;
  /** 폴링 한 번을 직접 돈다(시험). */
  refreshOnce(): Promise<{ ok: boolean }>;
  /** 준비 상태만 다시 읽는다. */
  refreshReadiness(): Promise<Readiness>;
  navigate(route: Route): void;
  /** 대기 중인 화면 갱신을 끝낸다(시험). */
  flush(): Promise<void>;
  /** 지금의 화면 상태(시험·진단). 비밀은 없다. */
  ui(): Readonly<{ route: Route; tab: SessionTab; readiness: Readiness | null }>;
}

interface CancelState {
  open: boolean;
  busy: boolean;
  error: string | null;
}

export function createApp(deps: AppDeps): App {
  const { root, win, doc, client } = deps;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? (() => Math.random());
  const readinessEveryMs = deps.readinessEveryMs ?? 20_000;
  const listEveryMs = deps.listEveryMs ?? 5_000;
  const renderers = deps.renderers ?? defaultEntryRenderers;
  const store = createDataStore({ client, now });

  // ── 화면 상태 ──
  let route: Route = parseHash(win.location.hash);
  let tab: SessionTab = 'mine';
  let followRouteTab = route.name === 'session';
  let readiness: Readiness | null = null;
  let readinessAt = 0;
  let checking = false;
  let listAt = 0;
  let listLoaded = false;
  const drafts = new Map<string, string>();
  const resetKeys = new Map<string, number>();
  const sending = new Set<string>();
  const notices = new Map<string, ComposerNotice>();
  const loadProblems = new Map<string, string>();
  let cancel: CancelState = { open: false, busy: false, error: null };
  let newForm: { sessionId: string | null; creating: boolean; error: string | null } = { sessionId: null, creating: false, error: null };
  let started = false;
  let renderQueued = false;
  let pendingFlush: Promise<void> = Promise.resolve();

  // ── DOM 골격 ──
  const appEl = h('div', { class: 'app', attrs: { 'data-role': 'app' } });
  const markEl = h('span', { class: 'mark' }, icon('spark'));
  const versionChip = h('span', { class: 'chip mut mono', attrs: { hidden: true } });
  const pendingChip = h('span', { class: 'chip warn', attrs: { hidden: true, 'data-role': 'pending-chip' } });
  const headerEl = h(
    'header',
    { class: 'wh' },
    markEl,
    h('h1', { class: 'cap brand' }, 'TERRA AGENT'),
    versionChip,
    pendingChip,
  );

  const sidebar = createSidebar({ onTab: (t) => setTab(t) });
  const guide = createReadinessGuide({ onRecheck: () => void recheck() });
  const newPane = createNewSession({ onSubmit: (input) => void openSession(input.topic), onClose: () => navigate({ name: 'home' }) });
  const sessionPane = createSessionPane(
    {
      onSubmit: (text) => void send(text),
      onDraft: (id, text) => void drafts.set(id, text),
      onCancelClick: () => {
        cancel = { open: true, busy: false, error: null };
        render();
      },
    },
    renderers,
  );
  const info = createSessionInfo();
  const dialog = createCancelDialog(
    {
      onKeep: () => {
        if (cancel.busy) return;
        cancel = { open: false, busy: false, error: null };
        render();
      },
      onConfirm: () => void confirmCancel(),
    },
    appEl,
  );

  const main = h('main', { class: 'main', attrs: { id: 'main' } }, guide.el, newPane.el, sessionPane.el);
  appEl.append(headerEl, h('div', { class: 'wb' }, sidebar.el, main, info.el));
  root.replaceChildren(appEl, dialog.el);

  // ── 라우팅 ──
  function setRoute(next: Route): void {
    const same = JSON.stringify(next) === JSON.stringify(route);
    route = next;
    if (next.name === 'session') followRouteTab = true;
    if (next.name !== 'new') newForm = { sessionId: null, creating: false, error: null };
    if (next.name === 'new' && newForm.sessionId === null) newForm.sessionId = generateSessionId(now(), random);
    if (cancel.open && !same) cancel = { open: false, busy: false, error: null };
    if (!same) scheduler.refreshNow();
  }
  function navigate(next: Route): void {
    setRoute(next);
    const hash = routeHash(next);
    if (win.location.hash !== hash) win.location.hash = hash;
    render();
  }
  const onHash = (): void => {
    setRoute(parseHash(win.location.hash));
    render();
  };
  if (route.name === 'new') newForm.sessionId = generateSessionId(now(), random);

  function setTab(next: SessionTab): void {
    tab = next;
    followRouteTab = false;
    render();
  }

  // ── 준비 상태 ──
  async function refreshReadiness(): Promise<Readiness> {
    checking = true;
    try {
      const status = await client.statusGet();
      let models, credentials;
      if (status.ok) [models, credentials] = await Promise.all([client.modelsList(), client.credentialsGet()]);
      readiness = composeReadiness({ status, ...(models ? { models } : {}), ...(credentials ? { credentials } : {}) });
      readinessAt = now();
      // 소유자 필터의 기준 — 자격이 알려 준 principal. 모르면 아무 세션도 보이지 않는다(owner.ts).
      store.setViewer(readiness.viewer);
      return readiness;
    } finally {
      checking = false;
    }
  }
  async function recheck(): Promise<void> {
    await refreshReadiness();
    scheduler.refreshNow();
    render();
  }

  // ── 폴링 ──
  function modeFor(): PollMode {
    if (route.name === 'session') {
      const view = store.viewOf(route.id);
      const state = view?.snapshot.state;
      if (state === 'running') return 'running';
      if (state === 'waiting-approval') return 'waiting-approval';
    }
    return 'idle';
  }

  async function tick(): Promise<{ ok: boolean }> {
    let ok = true;
    try {
      const t = now();
      const stale = readiness === null || t - readinessAt >= (readiness.ready ? readinessEveryMs : readinessEveryMs / 2);
      if (stale) await refreshReadiness();
      if (store.getState().viewer !== null) {
        const wantList = route.name !== 'session' || !listLoaded || t - listAt >= listEveryMs;
        if (wantList) {
          const list = await store.refreshList();
          listAt = now();
          listLoaded = true;
          if (!list.ok) ok = false;
        }
        if (route.name === 'session') {
          const id = route.id;
          const r = await store.refreshSession(id);
          if (r.ok) loadProblems.delete(id);
          else {
            ok = false;
            if (store.viewOf(id) === null) loadProblems.set(id, describeFailure(r.failure).message);
          }
        }
      }
    } catch {
      ok = false;
    }
    scheduler.setMode(modeFor());
    render();
    return { ok };
  }

  const scheduler = new PollScheduler({
    tick,
    mode: 'idle',
    hidden: doc.hidden === true,
    ...deps.poll,
  });
  let unbindVisibility: (() => void) | null = null;

  // ── 동작 ──
  async function send(text: string): Promise<void> {
    if (route.name !== 'session') return;
    const id = route.id;
    if (sending.has(id)) return; // 연타해도 한 번
    sending.add(id);
    notices.delete(id);
    render();
    try {
      const result = await store.send(id, text);
      if (result.sent) {
        drafts.set(id, '');
        resetKeys.set(id, (resetKeys.get(id) ?? 0) + 1);
        scheduler.refreshNow();
      } else if (result.reason === 'verify-failed' || result.reason === 'post-failed') {
        const info = describeFailure(result.failure);
        if (result.failure.outcomeUnknown) {
          // 재시도 never(I17): 자동으로 다시 보내지 않는다. 기록을 읽어 확인하게 하고 사람이 다시 누르게 한다.
          notices.set(id, {
            tone: 'warn',
            text: `${info.message} 기록을 새로 읽는 중입니다 — 보낸 글이 기록에 보이지 않을 때만 다시 보내 주세요.`,
          });
          void store.refreshSession(id).then(() => render());
        } else {
          notices.set(id, { tone: info.severity === 'error' ? 'err' : 'warn', text: info.message });
          scheduler.refreshNow();
        }
      } else {
        notices.set(id, { tone: 'warn', text: result.message });
        scheduler.refreshNow();
      }
    } finally {
      sending.delete(id);
      render();
    }
  }

  async function confirmCancel(): Promise<void> {
    if (route.name !== 'session' || cancel.busy) return;
    const id = route.id;
    cancel = { open: true, busy: true, error: null };
    render();
    const result = await store.cancel(id);
    if (result.ok || (!result.ok && result.reason === 'terminal')) {
      cancel = { open: false, busy: false, error: null };
      scheduler.refreshNow();
    } else if (result.reason === 'failed' && result.failure) {
      cancel = { open: true, busy: false, error: describeFailure(result.failure).message };
    } else {
      cancel = { open: true, busy: false, error: '이 세션을 취소할 수 없습니다.' };
    }
    render();
  }

  async function openSession(topic: string): Promise<void> {
    if (route.name !== 'new' || newForm.creating) return;
    if (!(readiness?.ready ?? false)) return;
    const sessionId = newForm.sessionId ?? generateSessionId(now(), random);
    newForm = { sessionId, creating: true, error: null };
    render();
    // 멱등 id: 응답을 못 받아 다시 눌러도 같은 id 로 간다 — 모듈이 created:false 로 답한다.
    const result = await client.sessionsOpen({ session_id: sessionId, autonomy: 'plan', ...(topic !== '' ? { topic } : {}) });
    if (result.ok) {
      if (store.getState().viewer === null) store.setViewer(result.data.viewer);
      newForm = { sessionId: null, creating: false, error: null };
      listLoaded = false;
      navigate({ name: 'session', id: result.data.session_id });
    } else {
      newForm = { sessionId, creating: false, error: describeFailure(result.outcomeUnknown ? { ...result } : result).message };
      render();
    }
  }

  // ── 그리기 ──
  function composerNotice(id: string): ComposerNotice | null {
    return notices.get(id) ?? null;
  }

  function render(): void {
    const data = store.getState();
    const t = now();
    const p = presentReadiness(readiness);
    const selectedId = route.name === 'session' ? route.id : null;

    if (followRouteTab && selectedId) {
      const snapshot = data.owned.find((s) => s.session_id === selectedId);
      if (snapshot) {
        tab = sessionTab(snapshot.state);
        followRouteTab = false;
      }
    }

    const inboxAll = store.inbox();
    setText(pendingChip, `승인 대기 ${inboxAll.length}`);
    pendingChip.replaceChildren(icon('clock', 's'), `승인 대기 ${inboxAll.length}`);
    pendingChip.hidden = inboxAll.length === 0;
    versionChip.hidden = !p.version;
    if (p.version) setText(versionChip, `io.terra.agent ${p.version}`);

    sidebar.update({
      readiness: p,
      inbox: buildInbox(inboxAll, selectedId, t),
      tab,
      rows: buildRows(data, tab, selectedId, t),
      counts: tabCounts(data),
      canOpenNew: p.canOpenSession,
      newingActive: route.name === 'new',
      listProblem: data.listFailure ? describeFailure(data.listFailure).message : null,
      loading: readiness === null || (data.viewer !== null && !listLoaded),
    });

    guide.el.hidden = route.name !== 'home';
    newPane.el.hidden = route.name !== 'new';
    sessionPane.el.hidden = route.name !== 'session';
    info.el.hidden = route.name !== 'session';

    if (route.name === 'home') {
      guide.update({ presentation: p, hasSessions: data.owned.length > 0, checking });
    } else if (route.name === 'new') {
      newPane.update({
        sessionId: newForm.sessionId ?? '',
        creating: newForm.creating,
        canOpen: p.canOpenSession,
        blockedReason: p.canOpenSession ? null : readiness === null ? '준비 상태를 확인하는 중입니다.' : `새 세션을 열 수 없습니다 — ${p.headline}`,
        error: newForm.error,
      });
    } else {
      const id = route.id;
      const view = store.viewOf(id, t);
      const screen = view?.screen ?? null;
      const noViewer = store.getState().viewer === null && readiness !== null;
      const problem = view ? null : (loadProblems.get(id) ?? (noViewer ? '위임 자격이 없어 이 세션을 읽을 수 없습니다. 홈의 준비 상태를 확인해 주세요.' : null));
      const locked = !screen || !screen.inputEnabled;
      const terminal = screen?.activity === 'ended';
      sessionPane.update({
        sessionId: id,
        title: view ? sessionTitle(view.snapshot.topic, id) : id,
        viewer: data.viewer,
        view,
        loadProblem: problem,
        composer: {
          sessionId: id,
          draft: drafts.get(id) ?? '',
          resetKey: resetKeys.get(id) ?? 0,
          locked,
          placeholder: screen ? (screen.inputEnabled ? '이어서 물어보세요' : (screen.inputHint ?? '')) : '세션을 읽는 중입니다',
          lockReason: screen && !screen.inputEnabled ? (screen.inputHint ?? null) : null,
          sending: sending.has(id),
          footNote: terminal
            ? '새 세션을 열어 이어가세요.'
            : view?.snapshot.autonomy === 'plan'
              ? 'plan 세션은 제안만 합니다. 호출은 실행되지 않습니다.'
              : '버튼은 대기 승인이 있을 때만 켜집니다.',
          notice: composerNotice(id),
        },
      });
      info.update({ view });
    }

    const cancelTitle = route.name === 'session' ? (store.viewOf(route.id) ? sessionTitle(store.viewOf(route.id)?.snapshot.topic, route.id) : route.id) : '';
    dialog.update({ open: cancel.open && route.name === 'session', title: cancelTitle, busy: cancel.busy, error: cancel.error });
    deps.root.dataset['route'] = route.name;
  }

  // 저장소가 바뀌면 같은 마이크로태스크 안의 변경을 모아 한 번 그린다.
  const unsubscribe = store.subscribe(() => {
    if (renderQueued) return;
    renderQueued = true;
    pendingFlush = Promise.resolve().then(() => {
      renderQueued = false;
      render();
    });
  });

  render();

  return {
    store,
    scheduler,
    root,
    start() {
      if (started) return;
      started = true;
      win.addEventListener('hashchange', onHash);
      unbindVisibility = bindVisibility(scheduler, doc);
      scheduler.start();
    },
    stop() {
      if (!started) return;
      started = false;
      scheduler.stop();
      win.removeEventListener('hashchange', onHash);
      unbindVisibility?.();
      unsubscribe();
    },
    refreshOnce: tick,
    refreshReadiness: async () => {
      const r = await refreshReadiness();
      render();
      return r;
    },
    navigate,
    flush: async () => {
      await pendingFlush;
      await Promise.resolve();
    },
    ui: () => ({ route, tab, readiness }),
  };
}
