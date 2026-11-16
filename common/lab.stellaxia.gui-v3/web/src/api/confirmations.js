// 확인 대기 목록 — Master 가 붙잡아 둔 명령(commands.post · jobs.rerun 이 confirmation_required 로 답한 것)을 사람이 보고 승인 · 거절 (P13-4)
//
//   Master 에 '목록' operation 은 없다(by-confirmation-id.get · .approve.post · .reject.post 뿐). 그래서 이 화면은 *이 제어기가 만든*(또는 알림으로 받은)
//   확인 id 를 쥐고, 열 때마다 하나씩 읽어 상태를 새로 한다. 다른 곳에서 만든 확인은 id 를 붙여 넣어 추가한다(자기 것만 읽힌다 — Master 가 소유자를 가른다).
//   읽기 T0 · 거절 T1(곧장) · 승인 T3(승인 문 — approval-door 가 부른다). 만료 · 이미 끝난 것은 목록에서 상태만 바꾸고 지우지 않는다(사람이 지운다).

export const GET_OP = 'terra.master.confirmations.by-confirmation-id.get';
export const APPROVE_OP = 'terra.master.confirmations.by-confirmation-id.approve.post';
export const REJECT_OP = 'terra.master.confirmations.by-confirmation-id.reject.post';

const STATUS_TEXT = { pending: '대기 중', approved: '승인됨', rejected: '거절됨', expired: '만료', executed: '실행됨' };
export const statusText = (s) => STATUS_TEXT[s] || (s ? String(s) : '알 수 없음');

const EMPTY = { id: '', action: '', node: '', summary: '', reason: '', status: '', text: '', open: false, expiresAt: '', createdAt: '' };

/** Master 의 confirmationView → 행 */
export function rowOf(v, now = Date.now()) {
  const x = (v && v.data && typeof v.data === 'object' ? v.data : v) || {};
  const exp = Date.parse(x.expires_at || ''), status = String(x.status || '');
  const expired = status === 'pending' && Number.isFinite(exp) && exp <= now;
  const p = x.payload && typeof x.payload === 'object' ? x.payload : {};
  const cmd = p.command ? [p.command, ...(Array.isArray(p.args) ? p.args : [])].join(' ') : '';
  const st = expired ? 'expired' : status;
  return { id: String(x.confirmation_id || ''), action: String(x.action || ''), node: String(x.target_node_id || ''), summary: cmd || String(x.action || ''), reason: String(x.reason || ''), status: st, text: statusText(st), open: status === 'pending' && !expired, expiresAt: String(x.expires_at || ''), createdAt: String(x.created_at || '') };
}

/** @param {{ get: (id: string) => Promise<any>, approve: (id: string) => Promise<{ ok: boolean, code?: string, text?: string, message?: string, data?: any }>, reject: (id: string) => Promise<any> }} d */
export function createConfirmationBook(d) {
  const ids = [], rows = new Map(), subs = new Set();
  const emit = () => { for (const f of subs) { try { f(); } catch { /* 구독자 오류는 목록을 깨지 않는다 */ } } };
  const book = {
    ids: () => ids.slice(),
    list: () => ids.map((id) => rows.get(id) || { ...EMPTY, id, summary: id, text: '읽는 중…' }),
    pending: () => book.list().filter((r) => r.open),
    onChange(f) { subs.add(f); return () => subs.delete(f); },
    add(id) { id = String(id || '').trim(); if (!id || ids.includes(id)) return false; ids.unshift(id); emit(); return true; },
    remove(id) { const i = ids.indexOf(id); if (i < 0) return; ids.splice(i, 1); rows.delete(id); emit(); },
    async refresh(now = Date.now()) {
      await Promise.all(ids.map(async (id) => {
        try { rows.set(id, rowOf(await d.get(id), now)); }
        catch (e) { rows.set(id, { ...(rows.get(id) || { ...EMPTY, summary: id }), id, status: 'unreadable', text: '읽지 못함 : ' + ((e && e.code) || 'ERROR'), open: false }); }
      }));
      emit();
    },
    /** 거절 — T1 곧장. 사람이 눌렀으니 승인 문이 필요 없다 */
    async reject(id) {
      try { await d.reject(id); } catch (e) { return { ok: false, code: (e && e.code) || 'ERROR', message: (e && e.message) || '' }; }
      await book.refresh(); return { ok: true };
    },
    /** 승인 — T3 승인 문. 실패 문구는 approve 가 돌려준 text(§2.5) */
    async approve(id) {
      const r = await d.approve(id); await book.refresh();
      return r && r.ok ? { ok: true, data: r.data } : { ok: false, code: (r && r.code) || 'ERROR', message: (r && (r.text || r.message)) || '' };
    },
  };
  return book;
}
