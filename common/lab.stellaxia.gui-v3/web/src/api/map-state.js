// 지도 상태 — 노드 목록을 받았는지 · 비었는지 · 못 봤는지를 사람이 읽을 한 줄로. 순수(창 · DOM 없음)
//   전에는 상단 상태 줄(StatusBar 보드)에 있었다. 줄을 없애며(11/15 사용자 결정) 제어기 › 설정 › GUI 로 옮겼다.
//   "못 봤음"(state 'error')과 "없음"(state 'empty')을 섞지 않는다 — 못 받은 지도를 빈 지도처럼 보이면 안 된다
//   입력: real(실제 Gateway 인지 · 아니면 시안) · state(window.TerraTopologyState: { state: 'ok'|'empty'|'error', error?, at })
//         records(지도 노드 기록) · nodeStats(기록 → { level }) · okAt(마지막으로 받은 시각, 부르는 쪽이 들고 있다) · ago(시각 → '방금' 같은 글)
//   출력: { tone: ok|warn|err|off, stat(한 줄), head · sub(자세히, 없으면 ''), card('err' 못 받음+지도 비어 있음 · 'empty' 정말 없음 · '' 없음 — 장면 가운데 카드), canRetry, okAt(다음에 넘길 값) }
export function mapState({ real, state, records = [], nodeStats, okAt = 0, ago = () => '' } = {}) {
  const TS = state || null;
  if (TS && TS.state === 'ok') okAt = TS.at;
  const n = records.length, down = nodeStats ? records.filter((r) => nodeStats(r).level === 'down').length : 0;
  let tone, stat, head = '', sub = '', card = '';
  if (!real) { tone = 'off'; stat = '시안 데이터'; }
  else if (!TS) { tone = 'off'; stat = '지도 받는 중…'; }
  else if (TS.state === 'error') {
    tone = 'err'; stat = '노드 목록 못 봤음' + (okAt ? ' · ' + ago(okAt) + ' 사본' : '');
    head = n ? '마지막으로 받은 지도를 보이는 중' : '노드 목록을 받지 못함'; if (!n) card = 'err';
    sub = (n ? '지금 지도는 ' + (okAt ? ago(okAt) + ' ' : '') + '사본입니다. ' : '빈 지도가 아니라 못 본 상태입니다. ') + 'Master 연결과 권한을 확인한 뒤 다시 시도하세요.' + (TS.error ? ' (' + TS.error + ')' : '');
  }
  else if (TS.state === 'empty') { tone = 'off'; stat = '노드 없음'; card = 'empty'; head = '이 Tree 에 노드 없음'; sub = '노드를 등록하면 지도에 나타납니다.'; }
  else { tone = down ? 'warn' : 'ok'; stat = '노드 ' + n + (down ? ' · 연결 안 됨 ' + down : '') + ' · ' + ago(TS.at); }
  // 실시간 스트림(TS.live — live-stream.js 상태)이 끊겼으면 받은 지도가 있어도 '지금 그대로'라고 하지 않는다 — 마지막으로 받은 시각만 믿을 수 있다
  const L = TS && TS.live && TS.live.state;
  if (real && TS && TS.state !== 'error' && (L === 'lost' || L === 'closed')) {
    if (tone === 'ok') tone = 'warn';
    stat += L === 'lost' ? ' · 실시간 끊김' : ' · 실시간 닫힘';
    if (!head) head = L === 'lost' ? '실시간 스트림이 끊겨 30초마다 다시 받는 중' : (TS.live.text || '이벤트 스트림 닫힘') + ' — 30초마다 다시 받는 중';
    if (!sub) sub = '스트림이 끊긴 동안의 변화는 보지 못했을 수 있습니다. 마지막으로 받은 시각 ' + (okAt ? ago(okAt) : '—') + '.';
  }
  return { tone, stat, head, sub, card, canRetry: !!real && !!TS && TS.state === 'error', okAt };
}
