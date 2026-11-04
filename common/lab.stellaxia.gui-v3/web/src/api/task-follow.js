// 작업 출력 따라가기 — 제어기(NodeDesktopEmbed) 작업 관리자의 로그 창.
//
//   이 노드   terra.daemon.tasks.by-task-id.output.events.get  SSE(local 전용 · process.execute). sse.js 로 읽는다
//             event: output {stream, at, text, masked?, lossy?} (id = seq) · gap {before_seq, bytes} · state {state, exit_code, error, timed_out} · end {last_seq}
//             · overflow {last_seq}(따라오지 못함 — 닫힌다 → last_event_id 로 다시 붙는다). task 당 4 · 노드 32 구독 넘으면 429 TOO_MANY_STREAMS → 폴링으로
//   다른 노드 terra.daemon.tasks.by-task-id.output.get  폴링(cluster) — { chunks: [{ seq, at, stream, text }], last_seq, complete, dropped: { bytes }, result? }
//             after_seq 로 이어 읽는다(같은 seq 공간 — 스트림의 id 와 같다)
// 로그는 순수 값(applyEvent · applyPoll — 시험)이고, followTask 가 길을 고르고 다시 붙는다.

export const MAX_LINES = 2000;   // 화면에 둘 줄 — 넘으면 앞을 버리고 그 수를 센다

export function emptyLog() { return { lines: [], last: 0, state: '', exit: null, error: '', timedOut: false, end: false, cut: 0, gaps: 0, overflow: 0 }; }

const push = (L, line) => { L.lines.push(line); if (L.lines.length > MAX_LINES) { L.cut += L.lines.length - MAX_LINES; L.lines.splice(0, L.lines.length - MAX_LINES); } };
const text = (t) => String(t ?? '').replace(/\r?\n$/, '');
const result = (L, r) => { if (!r) return; if (r.state) L.state = String(r.state); if (r.exit_code !== undefined && r.exit_code !== null) L.exit = Number(r.exit_code); if (r.error) L.error = String(r.error); if (r.timed_out) L.timedOut = true; };

/** SSE 이벤트 하나 → 로그(새 값). 다시 붙어 겹친 seq 는 버린다 */
export function applyEvent(L0, ev) {
  const L = Object.assign({}, L0, { lines: L0.lines.slice() }), d = (ev && ev.data) || {};
  switch (ev && ev.event) {
    case 'output': { const seq = Number(ev.id) || 0; if (seq && seq <= L.last) return L0; if (seq) L.last = seq; push(L, { k: 'out', seq, stream: d.stream === 'stderr' ? 'stderr' : 'stdout', at: d.at || '', text: text(d.text), masked: !!d.masked, lossy: !!d.lossy }); return L; }
    case 'gap': L.gaps++; push(L, { k: 'gap', text: '… 앞 ' + (Number(d.bytes) || 0) + '바이트는 보관 한도로 버려졌다' + (d.before_seq ? ' (#' + d.before_seq + ' 앞)' : '') }); return L;
    case 'state': result(L, d); return L;
    case 'end': L.end = true; if (d.last_seq && Number(d.last_seq) > L.last) L.last = Number(d.last_seq); return L;
    case 'overflow': L.overflow++; push(L, { k: 'note', text: '따라오지 못해 끊김 — 마지막 줄 뒤부터 다시 붙는다' }); return L;
    default: return L0;
  }
}

/** output.get 응답 → 로그(새 값). after_seq 뒤 조각만 더한다 */
export function applyPoll(L0, p) {
  const L = Object.assign({}, L0, { lines: L0.lines.slice() }), P = p || {};
  if (!L0.lines.length && P.dropped && Number(P.dropped.bytes)) { L.gaps++; push(L, { k: 'gap', text: '… 앞 ' + Number(P.dropped.bytes) + '바이트는 보관 한도로 버려졌다' }); }
  if (P.captured === false && !L0.lines.length) push(L, { k: 'note', text: '이 작업은 출력을 남기지 않는다(capture_output 꺼짐)' });
  for (const c of Array.isArray(P.chunks) ? P.chunks : []) { const seq = Number(c.seq) || 0; if (seq && seq <= L.last) continue; if (seq) L.last = seq; push(L, { k: 'out', seq, stream: c.stream === 'stderr' ? 'stderr' : 'stdout', at: c.at || '', text: text(c.text), masked: !!c.masked, lossy: !!c.lossy }); }
  if (Number(P.last_seq) > L.last && !P.more) L.last = Number(P.last_seq);
  result(L, P.result); if (P.state && !L.state) L.state = String(P.state);
  if (P.complete) L.end = true;
  return L;
}

