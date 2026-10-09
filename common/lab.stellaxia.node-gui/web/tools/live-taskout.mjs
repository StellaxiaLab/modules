// 작업 출력 · 다시 실행(MD-34 · Terra PF-7) 진짜 스택 실측 — 모듈 코드(TerraClient · LiveSource · task-output.js)를 그대로,
// 이 앱의 토큰(tsa_)으로 진짜 게이트웨이에 붙인다. 화면(브라우저)은 거치지 않는다 — 화면은 tests/taskout.test.mjs · 연기 시험이 본다.
//
//   TERRA_GW=http://127.0.0.1:28787 TERRA_MASTER=http://127.0.0.1:28080 \
//   TERRA_APP_TOKEN_FILE=app.tok TERRA_ADMIN_TOKEN_FILE=admin.tok TERRA_REGISTRATION=daemon/registration.json \
//   TERRA_NODE_NAME=stack-leaf-01 node tools/live-taskout.mjs
//
// 앱 토큰은 POST {게이트웨이}/api/v1/gui/apps/lab.stellaxia.node-gui.web/token (Master 세션 Bearer) 으로 받는다.
// 관리자 토큰은 Master 명령(commands.post)을 보내 Master 가 보낸 작업을 만들 때만 쓴다. 결과: docs/api/real-data-layer.md §5.7
import { readFileSync } from 'node:fs';
const W = new URL('../src/', import.meta.url).href;
const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win; globalThis.window = win;
const { TerraClient, resultText } = await import(W + 'api/client.js');
const { LiveSource } = await import(W + 'api/source.js');
const { OutputView, followOutput, OUTPUT_OP } = await import(W + 'api/task-output.js');
const { outText } = await import(W + 'api/wire.js');

