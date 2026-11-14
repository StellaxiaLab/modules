// 화면 — 파일 탐색 · 전송 관리 · 올리기(충돌) · 폴더 동기화 · 상태와 오류. 설계는 Claude Design 캔버스 5장.
// 상태는 한 객체이고, 큰 영역 셋(본문 · 전송 트레이 · 대화상자)을 따로 다시 그린다 — 진행률이 올라갈 때 대화상자의
// 입력 칸이 포커스를 잃지 않게 하려는 것이다. 순수 규칙은 lib/ 에 있고 거기서 시험한다.
import { createApi } from './lib/api.js';
import { createFileTransfer, fmtBytes, fmtRate } from './lib/file-transfer.js';
import {
  capabilities, LOCK_WHY, cleanPath, joinPath, parentPath, baseName, crumbs, outsideRoot, sortEntries,
  rootsState, describeError, transferRow, suggestName,
} from './lib/model.js';
import { planSync, planSummary, planTotal } from './lib/sync-plan.js';

/** 작은 DOM 도우미 — 문자열은 textContent 로만 들어가므로 노드가 준 이름이 마크업이 될 수 없다 */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'disabled' || k === 'checked' || k === 'multiple') e[k] = !!v;
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (x) => {
    if (Array.isArray(x)) x.forEach(add);
    else if (x !== null && x !== undefined && x !== false) e.append(x instanceof Node ? x : document.createTextNode(String(x)));
  };
  kids.forEach(add);
  return e;
}

