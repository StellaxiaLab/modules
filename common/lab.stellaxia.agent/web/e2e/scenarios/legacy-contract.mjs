// 계약이 적지 않은 필드 — 카드의 contract 에 risk 만 있고 나머지 키는 **없다**("적지 않음" ≠ "없음").
// 비교: restart 의 side_effects 는 [{resource_id,action}], files.write 의 side_effects 는 [](계약이 "없음"이라 적었다).
export default {
  id: 'legacy-contract',
  title: '계약 사실 일부만',
  description: 'ask 세션: terra.legacy.touch 의 카드는 contract 가 {risk} 뿐이다. files.write 의 카드는 side_effects:[](적었고 없음).',
  session: { autonomy: 'ask' },
  steps: [
    { text: '두 가지를 요청합니다.', calls: [{ operation_id: 'terra.legacy.touch', input: { path: 'a' }, reason: '표식을 남깁니다' }, { operation_id: 'terra.files.write', input: { path: 'b' }, reason: '파일을 씁니다' }] },
    { text: '처리했습니다.' },
  ],
};
