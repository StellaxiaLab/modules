// 명령 작업의 출력 (Terra PF-7) — Daemon 이 작업마다 보관한 stdout · stderr 를 출력 칸에 보인다.
//   읽기  terra.daemon.tasks.by-task-id.output.get {task_id, after_seq, max_bytes}  — scopes local · cluster(다른 노드는 노드 주소 호출) · process.execute
//         답: { task_id, state, captured, chunks[{seq, at, stream, text, masked?, lossy?}], first_seq, last_seq, complete, truncated, dropped{before_seq, bytes}, bytes, more, result? }
//   따라가기 terra.daemon.tasks.by-task-id.output.events.get {task_id, last_event_id} — SSE · scopes local(이 노드만)
//         `id: <seq>` `event: output` {stream, at, text} · `event: gap` {before_seq, bytes} · `event: state` {state, exit_code, error, timed_out}
//         · `event: end` {last_seq} · `event: overflow` {last_seq}(뒤처졌다 — 끊긴다, last_event_id 로 이어 받는다) · 15초 `: keep-alive`
//   조각은 한 줄(줄바꿈 포함 · 최대 4096바이트)이다. 비밀처럼 보이는 값은 Daemon 이 이미 가렸다(masked)
//   Terra docs/modules/terra-gui/design/terra-node-task-output-design.md

import { openEvents } from './events.js';

export const OUTPUT_OP = 'terra.daemon.tasks.by-task-id.output.get';
export const OUTPUT_EVENTS_OP = 'terra.daemon.tasks.by-task-id.output.events.get';
/** 한 번에 읽는 양 — Daemon 의 한 쪽 최대(TaskOutputMaxPage)와 같다. 작업마다 보관하는 꼬리(256 KiB)를 한 번에 받는다 */
export const OUTPUT_PAGE = 256 * 1024;
/** 출력 칸에 두는 글의 끝 — 따라가는 동안 이보다 길어지면 앞을 버린다 */
export const VIEW_CHARS = 512 * 1024;

const RESULT_TEXT = { succeeded: '완료', success: '완료', completed: '완료', failed: '실패', canceled: '취소됨', cancelled: '취소됨', timed_out: '시간 초과' };

/** 작업 하나의 출력 — 읽은 쪽(page) · 따라온 조각(chunk)을 모아 출력 칸의 글로 만든다. 화면은 text()만 읽는다 */
export class OutputView {
  constructor() {
    this.lines = []; this.chars = 0; this.cut = 0;
    this.lastSeq = 0; this.captured = true; this.lost = 0; this.result = null; this.state = ''; this.ended = false; this.more = false; this.note = '';
    this.streams = new Set();
  }

  /** output.get 의 답 */
  page(p) {
    const d = p || {};
    this.captured = d.captured !== false;
    this.state = d.state || this.state;
    if (d.dropped && d.dropped.bytes) this.lost += d.dropped.bytes;
    (Array.isArray(d.chunks) ? d.chunks : []).forEach((c) => this.chunk(c));
    if (d.last_seq > this.lastSeq) this.lastSeq = d.last_seq;
    this.more = !!d.more;
    if (d.result) this.result = d.result;
    if (d.complete) this.ended = true;
    return this;
  }

  /** 조각 하나 — 받은 순번보다 앞이면 버린다(다시 붙을 때 겹친 것) */
  chunk(c) {
    if (!c || (c.seq && c.seq <= this.lastSeq)) return false;
    if (c.seq) this.lastSeq = c.seq;
    const text = String(c.text == null ? '' : c.text);
    this.streams.add(c.stream || 'stdout');
    this.lines.push({ stream: c.stream || 'stdout', text });
    this.chars += text.length;
    while (this.chars > VIEW_CHARS && this.lines.length > 1) { const x = this.lines.shift(); this.chars -= x.text.length; this.cut += x.text.length; }
    return true;
  }

  /** SSE gap — 따라가기 전에 보관 한도로 버린 바이트 */
  gap(g) { if (g && g.bytes) this.lost += g.bytes; }

  /** SSE state · end — 작업이 끝났다 */
  finish(result) { if (result) this.result = result; this.ended = true; }

  text() {
    const mixed = this.streams.size > 1, out = [];
    if (!this.captured) return '(이 작업은 출력을 받지 않게 실행했다 — capture_output false)' + this.tail();
    if (this.lost) out.push('— 앞부분 ' + this.lost + ' 바이트는 노드의 보관 한도로 버렸다');
    if (this.cut) out.push('— 앞부분 ' + this.cut + ' 글자는 이 화면에서 덜어 냈다');
    const body = this.lines.map((l) => (mixed && l.stream === 'stderr' ? '! ' : '') + l.text).join('').replace(/\n$/, '');
    out.push(body || (this.ended ? '(출력 없음)' : '(아직 출력 없음)'));
    if (this.more) out.push('— 더 있다(한 번에 ' + OUTPUT_PAGE / 1024 + ' KiB까지 읽는다)');
    return out.join('\n') + this.tail();
  }

  tail() {
    const r = this.result;
    if (!r) return this.ended ? '' : '\n— 실행 중';
    const st = RESULT_TEXT[r.state] || r.state || '';
    return '\n— ' + [st, r.exit_code != null ? 'exit ' + r.exit_code : '', r.timed_out ? '시간 초과' : '', r.error || ''].filter(Boolean).join(' · ');
  }
}

/**
 * 출력 따라가기 — 이 노드의 SSE. 끝(end)을 받으면 스스로 닫는다. 끊기면 받은 순번부터 이어 받는다(openEvents).
 * @param {{ base: string, fetch: typeof fetch }} client
 * @param {string} taskId
 * @param {OutputView} view  읽기(page)로 채운 것 — 그 뒤 순번부터 받는다
 * @param {(view: OutputView) => void} onChange
 * @param {{ sleep?: (ms: number) => Promise<void>, onState?: (s: string, info?: any) => void }} [opts]
 * @returns {() => void} 끄기
 */
export function followOutput(client, taskId, view, onChange, opts = {}) {
  let off = null, done = false;
  const stop = () => { done = true; if (off) off(); };
  off = openEvents(client, (e) => {
    if (done) return;
    const d = e.data || {};
    if (e.signal === 'output') view.chunk(Object.assign({}, d, { seq: Number(e.id) || 0 }));
    else if (e.signal === 'gap') view.gap(d);
    else if (e.signal === 'state') view.finish(d);
    else if (e.signal === 'end') { view.finish(null); onChange(view); stop(); return; }
    else return;   // overflow — openEvents 가 받은 순번부터 다시 붙는다
    onChange(view);
  }, { op: OUTPUT_EVENTS_OP, input: { task_id: taskId }, raw: true, last: view.lastSeq ? String(view.lastSeq) : null, sleep: opts.sleep,
    onState: (s, info) => { if (s === 'off') { view.note = '따라가기 끊김'; done = true; } if (opts.onState) opts.onState(s, info); } });
  return stop;
}
