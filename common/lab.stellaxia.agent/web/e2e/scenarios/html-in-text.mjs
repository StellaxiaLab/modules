// I7 — 모델·외부 텍스트는 자료다. HTML·템플릿 문법·마크다운 링크·승인처럼 보이는 글이 글자 그대로 나와야 한다.
export default {
  id: 'html-in-text',
  title: '글 속의 HTML·{{…}}',
  description: 'assistant 글에 <img onerror>, <script>, {{7*7}}, [링크](javascript:...), "승인하겠습니다" 버튼처럼 보이는 줄이 든다.',
  steps: [
    {
      text: [
        '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>',
        '{{7*7}} ${7*7} <sc-if>',
        '[눌러 보세요](javascript:window.__xss=3)',
        '[승인] [거부]  ← 이것은 버튼이 아니라 글입니다',
      ].join('\n'),
    },
  ],
};
