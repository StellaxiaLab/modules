#!/usr/bin/env node
// 연기 시험(smoke) — 모든 페이지가 오류 없이 뜨고, 시작 화면 → 노드 화면 흐름과 노드 화면의 주요 흐름이 도는지 본다.
// Terra 밖(단독)에서 돈다 — 닿을 게이트웨이가 없으니 세계는 비어 있어야 하고, 예시 데이터가 하나도 보이면 안 된다.
// 실데이터 · Terra frame 안의 흐름은 실제 스택 E2E로 본다(docs/guides/testing.md).
// 사용: npm install && npx playwright install chromium && npm run test:smoke
// 자체 정적 서버(포트 4173)를 띄우므로 dev 서버가 없어도 된다. 스크린숏은 tests/shots/
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/pages.json' || p === '/config.json') p = '/public' + p;
  try { const buf = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(buf); }
  catch { res.writeHead(404); res.end(); }
}).listen(4173);
const BASE = 'http://127.0.0.1:4173/';
await mkdir(join(ROOT, 'tests/shots'), { recursive: true });

/** 예전 예시 데이터에만 있던 이름 · 값 — 화면 어디에도 나오면 안 된다 (tests/live.test.mjs 와 같은 목록) */
const EXAMPLE = /edge-01|nas-01|tree-home|tree-lab|tree-office|tree-cloud|tree-backup|gpu-0\d|laptop-03|build-srv|bench-pi|MX Master|기계식 키보드|CH340|예전 마우스|오늘 할 일|회의 메모|맵 아이디어|J-2031|T-118|SMB 공유|RTSP 카메라|벤치 대시보드|maru|21:40|minji|ci-bot|claude-agent|node_7f3a|10\.60\.0|203\.0\.113|100\.80\.0|나무 울타리|횃불 \(불꽃\)|예시 데이터|시연/;

// 브라우저 경로를 따로 줄 때: PW_CHROMIUM=/경로/chrome npm run test:smoke
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1447, height: 945 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : '')); if (!ok) fails++; };

const pages = JSON.parse(await readFile(join(ROOT, 'public/pages.json'), 'utf8'));
for (const p of pages.filter((x) => x.page !== 'node.html' && x.page !== 'index.html')) {
  const before = errors.length;
  await page.goto(BASE + p.page); await page.waitForTimeout(1200);
  const txt = await page.evaluate(() => document.querySelector('#stage').innerText);
  check(p.title, txt.length > 50 && errors.length === before, '글자 ' + txt.length);
  check(p.title + ' — 예시 없음', !EXAMPLE.test(txt), (EXAMPLE.exec(txt) || [''])[0]);
}

// 시작 화면 — Terra 밖: 비밀번호 칸이 없고, 단추는 "둘러보기"다. 누르면 구름을 지나 노드 화면(빈 세계)으로 내려간다
await page.goto(BASE + 'index.html'); await page.waitForTimeout(1500);
check('시작 화면 — 비밀번호 칸 없음', await page.evaluate(() => !document.querySelector('input[type="password"], [data-in-pass], [data-in-user]')));
const introTxt = await page.evaluate(() => document.body.innerText);
check('시작 화면 — Terra 밖 표시', /Terra 밖에서 열었다/.test(introTxt));
check('시작 화면 — 예시 없음', !EXAMPLE.test(introTxt), (EXAMPLE.exec(introTxt) || [''])[0]);
await page.screenshot({ path: join(ROOT, 'tests/shots/intro.png') });
await page.click('[data-in-go]'); await page.waitForTimeout(9000);
const mapOn = await page.evaluate(() => { const fr = document.querySelector('[data-in-map]'); try { return !!(fr && fr.contentDocument && fr.contentDocument.querySelector('[data-node-root]')); } catch { return false; } });
check('시작 화면 → 노드 화면으로 내려감', mapOn);
await page.screenshot({ path: join(ROOT, 'tests/shots/intro-fly.png') });

