// 외부 MCP 도구 — Gateway 감사에 없다(I12). external 줄: server·result_bytes, note 에 "no gateway audit".
// 세션은 mcp_servers: ['<등록한 서버>'] 로 열어야 한다 — 먼저 PUT /mcp/servers/{server} 로 등록한다(agent.external 권한).
export default {
  id: 'external-call',
  title: '외부 MCP 호출',
  description: '읽기 전용 외부 도구 호출(묻지 않고 돈다) → external 줄(server, result_bytes) → 답.',
  session: { autonomy: 'ask', mcp_servers: ['fake-mcp'] },
  steps: [
    { text: '외부 서버에서 읽어 옵니다.', calls: [{ external: { server: 'fake-mcp', tool: 'read_file', result_bytes: 2048, read_only: true }, input: { path: 'README' }, reason: '문서를 읽습니다' }] },
    { text: '외부 서버가 2048바이트를 돌려주었습니다.' },
  ],
};
