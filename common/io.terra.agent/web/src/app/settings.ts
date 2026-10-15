// 설정 화면의 상태 — 세 목록(모델·자격·MCP)을 읽고, 자격 거두기 3단계(DC-20)를 진행한다. DOM 을 모른다.
//
// 거두기의 순서는 요구 §8.6 이다: 세션 취소 → Gateway 폐기 → `credentials.delete`.
//   · 1 세션 취소 — 앱이 한다(store.cancel 을 지난다: 종료 상태는 건드리지 않는다).
//   · 2 Gateway 폐기 — 사람 세션만 한다(I3). 앱은 못 하고, 했는지도 알지 못한다(R-10). 앱은 명령을 보이고 사람이 "마쳤습니다"를 확인하게 한다.
//   · 3 자격 삭제 — 앱이 한다. 1·2 가 끝나기 전에는 잠겨 있고, 한 번만 보낸다. 응답을 잃으면 다시 보내지 않고 자격을 읽어 확인한다.
// 삭제한 뒤에도 폐기 명령을 결과에 남긴다 — 삭제하면 앱은 대리인 id 를 다시 읽을 수 없다.

import type { AgentClient, CallFailure } from '../api/client';
import { describeFailure } from '../data/errors';
import { credentialView, mcpView, modelsView, openSessions, revokeCommand, type CredentialView, type McpRow, type ModelsView } from '../data/settings';
import type { DataStore } from '../data/store';

export interface Note {
  message: string;
  /** 서버 원문(영어). 화면은 접어서 둔다. */
  raw: string;
}

export type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; note: Note };

export interface SettingsData {
  models: Load<ModelsView>;
  credential: Load<CredentialView>;
  mcp: Load<McpRow[]>;
}

export type RevokePhase = 'steps' | 'deleting' | 'verifying' | 'done';
export type RevokeResult = 'deleted' | 'already-gone' | 'confirmed-after-lost';

export interface RevokeState {
  open: boolean;
  phase: RevokePhase;
  /** 열 때 붙잡아 둔다 — 삭제한 뒤에도 결과 화면이 명령을 보이려면 필요하다. */
  command: string | null;
  /** 서버가 대리인 id 를 줬지만 알아볼 수 없어 명령을 만들지 못했다. */
  commandUnreadable: boolean;
  cancelling: boolean;
  cancelError: Note | null;
  /** 사람이 "Gateway 폐기를 마쳤습니다"를 확인했는가. */
  confirmed: boolean;
  error: Note | null;
  result: RevokeResult | null;
  copyNote: string | null;
  /** 복사에 실패할 때마다 늘어난다 — 화면이 명령을 선택해 둔다. */
  selectCommand: number;
}

export interface SettingsDeps {
  client: Pick<AgentClient, 'modelsList' | 'credentialsGet' | 'mcpList' | 'credentialsDelete'>;
  store: Pick<DataStore, 'getState' | 'refreshList' | 'refreshSession' | 'cancel'>;
  /** 상태가 바뀌었다 — 화면을 다시 맞춘다. */
  onChange(): void;
  /** 자격을 삭제했다 — 준비 상태를 다시 읽는다(viewer 가 사라지고 새 세션이 막힌다). */
  afterDelete(): Promise<void>;
  /** 세션을 취소했다 — 폴링을 재촉한다. */
  afterCancel(): void;
  /** 클립보드. sandbox iframe 에서는 막힐 수 있다. 호출 시점에 읽는다. */
  clipboard(): { writeText(text: string): Promise<void> } | null;
}

const noteOf = (failure: Pick<CallFailure, 'status' | 'code' | 'message' | 'outcomeUnknown'>, context?: Parameters<typeof describeFailure>[1]): Note => {
  const info = describeFailure(failure, context);
  return { message: info.message, raw: info.raw };
};

export const COPY_OK = '폐기 명령을 복사했습니다. 터미널에서 사람 세션으로 실행하세요.';
export const COPY_FAILED = '복사하지 못했습니다 — 이 환경에서는 클립보드가 막혀 있을 수 있습니다. 명령을 선택해 두었으니 직접 복사(Ctrl+C)해 주세요.';