const when = (iso) => { const d = new Date(iso || ''); const p = (n) => String(n).padStart(2, '0'); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

export function mountApp(rootEl, frame) {
  const api = createApi(frame);
  const S = {
    perms: capabilities(frame.permissions()),
    nodes: [], node: null,                 // node: null = 이 노드
    roots: { state: 'loading', roots: [] }, root: '', path: '',
    list: { state: 'idle', entries: [], err: null }, sel: '',
    stat: null, view: 'browse',
    transfers: { state: 'idle', rows: [], err: null },
    jobs: [], dialog: null,
  };
  const engines = new Map();               // 노드마다 전송기 하나 — invoke 가 그 노드에 묶인다
  const engine = () => {
    const key = S.node ? S.node.id : '';
    if (!engines.has(key)) engines.set(key, createFileTransfer({ invoke: api.at(S.node ? S.node.id : null) }));
    return engines.get(key);
  };
  const files = () => api.files(S.node ? S.node.id : null);
  const nodeLabel = () => (S.node ? S.node.name : '이 노드');

  const $app = h('div', { class: 'app' });
  const $main = h('div', { class: 'body' });
  const $tray = h('section', { class: 'tray', 'aria-label': '진행 중인 전송' });
  const $dlg = h('div');
  $app.append(h('div', { id: 'top' }), $main, $tray, $dlg);
  rootEl.replaceChildren($app);

  // ───────── 읽기 ─────────
  async function loadNodes() {
    if (!S.perms.nodes) return;
    try { S.nodes = await api.nodes(); } catch { S.nodes = []; }   // 못 읽으면 이 노드만 보인다 — 오류로 화면을 막지 않는다
    drawTop();
  }
  async function loadRoots() {
    S.roots = { state: 'loading', roots: [] }; S.list = { state: 'idle', entries: [], err: null }; S.stat = null; S.sel = '';
    drawMain();
    try { S.roots = rootsState(await files().roots()); } catch (e) { S.roots = rootsState(null, e); }
    if (S.roots.state === 'ok') {
      if (!S.roots.roots.some((r) => r.name === S.root)) { S.root = S.roots.roots[0].name; S.path = ''; }
      await loadList();
    } else drawMain();
  }
  async function loadList() {
    S.list = { state: 'loading', entries: [], err: null }; S.sel = ''; S.stat = null; drawMain();
    try {
      const r = await files().list(S.root, S.path);
      S.list = { state: 'ok', entries: sortEntries(r && r.entries), err: null };
    } catch (e) { S.list = { state: 'err', entries: [], err: e }; }
    drawMain();
  }
  async function loadTransfers() {
    S.transfers = { ...S.transfers, state: 'loading' };
    try { const r = await files().transfers(); S.transfers = { state: 'ok', rows: (r && r.transfers) || [], err: null }; } catch (e) { S.transfers = { state: 'err', rows: [], err: e }; }
    if (S.view === 'transfers') drawMain();
  }
  const selEntry = () => S.list.entries.find((e) => e.path === S.sel) || null;

  async function pickNode(id) {
    S.node = id ? S.nodes.find((n) => n.id === id) || null : null; S.root = ''; S.path = ''; S.jobs = S.jobs.filter((j) => j.nodeKey === (S.node ? S.node.id : ''));
    drawTray(); await loadRoots();
  }
  const go = (path) => { S.path = cleanPath(path); loadList(); };
  const guard = async (fn) => { try { await fn(); } catch (e) { S.dialog = { type: 'error', err: e }; drawDlg(); } };

  // ───────── 전송 ─────────
  const jobKey = () => (S.node ? S.node.id : '');
  function track(job, base) {
    const row = { job, nodeKey: jobKey(), ...base };
    S.jobs.unshift(row);
    return row;
  }
  let trayTimer = 0;
  const poke = () => { if (!trayTimer) trayTimer = setTimeout(() => { trayTimer = 0; drawTray(); }, 200); };

  function startUpload(file, path, mode, extra = {}) {
    const row = track(null, { dir: 'up', name: file.name, target: path });
    row.job = engine().upload({ root: S.root, path, file, mode, resume_id: extra.resume_id, onChange: (j) => { poke(); if (j.state === 'done') refreshSoon(); } });
    drawTray();
    return row;
  }
  function startDownload(entry, extra = {}) {
    const row = track(null, { dir: 'down', name: entry.name || baseName(entry.path), target: entry.path });
    row.job = engine().download({ root: S.root, path: entry.path, name: row.name, resume_id: extra.resume_id, onChange: (j) => { poke(); if (j.state === 'done') saveBlob(j); } });
    drawTray();
    return row;
  }
  function saveBlob(j) {
    if (!j.blob || j._saved) return;
    j._saved = true;
    const url = URL.createObjectURL(j.blob);
    const a = h('a', { href: url, download: j.name || 'download' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  let refreshTimer = 0;
  const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (S.view === 'browse') loadList(); }, 600); };

  // ───────── 그리기: 위 ─────────
  function drawTop() {
    const nodeSel = S.nodes.length
      ? h('select', { class: 'nodesel', 'aria-label': '노드', onChange: (e) => pickNode(e.target.value) },
        h('option', { value: '', ...(S.node ? {} : { selected: true }) }, '이 노드'),
        S.nodes.map((n) => h('option', { value: n.id, ...(S.node && S.node.id === n.id ? { selected: true } : {}) }, n.name + (n.online === false ? ' · 응답 없음' : ''))))
      : h('span', { class: 'mono muted' }, '이 노드');
    const chip = (t, on) => h('span', { class: 'chip' + (on ? '' : ' off') }, t);
    const top = h('header', { class: 'top', id: 'top' },
      h('h1', null, '파일'), nodeSel,
      h('nav', { class: 'tabs', 'aria-label': '화면' },
        h('button', { class: 'tab', 'aria-current': S.view === 'browse' ? 'page' : null, onClick: () => setView('browse') }, '탐색'),
        h('button', { class: 'tab', 'aria-current': S.view === 'transfers' ? 'page' : null, onClick: () => setView('transfers') }, '전송 관리')),
      h('div', { class: 'chips' }, '내 권한', chip('file.read', S.perms.read), chip('file.write', S.perms.write)));
    $app.replaceChild(top, $app.querySelector('#top'));
  }
  function setView(v) {
    S.view = v; drawTop();
    if (v === 'transfers') { loadTransfers(); drawMain(); startPoll(); } else { stopPoll(); drawMain(); }
  }
  let poll = 0;
  const startPoll = () => { stopPoll(); poll = setInterval(loadTransfers, 3000); };
  const stopPoll = () => { clearInterval(poll); poll = 0; };

  // ───────── 그리기: 본문 ─────────
  function stateCard(tone, tag, title, body, ...acts) {
    return h('section', { class: 'card state tone-' + tone }, h('span', { class: 'tag' }, tag), h('h2', null, title), h('p', null, body), acts.length ? h('div', { class: 'bar' }, acts) : null);
  }
  const lockBtn = (text, onClick, { need, cls = 'btn', title } = {}) => {
    const ok = need ? S.perms[need] : true;
    return h('button', { class: cls, disabled: !ok, title: ok ? title : LOCK_WHY[need], onClick }, text);
  };

  function drawMain() {
    if (S.view === 'transfers') return $main.replaceChildren(h('div', { class: 'main' }, transfersView()));
    $main.replaceChildren(sideView(), h('main', { class: 'main' }, browseView()));
  }

  function sideView() {
    const r = S.roots;
    const body = r.state === 'ok'
      ? r.roots.map((x) => h('button', { class: 'root', 'aria-current': String(x.name === S.root), onClick: () => { S.root = x.name; S.path = ''; loadList(); } }, h('b', null, x.name), h('small', null, x.path)))
      : [h('span', { class: 'muted' }, r.state === 'loading' ? '불러오는 중…' : '—')];
    return h('aside', { class: 'side' },
      h('h2', null, `공유 폴더 · ${nodeLabel()}`), body,
      h('p', null, '이름은 노드 설정의 storage.shared_dirs 에서 옵니다. 폴더 추가·이름 변경은 그 노드의 Daemon 재시작이 필요합니다.'));
  }

  function browseView() {
    const r = S.roots;
    if (r.state === 'loading') return h('p', { class: 'muted' }, '공유 폴더를 불러오는 중…');
    if (r.state === 'unseen') {
      const d = describeError(r.err);
      return stateCard('unseen', `못 봤음 · ${d.code}`, d.title, d.body, h('button', { class: 'btn primary', onClick: loadRoots }, '다시 시도'));
    }
    if (r.state === 'empty') {
      return stateCard('warn', '공유 폴더 목록이 빔 · 원인 미상', '공유 폴더가 보이지 않습니다',
        'roots.list 가 빈 목록을 답했습니다. 노드에 공유 폴더를 선언하지 않았거나, 모듈이 폴더 권한을 받지 못했을 수 있습니다. "공유 폴더 없음"이라고 단정하지 않습니다.',
        h('button', { class: 'btn', onClick: loadRoots }, '다시 불러오기'),
        h('span', { class: 'muted' }, '확인할 것: storage.shared_dirs · 모듈 신뢰 등급(built-in 이상, 아니면 allow_unsigned_shared_roots) · Daemon 로그의 shared_roots_denied'));
    }
    const sel = selEntry();
    const anySel = !!sel, fileSel = sel && !sel.is_dir;
    const bar = h('div', { class: 'bar' },
      lockBtn('올리기', () => $fileIn.click(), { need: 'write', cls: 'btn primary' }),
      lockBtn('새 폴더', () => openDialog({ type: 'mkdir' }), { need: 'write' }),
      lockBtn('폴더 동기화…', () => openDialog({ type: 'sync', step: 'pick', remove: false }), { need: 'write' }),
      h('span', { class: 'muted' }, '|'),
      h('button', { class: 'btn', disabled: !fileSel || !S.perms.read, title: fileSel ? '' : '파일을 고르세요(폴더는 받을 수 없습니다)', onClick: () => startDownload(sel) }, '받기'),
      lockBtn('이름 바꾸기', () => openDialog({ type: 'rename', entry: sel }), { need: anySel ? 'write' : 'write' }),
      h('button', { class: 'btn danger', disabled: !anySel || !S.perms.write, title: !S.perms.write ? LOCK_WHY.write : '', onClick: () => openDialog({ type: 'remove', entry: sel, recursive: false }) }, '삭제…'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onClick: loadList }, '새로고침'),
      h('span', { class: 'muted' }, `${S.list.entries.length}개 항목`));
    // 이름 바꾸기는 고른 것이 있어야 한다
    const renameBtn = bar.querySelectorAll('button')[4]; if (renameBtn && !anySel) { renameBtn.disabled = true; renameBtn.title = '항목을 고르세요'; }

    const cr = crumbs(S.path);
    const crumbEl = h('nav', { class: 'crumbs', 'aria-label': '경로' },
      h('button', { onClick: () => go('') }, S.root),
      cr.map((c, i) => [h('span', { 'aria-hidden': 'true' }, '/'), i === cr.length - 1 ? h('span', { class: 'here' }, c.name) : h('button', { onClick: () => go(c.path) }, c.name)]));

    return [crumbEl, bar, h('div', { class: 'split' }, listCard(), detailCard(sel))];
  }

  function listCard() {
    const L = S.list;
    if (L.state === 'loading') return h('div', { class: 'card list' }, h('div', { class: 'foot' }, '불러오는 중…'));
    if (L.state === 'err') {
      const d = describeError(L.err);
      const up = S.path ? h('button', { class: 'btn', onClick: () => go(parentPath(S.path)) }, '상위 폴더로 이동') : h('button', { class: 'btn', onClick: loadList }, '다시 시도');
      return h('div', { class: 'card list' }, stateCard(d.tone, `${d.tone === 'unseen' ? '못 봤음' : '오류'} · ${d.code}`, d.title, d.body, up));
    }
    if (!L.entries.length) {
      return h('div', { class: 'card list' }, stateCard('ok', '정상 · 비어 있음', '이 폴더는 비어 있습니다', 'entries.list 가 빈 목록을 답했습니다. 폴더는 있고 안에 항목이 없는 것입니다.',
        S.perms.write ? h('button', { class: 'btn primary', onClick: () => $fileIn.click() }, '여기에 올리기') : null));
    }
    const rows = [];
    if (S.path) rows.push(h('button', { class: 'row', onClick: () => go(parentPath(S.path)) }, h('span', { class: 'name' }, h('span', { class: 'kind' }, '↑'), h('span', null, '상위 폴더')), h('span'), h('span')));
    for (const e of L.entries) {
      rows.push(h('button', {
        class: 'row', 'aria-selected': String(e.path === S.sel),
        onClick: () => { S.sel = e.path; S.stat = null; drawMain(); },
        onDblclick: () => { if (e.is_dir) go(e.path); },
      }, h('span', { class: 'name' }, h('span', { class: 'kind' }, e.is_dir ? '폴더' : '파일'), h('span', { style: e.is_dir ? 'font-weight:600' : null }, e.name)),
      h('span', { class: 'num' }, e.is_dir ? '—' : fmtBytes(e.size)), h('span', { class: 'when' }, when(e.modified_at))));
    }
    return h('div', { class: 'card list' }, h('div', { class: 'head' }, h('span', null, '이름'), h('span', { style: 'text-align:right' }, '크기'), h('span', null, '수정한 시각')), rows,
      h('div', { class: 'foot' }, '폴더는 두 번 눌러 엽니다. 목록은 경로순입니다. 빈 폴더(비어 있음)와 없는 경로(오류)는 다르게 보입니다.'));
  }

  function detailCard(sel) {
    if (!sel) return h('aside', { class: 'card detail' }, h('p', { class: 'muted' }, '항목을 고르면 여기에 정보가 보입니다.'));
    const st = S.stat && S.stat.path === sel.path ? S.stat : null;
    return h('aside', { class: 'card detail' },
      h('h2', null, sel.name),
      h('dl', { class: 'facts' },
        h('dt', null, '종류'), h('dd', null, sel.is_dir ? '폴더' : '파일'),
        h('dt', null, '크기'), h('dd', null, sel.is_dir ? '—' : `${fmtBytes(sel.size)} (${sel.size} B)`),
        h('dt', null, '모드'), h('dd', { class: 'mono' }, sel.mode || '—'),
        h('dt', null, '수정'), h('dd', null, when(sel.modified_at) || '—'),
        h('dt', null, 'SHA-256'), h('dd', { class: 'mono', style: 'font-size:12px' }, st ? (st.sha256 || '—') : sel.is_dir ? '—' : '계산하지 않음')),
      sel.is_dir ? null : h('button', { class: 'btn', onClick: () => guard(async () => { const r = await files().stat(S.root, sel.path, true); S.stat = r && r.entry; drawMain(); }) }, '체크섬 계산'),
      sel.is_dir ? null : h('p', { class: 'muted', style: 'margin:0;font-size:12px' }, '체크섬은 노드가 파일 전체를 읽습니다. 큰 파일이면 오래 걸려 눌렀을 때만 계산합니다.'));
  }

  // ───────── 그리기: 전송 트레이 ─────────
  function drawTray() {
    const live = S.jobs.filter((r) => r.nodeKey === jobKey());
    if (!live.length) { $tray.hidden = true; $tray.replaceChildren(); return; }
    $tray.hidden = false;
    $tray.replaceChildren(
      h('h2', null, `전송 ${live.length}건`),
      ...live.slice(0, 6).map((r) => jobRow(r)),
      h('div', { class: 'bar' }, h('button', { class: 'btn small', onClick: () => setView('transfers') }, '전송 관리 열기'),
        h('button', { class: 'btn small', onClick: () => { S.jobs = S.jobs.filter((r) => ['prep', 'run', 'verify'].includes(r.job.state)); drawTray(); } }, '끝난 것 지우기')));
  }
  function jobRow(r) {
    const j = r.job, pct = j.size ? Math.min(100, Math.floor((j.done / j.size) * 100)) : j.state === 'done' ? 100 : 0;
    const dir = r.dir === 'up' ? '↑' : '↓';
    const label = { prep: '준비 중', run: '전송 중', verify: '검증 중', done: '완료', fail: '실패', cancel: '취소됨' }[j.state] || j.state;
    const detail = j.state === 'fail' ? `${describeError(j.err).title} (${j.err && j.err.code})` : `${fmtBytes(j.done)} / ${fmtBytes(j.size)} · ${pct}%${fmtRate(j.rate) ? ' · ' + fmtRate(j.rate) : ''}${j.resumed ? ' · 이어받음' : ''}`;
    const acts = [];
    if (['prep', 'run', 'verify'].includes(j.state)) acts.push(h('button', { class: 'btn small', onClick: () => { j.cancel(); drawTray(); } }, '취소'));
    if (j.state === 'fail' || j.state === 'cancel') acts.push(h('button', { class: 'btn small', onClick: () => { j.retry(); drawTray(); } }, j.state === 'fail' ? '이어서 다시' : '처음부터 다시'));
    if (r.dir === 'down' && j.state === 'done' && j.blob) acts.push(h('button', { class: 'btn small', onClick: () => { j._saved = false; saveBlob(j); } }, '저장'));
    return h('div', { class: 'job' },
      h('div', null, h('div', { class: 't' }, `${dir} ${r.name}`), h('div', { class: 'muted', style: 'font-size:12px' }, `${label} · ${r.target}`)),
      h('div', null, h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill ' + (j.state === 'fail' ? 'err' : j.state === 'done' ? 'ok' : j.state === 'cancel' ? 'warn' : ''), style: `width:${pct}%` })), h('div', { class: 'muted', style: 'font-size:12px' }, detail)),
      h('div', { class: 'bar' }, acts));
  }

  // ───────── 그리기: 전송 관리 ─────────
  function transfersView() {
    const T = S.transfers;
    const head = h('div', { class: 'bar' }, h('h2', { style: 'margin:0;font-size:18px' }, `전송 관리 · ${nodeLabel()}`), h('span', { class: 'spacer' }),
      h('span', { class: 'muted' }, '최신순 · transfers.list'), h('button', { class: 'btn', onClick: loadTransfers }, '새로고침'));
    if (T.state === 'err') { const d = describeError(T.err); return [head, stateCard(d.tone, `${d.tone === 'unseen' ? '못 봤음' : '오류'} · ${d.code}`, d.title, d.body, h('button', { class: 'btn primary', onClick: loadTransfers }, '다시 시도'))]; }
    if (T.state !== 'ok') return [head, h('p', { class: 'muted' }, '불러오는 중…')];
    if (!T.rows.length) return [head, stateCard('ok', '정상 · 비어 있음', '전송 기록이 없습니다', '이 노드의 파일 모듈이 옮겼거나 옮기고 있는 전송이 없습니다.')];
    const liveIds = new Set(S.jobs.filter((r) => ['prep', 'run', 'verify'].includes(r.job.state) && r.job.tid).map((r) => r.job.tid));
    const rows = T.rows.slice().sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))).map((t) => transferRowEl(transferRow(t, liveIds), t));
    return [head, h('div', { class: 'card' },
      h('div', { class: 'trow thead' }, h('span'), h('span', null, '대상'), h('span', null, '상태'), h('span', null, '진행'), h('span', null, '전송 id'), h('span', null, '동작')), rows),
      h('div', { class: 'note' }, h('b', null, '이어받기: '), '올리기는 같은 파일을 다시 골라 이어서 올리고, 받기는 같은 경로를 다시 받습니다. 순서가 어긋나면 노드가 알려준 지점(retry_offset)부터 자동으로 다시 보냅니다.')];
  }
  function transferRowEl(r, t) {
    const tone = r.tone === 'warn' ? 'warn' : r.tone === 'err' ? 'err' : '';
    const acts = [];
    if (r.actions.includes('resume')) {
      if (r.dir === 'up') acts.push(lockBtn('이어서 올리기', () => pickForResume(r), { need: 'write', cls: 'btn small primary' }));
      else acts.push(h('button', { class: 'btn small primary', disabled: !S.perms.read, onClick: () => { startDownload({ path: r.path, name: baseName(r.path) }, { resume_id: r.id }); setView('browse'); } }, '다시 받기'));
    }
    if (r.actions.includes('discard')) acts.push(lockBtn('버리기', () => guard(async () => { await files().abort(r.id, r.dir === 'down'); loadTransfers(); }), { need: r.dir === 'down' ? 'read' : 'write', cls: 'btn small' }));
    return h('div', { class: 'trow ' + tone },
      h('span', { 'aria-label': r.dir === 'up' ? '올리기' : '받기' }, r.dir === 'up' ? '↑' : '↓'),
      h('div', { style: 'min-width:0' }, h('div', { style: 'font-weight:500;overflow-wrap:anywhere' }, baseName(r.path)), h('div', { class: 'mono muted', style: 'font-size:12px' }, `${r.root}/${parentPath(r.path)} · ${r.dir === 'up' ? 'push' : 'pull'}`)),
      h('span', { class: 'tone-text-' + (r.tone === 'warn' ? 'warn' : r.tone === 'ok' ? 'ok' : r.tone === 'run' ? 'run' : 'err') }, r.label),
      h('div', null, h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill ' + (r.tone === 'warn' ? 'warn' : r.tone === 'ok' ? 'ok' : ''), style: `width:${r.pct}%` })),
        h('div', { class: 'muted', style: 'font-size:12px' }, `${fmtBytes(r.offset)} / ${fmtBytes(r.size)} · ${r.pct}%${r.reason ? ' · ' + r.reason : ''}`)),
      h('span', { class: 'mono muted', style: 'font-size:12px' }, r.id.length > 14 ? r.id.slice(0, 8) + '…' + r.id.slice(-4) : r.id),
      h('div', { class: 'bar' }, acts));
  }
  function pickForResume(r) {
    const input = h('input', { type: 'file', class: 'visually-hidden', onChange: () => {
      const f = input.files && input.files[0]; input.remove(); if (!f) return;
      if (r.size && f.size !== r.size) { openDialog({ type: 'note', title: '다른 파일 같습니다', body: `원래 전송은 ${fmtBytes(r.size)}였고 고른 파일은 ${fmtBytes(f.size)}입니다. 같은 파일을 골라야 이어집니다.` }); return; }
      S.root = r.root; startUpload(f, r.path, 'overwrite', { resume_id: r.id }); setView('browse'); loadList();
    } });
    document.body.append(input); input.click();
  }

  // ───────── 올리기 입력 ─────────
  const $fileIn = h('input', { type: 'file', multiple: true, class: 'visually-hidden', 'aria-hidden': 'true', tabindex: '-1', onChange: () => {
    const picked = [...($fileIn.files || [])]; $fileIn.value = '';
    if (!picked.length) return;
    const taken = new Set(S.list.entries.map((e) => e.name));
    openDialog({ type: 'send', items: picked.map((file) => ({ file, name: file.name, exists: taken.has(file.name), choice: taken.has(file.name) ? 'rename' : 'create' })), taken: [...taken] });
  } });
  document.body.append($fileIn);

  // ───────── 대화상자 ─────────
  function openDialog(d) { S.dialog = d; drawDlg(); }
  const closeDialog = () => { S.dialog = null; drawDlg(); };
  function dlg(title, sub, ...rest) { return h('div', { class: 'scrim', onClick: (e) => { if (e.target === e.currentTarget && !S.dialog.busy) closeDialog(); } }, h('div', { class: 'dlg', role: 'dialog', 'aria-label': title }, h('div', null, h('h2', null, title), sub ? h('p', { class: 'sub' }, sub) : null), rest)); }

  function drawDlg() {
    const d = S.dialog;
    if (!d) return $dlg.replaceChildren();
    const cancel = h('button', { class: 'btn', onClick: closeDialog }, '취소');
    if (d.type === 'error') { const e = describeError(d.err); return $dlg.replaceChildren(dlg(e.title, e.code, h('div', { class: 'note err' }, e.body), h('div', { class: 'acts' }, h('button', { class: 'btn primary', onClick: closeDialog }, '닫기')))); }
    if (d.type === 'note') return $dlg.replaceChildren(dlg(d.title, '', h('div', { class: 'note' }, d.body), h('div', { class: 'acts' }, h('button', { class: 'btn primary', onClick: closeDialog }, '닫기'))));

    if (d.type === 'mkdir') {
      const input = h('input', { type: 'text', id: 'nm', placeholder: '새 폴더 이름' });
      const run = () => { const name = input.value.trim(); if (!name) return; if (outsideRoot(name)) { input.setCustomValidity('x'); return openDialog({ type: 'error', err: { code: 'PATH_DENIED' } }); } closeDialog(); guard(async () => { await files().mkdir(S.root, joinPath(S.path, name), false); loadList(); }); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      $dlg.replaceChildren(dlg('새 폴더', `${S.root}/${S.path}`, h('label', { class: 'field', for: 'nm' }, '이름', input), h('div', { class: 'acts' }, cancel, h('button', { class: 'btn primary', onClick: run }, '만들기'))));
      return input.focus();
    }
    if (d.type === 'rename') {
      const input = h('input', { type: 'text', id: 'nm', value: d.entry.name });
      const run = () => { const name = input.value.trim(); if (!name || name === d.entry.name) return closeDialog(); if (outsideRoot(name) || name.includes('/')) return openDialog({ type: 'error', err: { code: 'PATH_DENIED' } }); closeDialog(); guard(async () => { await files().rename(S.root, d.entry.path, joinPath(parentPath(d.entry.path), name)); loadList(); }); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      $dlg.replaceChildren(dlg('이름 바꾸기', d.entry.path, h('label', { class: 'field', for: 'nm' }, '새 이름', input), h('div', { class: 'acts' }, cancel, h('button', { class: 'btn primary', onClick: run }, '바꾸기'))));
      return input.focus();
    }
    if (d.type === 'remove') {
      const rec = h('input', { type: 'checkbox', id: 'rec', checked: d.recursive, onChange: (e) => { d.recursive = e.target.checked; } });
      const run = () => { closeDialog(); guard(async () => { try { await files().remove(S.root, d.entry.path, d.recursive); } catch (e) { if (e.code === 'FILE_RECURSIVE_REQUIRED') return openDialog({ type: 'remove', entry: d.entry, recursive: true, needRec: true }); throw e; } loadList(); }); };
      return $dlg.replaceChildren(dlg('삭제', d.entry.path,
        h('div', { class: 'note err' }, `${d.entry.is_dir ? '폴더' : '파일'} "${d.entry.name}"을(를) 노드에서 지웁니다. 되돌릴 수 없습니다.`),
        d.entry.is_dir ? h('label', { class: 'choice' }, rec, '안의 항목까지 모두 지웁니다 (recursive)') : null,
        d.needRec ? h('div', { class: 'note' }, '비어 있지 않은 폴더입니다(FILE_RECURSIVE_REQUIRED). 위 칸을 확인하고 다시 누르세요.') : null,
        h('div', { class: 'acts' }, cancel, h('button', { class: 'btn danger solid', onClick: run }, '삭제'))));
    }
    if (d.type === 'send') return $dlg.replaceChildren(sendDialog(d, cancel));
    if (d.type === 'sync') return $dlg.replaceChildren(syncDialog(d, cancel));
  }

  function sendDialog(d, cancel) {
    const total = d.items.reduce((s, i) => s + i.file.size, 0);
    const blocks = d.items.map((it, idx) => {
      const head = h('div', { style: 'display:flex;gap:12px;align-items:center' }, h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:500;overflow-wrap:anywhere' }, it.file.name), h('div', { class: 'muted', style: 'font-size:12px' }, `${fmtBytes(it.file.size)} → ${nodeLabel()}:${S.root}/${joinPath(S.path, it.name)}`)));
      if (!it.exists) return h('div', { class: 'card', style: 'padding:12px 14px' }, head);
      const taken = [...d.taken, ...d.items.filter((o) => o !== it).map((o) => o.name)];
      const alt = suggestName(it.file.name, taken);
      const radio = (value, text) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: 'c' + idx, checked: it.choice === value, onChange: () => { it.choice = value; if (value === 'rename') it.name = alt; else if (value === 'overwrite') it.name = it.file.name; drawDlg(); } }), text);
      return h('div', { class: 'note' }, head, h('div', { style: 'font-weight:600;margin:8px 0 6px' }, '같은 이름의 파일이 이미 있습니다 (FILE_TARGET_EXISTS)'),
        h('div', { style: 'display:grid;gap:6px' }, radio('rename', `다른 이름으로 올리기 → ${alt}`), radio('overwrite', '덮어쓰기 (mode: overwrite) · 되돌릴 수 없음'), radio('skip', '올리지 않기')));
    });
    const doable = d.items.filter((i) => i.choice !== 'skip');
    if (!S.perms.write) blocks.unshift(h('div', { class: 'note err' }, LOCK_WHY.write));
    return dlg('파일 올리기', `${nodeLabel()}의 공유 폴더로 보냅니다. 청크마다 검증하고, 끊기면 이어서 올립니다.`,
      blocks,
      h('div', { class: 'acts' }, h('span', { class: 'muted', style: 'flex:1;font-size:12px' }, `필요 권한: file.write · ${fmtBytes(total)}`), cancel,
        h('button', { class: 'btn primary', disabled: !S.perms.write || !doable.length, onClick: () => { closeDialog(); for (const it of doable) startUpload(it.file, joinPath(S.path, it.name), it.choice === 'overwrite' ? 'overwrite' : 'create'); } }, `올리기 시작${doable.length > 1 ? ` (${doable.length})` : ''}`)));
  }

  // ───────── 폴더 동기화 ─────────
  async function walkRemote(base, rel, out, budget) {
    const r = await files().list(S.root, joinPath(base, rel));
    for (const e of (r && r.entries) || []) {
      if (budget.n++ > 5000) throw Object.assign(new Error('노드 폴더가 너무 큽니다(5000 항목 초과)'), { code: 'TOO_LARGE_FOR_BROWSER' });
      const p = joinPath(rel, e.name);
      if (e.is_dir) await walkRemote(base, p, out, budget); else out.push({ path: p, size: e.size, modified_at: e.modified_at });
    }
  }
  function syncDialog(d, cancel) {
    const base = S.path;
    if (d.step === 'pick') {
      const input = h('input', { type: 'file', webkitdirectory: '', multiple: true, class: 'visually-hidden', id: 'dir', onChange: () => {
        const list = [...(input.files || [])].map((f) => ({ path: cleanPath((f.webkitRelativePath || f.name).split('/').slice(1).join('/')), size: f.size, mtime: f.lastModified, file: f })).filter((f) => f.path);
        if (!list.length) return;
        d.local = list; d.step = 'plan'; d.busy = true; drawDlg();
        const remote = []; walkRemote(base, '', remote, { n: 0 }).then(() => { d.remote = remote; d.busy = false; drawDlg(); }).catch((e) => { openDialog({ type: 'error', err: e }); });
      } });
      return dlg('폴더 동기화', '내 폴더가 기준입니다. 노드에서 내 쪽으로는 아무것도 오지 않고, 먼저 계획만 봅니다(dry-run).',
        h('div', { class: 'note' }, `대상: ${nodeLabel()}:${S.root}/${base}`),
        h('label', { class: 'choice' }, h('input', { type: 'checkbox', checked: d.remove, onChange: (e) => { d.remove = e.target.checked; } }), '내 폴더에 없는 노드 파일 삭제 (--delete) — 되돌릴 수 없음'),
        h('p', { class: 'muted', style: 'font-size:12px;margin:0' }, '크기와 수정 시각으로 비교합니다. 체크섬 비교는 노드가 모든 파일을 읽어야 해서 CLI(terra file sync --checksum)에서만 합니다. 심볼릭 링크는 건너뜁니다.'),
        input, h('div', { class: 'acts' }, cancel, h('button', { class: 'btn primary', onClick: () => document.getElementById('dir').click() }, '내 폴더 고르기…')));
    }
    if (d.step === 'plan' && d.busy) return dlg('폴더 동기화', '', h('p', { class: 'muted' }, '노드의 폴더를 읽어 계획을 세우는 중…'));
    if (d.step === 'plan') {
      const p = planSync(d.local, d.remote, { remove: d.remove }), sum = planSummary(p);
      const need = p.remove.length > 0;
      const confirm = h('input', { type: 'text', id: 'cf', placeholder: '삭제' });
      const go = h('button', { class: 'btn ' + (need ? 'danger solid' : 'primary'), disabled: planTotal(p) === 0 || need, onClick: () => runSync(d, p) }, `동기화 실행 (${planTotal(p)}건)`);
      confirm.addEventListener('input', () => { go.disabled = confirm.value.trim() !== '삭제' || planTotal(p) === 0; });
      const lines = [...p.remove.map((r) => ['삭제', r.path, fmtBytes(r.size)]), ...p.change.map((f) => ['덮어씀', f.path, fmtBytes(f.size)]), ...p.add.map((f) => ['새로', f.path, fmtBytes(f.size)])].slice(0, 200);
      return dlg('폴더 동기화', `${nodeLabel()}:${S.root}/${base} ← 내 폴더 (${d.local.length}개 파일)`,
        h('div', { class: 'plan' }, [['새로 올림', sum.add], ['바뀐 파일 덮어씀', sum.change], ['노드에서 삭제', sum.remove], ['그대로 둠', sum.same]].map(([k, v]) => h('div', null, h('b', null, v), k))),
        lines.length ? h('div', { class: 'planlist' }, lines.map(([k, a, b]) => h('div', null, h('b', null, k), h('span', { class: 'mono', style: 'overflow-wrap:anywhere' }, a), h('span', { class: 'muted', style: 'text-align:right' }, b)))) : h('p', { class: 'muted' }, '바꿀 것이 없습니다.'),
        need ? h('div', { class: 'note err' }, `삭제 ${sum.remove}건은 되돌릴 수 없습니다. 아래 칸에 `, h('b', null, '삭제'), '를 입력해야 실행됩니다 (CLI의 --yes에 해당).', h('div', { style: 'margin-top:8px' }, h('label', { class: 'field', for: 'cf' }, '확인 입력', confirm))) : null,
        h('div', { class: 'acts' }, cancel, go));
    }
    if (d.step === 'run') {
      const done = d.log.filter((l) => l.state !== 'wait').length;
      return dlg('폴더 동기화', `${done} / ${d.log.length}`, h('div', { class: 'planlist' }, d.log.slice(-200).map((l) => h('div', null, h('b', null, l.kind), h('span', { class: 'mono', style: 'overflow-wrap:anywhere' }, l.path), h('span', { class: l.state === 'err' ? '' : 'muted', style: 'text-align:right' }, l.state === 'ok' ? '완료' : l.state === 'err' ? '실패' : '…')))),
        h('div', { class: 'acts' }, h('button', { class: 'btn', disabled: d.finished, onClick: () => { d.stop = true; } }, '멈추기'), h('button', { class: 'btn primary', disabled: !d.finished, onClick: () => { closeDialog(); loadList(); } }, '닫기')));
    }
  }
  async function runSync(d, p) {
    const eng = engine(), base = S.path, sameNode = S.node ? S.node.id : '';
    d.step = 'run'; d.busy = false; d.stop = false; d.finished = false;
    d.log = [...p.add.map((f) => ({ kind: '새로', path: f.path, f, mode: 'create', state: 'wait' })), ...p.change.map((f) => ({ kind: '덮어씀', path: f.path, f, mode: 'overwrite', state: 'wait' })), ...p.remove.map((r) => ({ kind: '삭제', path: r.path, remove: true, state: 'wait' }))];
    drawDlg();
    const made = new Set();
    for (const item of d.log) {
      if (d.stop || (S.node ? S.node.id : '') !== sameNode) break;
      try {
        if (item.remove) await files().remove(S.root, joinPath(base, item.path), false);
        else {
          const dir = parentPath(item.path);
          if (dir && !made.has(dir)) { await files().mkdir(S.root, joinPath(base, dir), true); made.add(dir); }
          const job = eng.upload({ root: S.root, path: joinPath(base, item.path), file: item.f.file, mode: item.mode });
          await job.promise; if (job.state !== 'done') throw job.err || new Error('전송 실패');
        }
        item.state = 'ok';
      } catch (e) { item.state = 'err'; item.err = e; }
      drawDlg();
    }
    d.finished = true; drawDlg();
  }

  // ───────── 시작 ─────────
  frame.onToken(() => { /* 토큰이 바뀌면(갱신 · 로그인) 권한이 달라질 수 있다 */ S.perms = capabilities(frame.permissions()); drawTop(); if (S.roots.state === 'unseen' || S.roots.state === 'loading') loadRoots(); else drawMain(); });
  drawTop(); drawMain(); drawTray();
  loadNodes().then(loadRoots);
}
