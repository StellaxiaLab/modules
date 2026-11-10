// node --test — 번들(src · 보드)이 부르는 operation id 가 계약에 있는가(AUD-12: io.terra.file.* 가 계약에 없는 id 였다).
//   저장소 안 자료만 쓴다: modules 계약(leaf · tree · common 의 contracts/api/terra-api.json) + src/api/op-scope.json(Daemon) + src/api/master-delegated.json(Master 위임 표) + 아래 고정 Gateway 목록.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../', import.meta.url)), repo = join(web, '../../../');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const known = new Set();
for (const grp of ['leaf', 'tree', 'common']) {
  const d = join(repo, grp); if (!existsSync(d)) continue;
  for (const m of readdirSync(d)) { const f = join(d, m, 'contracts/api/terra-api.json'); if (existsSync(f)) for (const k of Object.keys(json(f).operations || {})) known.add(k); }
}
for (const k of Object.keys(json(join(web, 'src/api/op-scope.json')).operations)) known.add(k);
for (const k of Object.keys(json(join(web, 'src/api/master-delegated.json')).operations)) known.add(k);
// Gateway 가 앱 토큰(app-scope-token)으로 내놓는 것 · Terra 계약에서 옮긴 고정 목록(저장소 밖이라 손으로 — 늘리면 이유를 적는다)
const GATEWAY = ['terra.gateway.agent.whoami.get', 'terra.gateway.agent.nodes.get', 'terra.master.nodes.get'];
for (const k of GATEWAY) known.add(k);
// 화면에 단추는 있으나 앱 토큰으로는 못 부르는 Master op — 위임 표(master-delegated.json) 밖이라 gate 가 "위임 없음"으로 잠근다(잠금 + 이유가 맞는 상태). 손으로 둔 고정 목록
const LOCKED_MASTER = ['terra.master.admin.external-issuers.', 'terra.master.users.by-user-id.external-identities.', 'terra.master.connection-groups.', 'terra.master.network.mesh.wireguard.', 'terra.master.network.probes.', 'terra.master.route.', 'terra.master.service-tunnels.open.', 'terra.master.admin.users.get', 'terra.master.svi.handles.', 'terra.master.crossboundary.login-routes.'];
// Terra 계약에 없는 op — 설계 제안만 있다(node-shell.md §5.1). 단추는 잠겨 호출하지 않는다
const NOT_IN_TERRA = ['terra.daemon.terminal.sessions.post'];
const isKnown = (id) => known.has(id) || NOT_IN_TERRA.includes(id) || LOCKED_MASTER.some((p) => id.startsWith(p)) || [...known].some((k) => k.startsWith(id + '.'));   // 마지막은 조각(접두사)

const walk = (d, out = []) => { for (const n of readdirSync(d)) { if (n === 'node_modules') continue; const p = join(d, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };
const srcFiles = [...walk(join(web, 'src')).filter((p) => /\.js$/.test(p) && !/\.test\./.test(p)), ...walk(join(web, 'design/build/parts')).filter((p) => p.endsWith('script.js')), join(web, 'design/NodeDesktopEmbed.dc.html')];
const RE = /['"`]((?:lab\.stellaxia|terra\.(?:daemon|master|gateway))\.[a-z0-9][a-z0-9.-]*[a-z0-9])['"`]/g;

test('번들이 문자열로 부르는 operation id 는 전부 계약(또는 위임 표 · 고정 Gateway 목록)에 있다', () => {
  const bad = [];
  for (const f of srcFiles) { const s = readFileSync(f, 'utf8'); for (const m of s.matchAll(RE)) { const id = m[1]; if (id.split('.').length < 4 || isKnown(id)) continue; bad.push(f.replace(web, '') + ' ' + id); } }
  assert.deepEqual([...new Set(bad)].sort(), [], '계약에 없는 op id');
});

test('옛 접두사 io.terra.file · io.terra.io-inventory 는 op 로 쓰지 않는다', () => {
  for (const f of [...srcFiles, ...walk(join(web, 'tests')).filter((p) => p.endsWith('.mjs'))]) {
    const s = readFileSync(f, 'utf8'); if (f.endsWith('op-ids.test.mjs')) continue;
    assert.ok(!/io\.terra\.(file|io-inventory)\.(roots|entries|transfers|devices|tombstones)/.test(s), f + ' 에 옛 op id');
  }
});
