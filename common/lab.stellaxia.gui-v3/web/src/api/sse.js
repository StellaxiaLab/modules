// Server-Sent Events 읽기 — Gateway 의 operation 호출을 Accept: text/event-stream 으로 부르면 제공자(Daemon)의 SSE 를 그대로 흘려 준다
//   (Gateway server.go relayInvocation · stream.go streamCopy). 브라우저 EventSource 는 POST · 헤더(자격)를 못 싣기 때문에 fetch 로 읽는다.
//
//   프레임   id: <seq>  ·  event: <이름>  ·  data: <JSON>  ·  빈 줄로 끝. ':' 로 시작하는 줄은 주석(': subscribed …' · ': keep-alive')
//   쓰는 곳  terra.daemon.events.get(밀어 받기 · push.js) · terra.daemon.tasks.by-task-id.output.events.get(작업 출력 따라가기 · task-follow.js)
//
// WebSocket 길(terra.js stream() — 스트림 티켓)은 제공자가 WebSocket 을 낼 때만 닿는다. 위 둘은 SSE 라 이 길로 읽는다.

/** 조각을 받아 이벤트로 — 여러 번 나눠 와도 된다. @returns {{ feed(text: string): { id: string, event: string, data: any, raw: string }[], comments: string[] }} */
export function sseParser() {
  let buf = '', id = '', event = '', data = [];
  const comments = [];
  const out = [];
  const flush = () => {
    if (!data.length && !event) return;
    const raw = data.join('\n'); let v = raw;
    try { v = raw ? JSON.parse(raw) : null; } catch { v = raw; }
    out.push({ id, event: event || 'message', data: v, raw });
    event = ''; data = [];   // id 는 다음 이벤트로 이어진다(SSE 규칙 — 마지막 id)
  };
  return {
    comments,
    feed(text) {
      buf += String(text).replace(/\r\n?/g, '\n'); out.length = 0;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (line === '') { flush(); continue; }
        if (line[0] === ':') { comments.push(line.slice(1).trim()); if (comments.length > 20) comments.shift(); continue; }
        const c = line.indexOf(':'), k = c < 0 ? line : line.slice(0, c); let v = c < 0 ? '' : line.slice(c + 1); if (v[0] === ' ') v = v.slice(1);
        if (k === 'data') data.push(v); else if (k === 'event') event = v; else if (k === 'id') id = v;
      }
      return out.slice();
    },
  };
}