export function createSettings(deps: SettingsDeps) {
  const { client, store } = deps;
  let data: SettingsData = { models: { status: 'loading' }, credential: { status: 'loading' }, mcp: { status: 'loading' } };
  let revoke: RevokeState = freshRevoke();
  const seq = { models: 0, credential: 0, mcp: 0 };
  let inflight: Promise<void> = Promise.resolve();

  function freshRevoke(): RevokeState {
    return { open: false, phase: 'steps', command: null, commandUnreadable: false, cancelling: false, cancelError: null, confirmed: false, error: null, result: null, copyNote: null, selectCommand: 0 };
  }
  const set = (patch: Partial<RevokeState>): void => {
    revoke = { ...revoke, ...patch };
    deps.onChange();
  };
  const openCount = (): number => openSessions(store.getState().owned).length;

  // ── 읽기 ──
  // 이미 읽은 것은 다시 읽는 동안에도 지우지 않는다 — 단추의 초점과 화면이 깜빡이지 않게. 늦게 온 옛 응답은 버린다.
  async function loadModels(): Promise<void> {
    const mine = ++seq.models;
    if (data.models.status === 'failed') data = { ...data, models: { status: 'loading' } };
    const r = await client.modelsList();
    if (mine !== seq.models) return;
    data = { ...data, models: r.ok ? { status: 'ready', data: modelsView(r.data) } : { status: 'failed', note: noteOf(r) } };
    deps.onChange();
  }
  async function loadCredential(): Promise<void> {
    const mine = ++seq.credential;
    if (data.credential.status === 'failed') data = { ...data, credential: { status: 'loading' } };
    const r = await client.credentialsGet();
    if (mine !== seq.credential) return;
    data = { ...data, credential: r.ok ? { status: 'ready', data: credentialView(r.data) } : { status: 'failed', note: noteOf(r) } };
    deps.onChange();
  }
  async function loadMcp(): Promise<void> {
    const mine = ++seq.mcp;
    if (data.mcp.status === 'failed') data = { ...data, mcp: { status: 'loading' } };
    const r = await client.mcpList();
    if (mine !== seq.mcp) return;
    data = { ...data, mcp: r.ok ? { status: 'ready', data: mcpView(r.data) } : { status: 'failed', note: noteOf(r) } };
    deps.onChange();
  }
  function load(): Promise<void> {
    deps.onChange();
    inflight = Promise.all([loadModels(), loadCredential(), loadMcp()]).then(() => undefined);
    return inflight;
  }

  // ── 거두기 ──
  function open(): void {
    if (revoke.open) return;
    const cred = data.credential.status === 'ready' ? data.credential.data : null;
    revoke = { ...freshRevoke(), open: true, command: revokeCommand(cred?.delegateId ?? null), commandUnreadable: cred !== null && cred.delegateId === null };
    deps.onChange();
  }
  function close(): void {
    // 처리 중에는 닫지 않는다 — 요청이 나간 뒤 화면만 닫히면 결과를 놓친다.
    if (!revoke.open || revoke.cancelling || revoke.phase === 'deleting' || revoke.phase === 'verifying') return;
    revoke = freshRevoke();
    deps.onChange();
  }

  /** 1 단계 — 열린 세션을 모두 취소한다. 종료된 세션은 건드리지 않는다(store.cancel 의 가드). */
  async function cancelOpenSessions(): Promise<void> {
    if (!revoke.open || revoke.cancelling || revoke.phase !== 'steps') return;
    set({ cancelling: true, cancelError: null });
    let failure: CallFailure | null = null;
    for (const session of openSessions(store.getState().owned)) {
      const id = session.session_id;
      if (store.getState().sessions[id] === undefined) {
        const read = await store.refreshSession(id);
        if (store.getState().sessions[id] === undefined) {
          if (!read.ok) failure ??= read.failure;
          continue;
        }
      }
      const result = await store.cancel(id);
      if (!result.ok && result.reason === 'failed' && result.failure) failure ??= result.failure;
      else if (!result.ok && result.reason === 'unknown-session') failure ??= { ok: false, status: 0, message: 'session unknown' };
    }
    await store.refreshList();
    deps.afterCancel();
    set({ cancelling: false, cancelError: failure ? noteOf(failure) : null });
  }

  function setConfirmed(confirmed: boolean): void {
    if (!revoke.open || revoke.phase !== 'steps') return;
    set({ confirmed });
  }

  /** 2 단계 — 명령을 복사한다. 앱은 폐기하지 않는다. */
  async function copyCommand(): Promise<void> {
    const text = revoke.command;
    if (!revoke.open || text === null) return;
    try {
      const clip = deps.clipboard();
      if (clip === null) throw new Error('no clipboard');
      await clip.writeText(text);
      set({ copyNote: COPY_OK });
    } catch {
      set({ copyNote: COPY_FAILED, selectCommand: revoke.selectCommand + 1 });
    }
  }

  /** 삭제가 막힌 이유. 풀려 있으면 null. */
  function blockedReason(): string | null {
    if (revoke.phase !== 'steps') return '처리 중입니다.';
    if (revoke.cancelling) return '세션을 취소하는 중입니다.';
    const n = openCount();
    if (n > 0) return `열린 세션이 ${n}개 남아 있습니다 — 먼저 취소하세요.`;
    if (!revoke.confirmed) return '사람이 Gateway 폐기를 마치고 “폐기를 마쳤습니다”를 확인해야 삭제할 수 있습니다.';
    return null;
  }

  /** 3 단계 — 맡긴 자격을 지운다. 한 번만 보낸다(응답을 잃어도 자동으로 다시 보내지 않는다). */
  async function deleteCredential(): Promise<void> {
    if (!revoke.open || revoke.phase !== 'steps') return;
    if (blockedReason() !== null) return;
    set({ phase: 'deleting', error: null });
    // 마지막 확인 — 목록은 몇 초 묵었을 수 있다. 그사이 열린 세션이 생겼으면 삭제하지 않는다.
    await store.refreshList();
    const open = openCount();
    if (open > 0) {
      set({ phase: 'steps', error: { message: `열린 세션이 ${open}개 생겼습니다 — 먼저 취소해 주세요. 삭제하지 않았습니다.`, raw: '' } });
      return;
    }
    const response = await client.credentialsDelete();
    if (response.ok) return finish(response.data.removed === true ? 'deleted' : 'already-gone');
    if (response.outcomeUnknown === true) {
      // 요청이 갔는지 모른다 — 다시 보내지 않고 자격을 읽어 확인한다(I17의 정신).
      set({ phase: 'verifying' });
      const check = await client.credentialsGet();
      if (check.ok && check.data.registered !== true) return finish('confirmed-after-lost');
      set({
        phase: 'steps',
        error: {
          message: check.ok
            ? '삭제 요청의 응답을 받지 못했습니다. 확인해 보니 자격이 아직 남아 있습니다 — 삭제되지 않았습니다. 자동으로 다시 보내지 않았습니다. 다시 삭제하려면 단추를 한 번 더 눌러 주세요.'
            : '삭제 요청의 응답을 받지 못했고 삭제됐는지 확인하지 못했습니다. 자동으로 다시 보내지 않았습니다. 설정을 다시 읽어 자격 상태를 확인한 뒤에 결정해 주세요.',
          raw: response.message,
        },
      });
      return;
    }
    set({ phase: 'steps', error: noteOf(response) });
  }

  async function finish(result: RevokeResult): Promise<void> {
    set({ phase: 'done', result, error: null });
    await deps.afterDelete();
    await loadCredential();
  }

  return {
    data: (): SettingsData => data,
    revoke: (): RevokeState => revoke,
    load,
    loadModels,
    loadCredential,
    loadMcp,
    /** 읽기가 끝나기를 기다린다(시험). */
    inflight: (): Promise<void> => inflight,
    open,
    close,
    cancelOpenSessions,
    setConfirmed,
    copyCommand,
    deleteCredential,
    blockedReason,
    openCount,
  };
}

export type Settings = ReturnType<typeof createSettings>;