const E = process.env;
const GW = E.TERRA_GW || 'http://127.0.0.1:28787', MASTER = E.TERRA_MASTER || 'http://127.0.0.1:28080';
const app = readFileSync(E.TERRA_APP_TOKEN_FILE || 'app.tok', 'utf8').trim(), admin = readFileSync(E.TERRA_ADMIN_TOKEN_FILE || 'admin.tok', 'utf8').trim();
const nodeId = JSON.parse(readFileSync(E.TERRA_REGISTRATION || 'daemon/registration.json', 'utf8')).node_id;
const authFetch = (url, init = {}) => fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers || {}, { Authorization: 'Bearer ' + app }) }));
const client = new TerraClient(GW, { fetch: authFetch, delegated: true });
await client.refreshCatalog();
const LOCAL = E.TERRA_NODE_NAME || 'stack-leaf-01';
const source = new LiveSource(client, { localNode: LOCAL, localId: nodeId, idOf: (n) => (n === 'other' ? nodeId : null) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info) => { results.push([ok, name]); console.log((ok ? '✓ ' : '✗ ') + name + (info ? ' — ' + info : '')); };
const one = (s) => String(s).replace(/\n/g, ' ⏎ ').slice(0, 220);
const waitDone = async (id) => { for (let i = 0; i < 60; i++) { const r = await client.invoke('terra.daemon.tasks.by-task-id.get', { task_id: id }); if (r.kind === 'ok' && /succeeded|failed|canceled|timed_out/.test(r.data.state)) return r.data; await sleep(500); } return null; };

check('카탈로그에 출력 · 따라가기 · 다시 op', [OUTPUT_OP, 'terra.daemon.tasks.by-task-id.output.events.get', 'terra.daemon.tasks.by-task-id.rerun.post'].every((o) => client.has(o)), 'catalog ' + client.catalog.size);

// 1) 실행 중인 명령 — 출력 읽기 → SSE 따라가기.
//    인자를 따로 주지 않는다 — Daemon 의 system_default 셸은 명령과 인자를 빈칸으로 이어 한 줄로 돌린다(따옴표를 붙이지 않는다)
const script = 'for i in 1 2 3; do echo line$i; sleep 2; done; echo warn >&2; echo --password=hunter2secret; exit 3';
const run = await client.invoke('terra.daemon.commands.execute.post', { command: script });
check('명령 접수(202 · output_url)', run.kind === 'accepted' && !!run.data.output_url, JSON.stringify(run.data));
const tid = run.job;
await sleep(700);
const first = await source.act(LOCAL, 'job', tid, 'out', { id: tid });
check('실행 중 출력 읽기 — act(out) → output.get', first.kind === 'ok' && first.data.complete === false, 'state ' + (first.data && first.data.state) + ' · ' + one(new OutputView().page(first.data).text()));
const view = new OutputView().page(first.data);
const t0 = Date.now(); let changes = 0;
await new Promise((resolve) => { const stop = followOutput(client, tid, view, () => { changes++; if (view.ended) resolve(); }); setTimeout(() => { stop(); resolve(); }, 20000); });
check('SSE 따라가기 — 끝까지 · end 에 닫힘', view.ended && /line3/.test(view.text()), (Date.now() - t0) + ' ms · 바뀜 ' + changes + ' · ' + one(view.text()));
check('끝 상태 · exit 3 · stderr 표시 · 비밀 가림', /exit 3/.test(view.text()) && /! warn/.test(view.text()) && !/hunter2secret/.test(view.text()), one(view.text().split('\n').slice(-3).join('\n')));

// 2) 끝난 뒤 다시 읽기 — 출력 칸(outText)과 같은 글
const after = await source.act(LOCAL, 'job', tid, 'out', { id: tid });
check('끝난 뒤 출력 읽기 = 따라온 글', after.kind === 'ok' && outText('out', after.data) === view.text(), one(outText('out', after.data)));

// 3) 목록 → 카드: origin local · exit 3
const items = await source.list(LOCAL, 'job');
const it = items.find((x) => x.id === tid);
check('목록 카드 — origin local · exit 코드', it && it.origin === 'local' && it.code === 3, JSON.stringify(it));

// 4) 다시 실행 — act(rerun) → 새 작업 · rerun_of · 같은 출력
const re = await source.act(LOCAL, 'job', tid, 'rerun', it);
check('다시 실행 — rerun.post {confirmed} → 202', re.kind === 'accepted' && re.data.rerun_of === tid, JSON.stringify(re.data));
const fin = re.job ? await waitDone(re.job) : null;
const reOut = re.job ? await source.act(LOCAL, 'job', re.job, 'out', { id: re.job }) : null;
check('다시 실행한 작업 — 같은 명령 · 같은 출력 · rerun_of', fin && fin.rerun_of === tid && reOut && reOut.kind === 'ok' && outText('out', reOut.data) === view.text(), fin && (fin.state + ' · rerun_of ' + fin.rerun_of));
const still = await client.invoke('terra.daemon.commands.execute.post', { command: 'sleep', args: ['3'] });
await sleep(300);
const busy = await source.act(LOCAL, 'job', still.job, 'rerun', { id: still.job, origin: 'local' });
check('끝나지 않은 작업의 다시 실행 — TASK_STILL_RUNNING', busy.reason === 'TASK_STILL_RUNNING', resultText(busy));

// 5) 다른 노드처럼 — 노드 주소 호출(Master 중계). 클러스터에 노드가 하나라 이 노드를 다른 이름('other')으로 부른다
const remote = await source.act('other', 'job', tid, 'out', { id: tid });
check('노드 주소 호출로 출력 읽기(scopes cluster)', remote.kind === 'ok' && outText('out', remote.data) === view.text(), remote.kind + ' ' + (remote.reason || ''));
const rlock = source.lockFor('job', 'rerun', 'other');
check('다른 노드의 다시 실행은 잠김(scopes local)', !!rlock, rlock);

// 6) Master 가 보낸 작업 — 앱은 부르지 않고 이유 · Daemon 도 409
const cmd = await fetch(MASTER + '/api/v1/commands', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ target_node_id: nodeId, type: 'process.execute.request', payload: { command: 'echo', args: ['from-master'] } }) }).then((r) => r.json());
const jobId = cmd.data && cmd.data.job_id;
let mtask = null;
for (let i = 0; i < 40 && !mtask; i++) { const r = await client.invoke('terra.daemon.tasks.get', { master_job_id: jobId }); mtask = r.kind === 'ok' && r.data.tasks && r.data.tasks[0]; if (!mtask) await sleep(500); }
check('Master 작업 → Daemon task(master_job_id)', !!mtask && mtask.origin && mtask.origin.kind === 'master', mtask ? mtask.id + ' · ' + JSON.stringify(mtask.origin) : JSON.stringify(cmd).slice(0, 200));
if (mtask) {
  await waitDone(mtask.id);
  const mi = (await source.list(LOCAL, 'job')).find((x) => x.id === mtask.id);
  const gui = await source.act(LOCAL, 'job', mtask.id, 'rerun', mi);
  const direct = await client.invoke('terra.daemon.tasks.by-task-id.rerun.post', { task_id: mtask.id, confirmed: true });
  check('Master 작업의 다시 실행 — 화면은 부르지 않음 · Daemon 409', gui.reason === 'TASK_RERUN_VIA_MASTER' && direct.status === 409 && direct.reason === 'TASK_RERUN_VIA_MASTER', resultText(gui) + ' / ' + direct.status);
  const mout = await source.act(LOCAL, 'job', mtask.id, 'out', { id: mtask.id });
  check('Master 작업의 출력도 이 노드에서 읽힌다', mout.kind === 'ok' && /from-master/.test(outText('out', mout.data)), one(outText('out', mout.data)));
}
const fails = results.filter((r) => !r[0]).length;
console.log(fails ? '실패 ' + fails : '모두 통과', '· ' + results.length + '개');
process.exit(fails ? 1 : 0);
