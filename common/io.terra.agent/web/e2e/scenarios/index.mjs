// 시나리오 등록부 — 이 폴더의 `*.mjs`(index 제외)를 모두 읽는다.
//
// 시나리오는 "모델의 응답"을 대본으로 쓴 것이다. 형태:
//
//   export default {
//     id: 'approval-flow',            // 파일 이름과 같게
//     title: '...', description: '...',
//     session: { autonomy: 'ask' },   // 이 시나리오를 돌리려면 세션을 이렇게 열라는 권고(강제 아님)
//     steps: [Step, ...] | (ctx) => Step | null,
//   }
//
//   Step = {
//     delayMs?,                       // 모델 응답 지연(실제 시간). 없으면 서버 기본(250ms)
//     text?,                          // assistant 줄
//     calls?: [{ operation_id, input?, reason?, delayMs?, outcome? } | { external: {server,tool,result_bytes?,read_only?}, ... }],
//     usage?: { input_tokens, output_tokens, cache_read_tokens, cache_write_tokens },
//     fail?: { message },             // 모델 호출 실패 → MODEL_UNAVAILABLE, 세션 failed
//     refuse?: { reason },            // 모델이 거절 → MODEL_REFUSED
//     truncated?: true,               // 토큰 한도에서 잘림 → MODEL_TRUNCATED
//     sent_bytes?,                    // model 줄의 나간 바이트
//     when?: 'ok'|'approved'|'denied'|'refused'|'error'|'timeout'|'planned' | [..],  // 직전 호출 묶음의 결과가 맞을 때만
//   }
//
// 대본이 끝났는데 호출이 남았으면 모델은 호출 없이 끝낸다(done). 함수형 steps 는 ctx = {turn, step, outcomes, last, userText, session}.
// kind:'seed' 인 시나리오는 턴이 아니라 "이미 쌓인 세션"을 만든다(seed(engine, {session_id, owner})).

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export function checkScenario(scenario, file) {
  const problems = [];
  if (!scenario || typeof scenario !== 'object') return [`${file}: default export 가 객체가 아니다`];
  if (typeof scenario.id !== 'string' || scenario.id === '') problems.push('id 가 없다');
  if (file && scenario.id !== file.replace(/\.mjs$/, '')) problems.push(`id(${scenario.id})가 파일 이름과 다르다`);
  if (typeof scenario.title !== 'string') problems.push('title 이 없다');
  if (scenario.kind === 'seed') {
    if (typeof scenario.seed !== 'function') problems.push('kind:seed 인데 seed() 가 없다');
  } else if (!(Array.isArray(scenario.steps) || typeof scenario.steps === 'function')) {
    problems.push('steps 가 배열도 함수도 아니다');
  } else if (Array.isArray(scenario.steps)) {
    scenario.steps.forEach((step, index) => {
      if (typeof step !== 'object' || step === null) problems.push(`steps[${index}] 가 객체가 아니다`);
      else for (const call of step.calls ?? []) if (!call.operation_id && !call.external) problems.push(`steps[${index}].calls 에 operation_id 도 external 도 없다`);
    });
  }
  return problems.map((p) => (file ? `${file}: ${p}` : p));
}

export async function loadScenarios(dir = HERE) {
  const map = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs').sort()) {
    const module = await import(join(dir, file).replaceAll('\\', '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
    const problems = checkScenario(module.default, file);
    if (problems.length > 0) throw new Error(`시나리오 오류\n${problems.join('\n')}`);
    map.set(module.default.id, module.default);
  }
  return {
    get: (id) => map.get(id),
    ids: () => [...map.keys()],
    list: () => [...map.values()].map((s) => ({ id: s.id, title: s.title, description: s.description ?? '', kind: s.kind ?? 'turn', session: s.session ?? {} })),
  };
}
