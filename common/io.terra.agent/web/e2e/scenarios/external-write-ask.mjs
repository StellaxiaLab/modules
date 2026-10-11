// 외부 쓰기 도구 — 승인 카드가 서지만 **계약 사실이 없다**(contract 키 없음: Gateway 계약이 없는 도구).
export default {
  id: 'external-write-ask',
  title: '외부 쓰기 승인',
  description: 'ask 세션: 외부 write_file 에 카드가 서고 contract 가 없다 → "계약 사실을 읽지 못했다".',
  session: { autonomy: 'ask', mcp_servers: ['fake-mcp'] },
  steps: [
    { text: '외부 서버에 씁니다.', calls: [{ external: { server: 'fake-mcp', tool: 'write_file', result_bytes: 64 }, input: { path: 'out.txt' }, reason: '결과를 저장합니다' }] },
    { when: 'approved', text: '저장했습니다.' },
    { when: ['denied', 'timeout'], text: '저장하지 않았습니다.' },
  ],
};
