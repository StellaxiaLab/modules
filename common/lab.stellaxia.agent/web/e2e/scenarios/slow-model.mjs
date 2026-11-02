// 느린 응답 — 모델이 3초 뒤에 답한다(running 이 눈에 보인다). 지연은 /__control/config {model_delay_ms} 로도 바꾼다.
export default {
  id: 'slow-model',
  title: '느린 응답',
  description: '3초 뒤에 한 줄로 답한다. running 상태·입력 잠금·폴링 1초 주기를 보기 좋다.',
  steps: [{ delayMs: 3000, text: '오래 생각했습니다. 별일은 없습니다.' }],
};
