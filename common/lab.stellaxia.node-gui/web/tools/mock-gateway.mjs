#!/usr/bin/env node
// 연습용 가짜 Gateway — 실제 Gateway 없이 LiveSource 연동(?live=1)을 시험한다.
// 사용: node tools/mock-gateway.mjs [포트=8790]  →  node.html?live=1&gw=http://127.0.0.1:8790
// 응답 모양은 src/api/adapters.js 가 기대하는 모양(⚠ 실제 Gateway와 다를 수 있다). 상태는 메모리에만.
import http from 'node:http';

const port = Number(process.argv[2] || 8790);
const db = {
  devices: [
    { id: 'mouse-046d-c52b-3fa1c2d0', kind: 'mouse', name: 'MX Master 3', presence: 'present', approval: 'approved', enabled: true },
    { id: 'raw_bus-1a86-7523-51c0de77', kind: 'raw_bus', name: 'USB 시리얼 (CH340)', presence: 'present', approval: 'pending', enabled: false }
  ],
  modules: [
    { id: 'io.terra.file', name: '파일', version: '1.4.0', state: 'running', trust: 'core' },
    { id: 'io.terra.virtual-device', name: '가상 장치', version: '0.6.0', state: 'failed', trust: 'core', last_error: 'uinput 권한' }
  ]
};
const ops = {
  'terra.gateway.health.get': () => ({ status: 'ok', auth: { mode: 'password' } }),
  'terra.daemon.io.devices.get': () => ({ devices: db.devices }),
  'terra.daemon.modules.get': () => ({ modules: db.modules }),
  'terra.daemon.io.devices.by-device-id.approve.post': (b) => set(db.devices, b.device_id, { approval: 'approved' }),
  'terra.daemon.io.devices.by-device-id.enable.post': (b) => set(db.devices, b.device_id, { enabled: true }),
  'terra.daemon.io.devices.by-device-id.disable.post': (b) => set(db.devices, b.device_id, { enabled: false }),
  'terra.daemon.io.devices.by-device-id.deny.post': (b) => set(db.devices, b.device_id, { approval: 'denied', enabled: false }),
  'terra.gateway.modules.by-module-id.restart.post': (b) => set(db.modules, b.module_id, { state: 'running', last_error: '' })
};
function set(list, id, patch) { const x = list.find((d) => d.id === id); if (!x) return { status: 404 }; Object.assign(x, patch); return { ok: true }; }

http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Terra-Confirm');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/api/v1/catalog') return send(200, { operations: Object.keys(ops).map((id) => ({ id })) });
    const m = /^\/api\/(?:v1|nodes\/[^/]+)\/operations\/([^/]+)\/invoke$/.exec(req.url);
    if (!m) return send(404, { code: 'NOT_FOUND' });
    const f = ops[decodeURIComponent(m[1])];
    if (!f) return send(501, { code: 'NOT_IMPLEMENTED_IN_MOCK' });
    const out = f(body ? JSON.parse(body) : {});
    if (out && out.status === 404) return send(404, { code: 'NOT_FOUND' });
    console.log('[mock-gateway]', decodeURIComponent(m[1]));
    send(200, out);
  });
}).listen(port, '127.0.0.1', () => console.log(`가짜 Gateway: http://127.0.0.1:${port}`));
