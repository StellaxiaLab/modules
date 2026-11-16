#!/usr/bin/env node
// Terra 터미널 낱말 표 — terra-docs 의 CLI 표면 지도에서 src/api/terra-words.json 을 만든다 (ADR-GW-014 P17-2).
//
// 입력(terra-docs docs/reference/terra-surface-map/) : gui-coverage-cli.csv(분류 class · 등급 tier) + cli-commands.csv(요약 · 인자 꼴)
// 뽑는 것 : class 가 O(열림) · A(위임으로 열기) · R(원격 범위 넓히기)인 명령. 명령 하나 = 한 줄.
//   kind  op      operation 하나로 바로 이어지는 명령(터미널이 부른다)
//         multi   op 가 둘 이상(예 master|daemon)이거나 CLI 가 여러 호출을 엮는 명령 — 터미널은 안 부르고 op 와 대신 할 곳을 말한다
//         stream  스트림 · 감시(watch · logs events) — 한 줄 응답이 아니다
//         direct  Gateway 직접 길(operation invoke 밖) · 비밀번호 로그인 등
//         shape   CLI 인자 꼴이 op 입력과 다른 것(key=value · node:root/path · --stdin)
//   tier  T0 읽기 · T1 쓰기 · T2 앱 확인 · T3 · T4 승인 문(O · A · R 에는 T3 · T4 가 없다 — 그래도 길은 열어 둔다)
//   pos   op id 의 by-<이름> 마디 → 위치 인자가 채우는 입력 이름(snake_case)
//   node  terra.daemon.* — 현재 노드(use)가 대상이 되는 op
//
//   node tools/gen-terra-words.mjs --docs ../../../terra-docs            표를 다시 쓴다
//   node tools/gen-terra-words.mjs --docs ../../../terra-docs --check    다르면 실패한다
// --docs 는 terra-docs 체크아웃(또는 TERRA_DOCS 환경변수). 표 자체는 저장소에 들어 있어 terra-docs 없이도 시험은 돈다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const OUTPUT = join(here, '..', 'src', 'api', 'terra-words.json');
const MAP = 'docs/reference/terra-surface-map';

/** RFC4180 풍 CSV(따옴표 · 따옴표 안 줄바꿈 · BOM) → 객체 배열 */
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** op id 의 by-<이름> 마디 → 입력 이름 (by-device-id → device_id) */
export function posOf(op) { return op.split('.').filter((s) => s.startsWith('by-')).map((s) => s.slice(3).replace(/-/g, '_')); }

export function buildWords(cov, cli) {
  const meta = new Map(cli.map((r) => [r.command, r]));
  const words = [];
  for (const r of cov) {
    if (!['O', 'A', 'R'].includes(r.class)) continue;
    const m = meta.get(r.command) || {}, ops = r.op_ids.split('|').map((s) => s.trim()).filter(Boolean), opts = m.options || '';
    const w = { cmd: r.command.replace(/^terra /, ''), cls: r.class, tier: r.tier, effect: r.effect };
    const al = (m.aliases || '').split(/[,;]/).map((s) => s.trim().replace(/^terra /, '')).filter(Boolean);
    if (al.length) w.aliases = al;
    if (m.summary_ko) w.sum = m.summary_ko;
    if (opts) w.usage = opts;
    const op = ops[0];
    if (ops.length !== 1 || !/^[A-Za-z0-9.-]+$/.test(op)) { w.kind = 'multi'; w.ops = ops.filter((s) => /^[A-Za-z0-9.-]+$/.test(s)); }
    else if (/(^|\.)(stream|events|watch)(\.|$)/.test(op) || /\bwatch\b|\blogs events\b/.test(r.command)) { w.kind = 'stream'; w.op = op; }
    else if (r.route === 'gateway-direct' || /^terra\.gateway\.(auth|gui|cli|health|catalog)\./.test(op)) { w.kind = 'direct'; w.op = op; }
    else if (/key=value|--stdin|<[a-z_]+:[^>]+>/.test(opts)) { w.kind = 'shape'; w.op = op; }
    else { w.kind = 'op'; w.op = op; w.pos = posOf(op); w.node = op.startsWith('terra.daemon.'); }
    words.push(w);
  }
  return words.sort((a, b) => (a.cmd < b.cmd ? -1 : 1));
}

export function render(cov, cli) {
  return JSON.stringify({ _comment: 'tools/gen-terra-words.mjs 가 terra-docs 의 gui-coverage-cli.csv · cli-commands.csv 에서 만든다 — 손으로 고치지 않는다', words: buildWords(cov, cli) }, null, 1) + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), at = a.indexOf('--docs'), docs = at >= 0 ? a[at + 1] : process.env.TERRA_DOCS;
  if (!docs) { console.error('--docs <terra-docs 체크아웃> (또는 TERRA_DOCS)'); process.exit(2); }
  const rd = (n) => parseCsv(readFileSync(join(docs, MAP, n), 'utf8'));
  const out = render(rd('gui-coverage-cli.csv'), rd('cli-commands.csv'));
  if (a.includes('--check')) { const cur = readFileSync(OUTPUT, 'utf8'); if (cur !== out) { console.error('terra-words.json 이 지도와 다르다 — npm run gen:terra-words'); process.exit(1); } console.log('terra-words.json 같음'); }
  else { writeFileSync(OUTPUT, out); console.log('쓴 것 : ' + OUTPUT); }
}