/** 끝 상태 줄 — { text, tone: ok|err|warn|dim } */
export function endLine(L) {
  if (!L.end) return null;
  const st = String(L.state || '').toLowerCase(), code = L.exit === null || L.exit === undefined ? '' : ' · exit ' + L.exit;
  if (L.timedOut || st === 'timeout') return { text: '끝 · 시간 초과' + code, tone: 'warn' };
  if (/cancel/.test(st)) return { text: '끝 · 취소됨' + code, tone: 'dim' };
  if (/fail|error/.test(st) || (L.exit !== null && L.exit !== undefined && L.exit !== 0)) return { text: '끝 · 실패' + code + (L.error ? ' · ' + L.error : ''), tone: 'err' };
  return { text: '끝 · 성공' + (code || ''), tone: 'ok' };
}

/** 시각 → HH:MM:SS (없으면 '') */
export function hms(at) { const d = new Date(at || ''); if (Number.isNaN(d.getTime())) return ''; const p = (n) => String(n).padStart(2, '0'); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); }

/**
 * 따라가기 — 이 노드면 SSE, 안 되면(다른 노드 · 429 · 길 없음) 폴링.
 * @param {{ taskId: string, sse?: (op: string, input: object, h: object) => Promise<() => void>, poll: (input: object) => Promise<any>, onUpdate: (L: object, info: { mode: string, why: string }) => void, pollMs?: number, retryMs?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} o
 * @returns {{ stop(): void, mode(): string }}
 */
export function followTask(o) {
  const st = o.setTimer || setTimeout, ct = o.clearTimer || clearTimeout, pollMs = o.pollMs ?? 3000, retryMs = o.retryMs ?? 1000;
  let L = emptyLog(), stopped = false, close = null, timer = 0, mode = 'opening', why = '', tries = 0;
  const up = () => { if (!stopped) try { o.onUpdate(L, { mode, why }); } catch {} };
  const poll = () => {
    if (stopped) return; mode = 'poll';
    o.poll(L.last ? { task_id: o.taskId, after_seq: String(L.last) } : { task_id: o.taskId, tail: '400' }).then((p) => { L = applyPoll(L, p); up(); if (!L.end) timer = st(poll, pollMs); },
      (e) => { why = '출력을 못 받음 · ' + ((e && e.code) || '오류'); up(); if (!stopped && !L.end) timer = st(poll, pollMs * 2); });
  };
  const open = () => {
    if (stopped) return; mode = 'opening';
    o.sse('terra.daemon.tasks.by-task-id.output.events.get', L.last ? { task_id: o.taskId, last_event_id: String(L.last) } : { task_id: o.taskId }, {
      onEvent: (ev) => { tries = 0; mode = 'live'; L = applyEvent(L, ev); up(); },
      onClose: () => { close = null; if (stopped || L.end) return; if (++tries > 5) { why = '스트림이 자꾸 끊김 — 폴링으로'; return poll(); } mode = 'again'; up(); timer = st(open, retryMs * tries); },
    }).then((c) => { if (stopped) c(); else { close = c; mode = 'live'; up(); } },
      (e) => { why = (e && e.code) === 'TOO_MANY_STREAMS' ? '구독 한도(task 4 · 노드 32) — 폴링으로' : '스트림을 못 엶 · ' + ((e && e.code) || '오류') + ' — 폴링으로'; poll(); });
  };
  if (o.sse) open(); else { why = '다른 노드 — 스트림은 이 노드에서만(relay 는 스트림을 나르지 못한다) · ' + Math.round(pollMs / 1000) + '초마다 읽기'; poll(); }
  return { stop() { stopped = true; ct(timer); if (close) close(); close = null; }, mode: () => mode, log: () => L };
}