// 노드 화면 — 단독: 빈 세계
await page.goto(BASE + 'node.html'); await page.waitForTimeout(2500);
await page.screenshot({ path: join(ROOT, 'tests/shots/node.png') });
const st = await page.evaluate(() => { const S = window.__screen.state; return { placed: Object.keys(S.placed).length, rsrc: Object.keys(S.rsrc || {}).length, links: (S.links || []).length, memos: S.memos.length, alarms: S.alarms.length, trees: S.trees.length, json: JSON.stringify(S) }; });
check('노드 화면 — 빈 세계(장식 · 자원 · 연결 · 메모 · 알림 없음)', st.placed + st.rsrc + st.links + st.memos + st.alarms + st.trees === 0, JSON.stringify({ placed: st.placed, rsrc: st.rsrc, links: st.links, memos: st.memos, alarms: st.alarms, trees: st.trees }));
check('노드 화면 — 상태에 예시 없음', !EXAMPLE.test(st.json), (EXAMPLE.exec(st.json) || [''])[0]);
check('노드 화면 — 글에 예시 없음', !EXAMPLE.test(await page.evaluate(() => document.body.innerText)));
// 조타륜 올리기 → 가운데 로고 → 앱 바
await page.locator('[data-hx-name]').click(); await page.waitForTimeout(1300);
const cv = await page.locator('[data-hx-cv]').boundingBox(); const k = cv.width / 600;
await page.mouse.click(cv.x + 300 * k, cv.y + 65 * k); await page.waitForTimeout(800);
check('조타륜 앱 바', await page.evaluate(() => !!document.querySelector('[data-hb-key]')));
// 앱 전체 화면 → 리스트에 들어감 → 파인 곳 눌러 맵으로
await page.evaluate(() => document.querySelector('[data-hb-fs]').click()); await page.waitForTimeout(600);
check('조타륜 앱 전체 화면', await page.evaluate(() => !!document.querySelector('section.fs-hb')));
await page.mouse.click(723, 70); await page.waitForTimeout(500);
check('파인 곳 → 맵', await page.evaluate(() => !document.querySelector('[data-fs-notch]')));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
// 폴더 보관함 → 메모장 → 새 메모 저장 (로그인 전이라 이 화면 안에만 남는다)
await page.locator('[data-fb-pod]').click(); await page.waitForTimeout(600);
await page.locator('[data-fb-go="memo"]').click(); await page.waitForTimeout(300);
await page.locator('[data-fb-new]').click(); await page.waitForTimeout(400);
await page.locator('[data-memo-name]').fill('연기 시험'); await page.locator('[data-memo-text]').fill('한 줄');
await page.locator('[data-memo-save]').click(); await page.waitForTimeout(300);
check('메모 저장', await page.evaluate(() => !!document.querySelector('[data-fb-row="연기 시험.md"]')));
await page.screenshot({ path: join(ROOT, 'tests/shots/folder-memo.png') });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
// 오버헤드 패널 접기 · 펴기 (오른쪽 위 손잡이) — 로그인하면 사용자마다 저장된다(LayoutStore ovhHide)
await page.locator('[data-ovh-handle]').click(); await page.waitForTimeout(1000);
const folded = await page.evaluate(() => window.__screen.state.ovhHide);
await page.locator('[data-ovh-handle]').click(); await page.waitForTimeout(1000);
check('오버헤드 패널 접기 · 펴기', folded === true && (await page.evaluate(() => window.__screen.state.ovhHide)) === false);
// 상태 화면 — 이 노드 칸. 로그인 전이라 권한 · 공유 목록은 비어 있고 예시가 없다
await page.evaluate(() => window.__screen.rstOpen({ kind: 'node', key: window.__screen.state.self })); await page.waitForTimeout(500);
const rst = await page.evaluate(() => { const el = document.querySelector('[data-rst]'); return el ? el.innerText : ''; });
check('상태 화면 — 이 노드 (로그인 전)', /이 노드/.test(rst) && /로그인 전/.test(rst) && !/로그인됨/.test(rst), rst.slice(0, 80).replace(/\n/g, ' '));
check('상태 화면 — 예시 없음', !EXAMPLE.test(rst), (EXAMPLE.exec(rst) || [''])[0]);
await page.screenshot({ path: join(ROOT, 'tests/shots/status.png') });
await page.evaluate(() => window.__screen.closeWin('rst')); await page.waitForTimeout(300);
// 전체 화면 보드(도로 편집기) — 단독이면 src 로 연다. 보드 안의 "← 노드 화면"은 중첩 노드 화면이 아니라 전체 화면 끝으로
await page.evaluate(() => window.__screen.fsEnter('rd')); await page.waitForTimeout(2500);
const rdBoard = await page.evaluate(() => { const f = document.querySelector('iframe.win-fs-full'); return f ? { src: f.getAttribute('src'), text: f.contentDocument ? f.contentDocument.body.innerText.slice(0, 200) : '' } : null; });
check('도로 편집기 보드', !!rdBoard && rdBoard.src === 'road.html' && /도로 편집기/.test(rdBoard.text), rdBoard && rdBoard.src);
await page.evaluate(() => { const f = document.querySelector('iframe.win-fs-full'); const a = [...f.contentDocument.querySelectorAll('a[href]')].find((x) => /node\.html$/.test(x.getAttribute('href'))); a && a.click(); });
await page.waitForTimeout(600);
check('보드의 ← 노드 화면 → 전체 화면 끝', await page.evaluate(() => !window.__screen.state.fs && !document.querySelector('iframe.win-fs-full')));
// 창 크기를 따라 늘고 준다 (기준 1447×945 · 최소 1180×280)
await page.setViewportSize({ width: 1700, height: 1000 }); await page.waitForTimeout(600);
check('화면 크기 = 창 크기', await page.evaluate(() => { const s = window.__screen.state.scr; return s.W === 1700 && s.H === 1000; }));
// 받기 조각 보관(src/store/parts.js · MD-21) — 진짜 IndexedDB. 두고 · 다시 열면(새 페이지처럼 새 객체) 0부터 이어진 조각과 앞선 전송 id ·
// 파일이 바뀌었으면(SHA-256) 버리고 · 다 받으면 지운다
const kept = await page.evaluate(async () => {
  const { openParts } = await import('/src/store/parts.js');
  const P = openParts();
  if (!P) return null;
  const k = 'node_t|share-0/x.bin', enc = (t) => new TextEncoder().encode(t), dec = (a) => a.map((b) => new TextDecoder().decode(b)).join('');
  await P.drop(k);
  const a = await P.open(k, { sha: 's1', size: 12, tid: 't1' });
  await P.add(k, 0, enc('abcd')); await P.add(k, 4, enc('efgh')); await P.add(k, 10, enc('kl'));   // 8~10 이 빠졌다 — 그 뒤는 쓰지 않는다
  const b = await openParts().open(k, { sha: 's1', size: 12, tid: 't2' });
  const c = await P.open(k, { sha: 's2', size: 12, tid: 't3' });
  await P.drop(k);
  const d = await P.open(k, { sha: 's2', size: 12, tid: 't4' });
  await P.drop(k);
  return JSON.stringify({ a: [a.offset, a.tid], b: [b.offset, b.tid, dec(b.chunks)], c: [c.offset, c.tid, c.chunks.length], d: [d.offset, d.tid] });
});
check('받기 조각 보관(IndexedDB) — 이어진 조각 · 앞선 전송 id · 바뀐 파일은 버림 · 지움',
  kept === JSON.stringify({ a: [0, null], b: [8, 't1', 'abcdefgh'], c: [0, 't2', 0], d: [0, null] }), kept);
check('페이지 오류 없음', errors.length === 0, errors.slice(0, 3).join(' / '));

await browser.close(); server.close();
console.log(fails ? `실패 ${fails}` : '모두 통과');
process.exit(fails ? 1 : 0);
