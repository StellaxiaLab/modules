// 받기 조각 보관 — 페이지를 닫아도 이 브라우저에 받은 만큼은 남아, 같은 파일을 다시 받으면 거기서부터 잇는다(구현해야 할 것 MD-21).
//
//   IndexedDB  terra.gui.parts
//     meta     key → { key, sha, size, tid, at }   서버가 받기를 열 때 준 SHA-256 · 크기, 그때의 전송 id, 마지막으로 쓴 때
//     chunks   [key, offset] → { key, offset, bytes } 받은 조각 (조각마다 SHA-256 을 견준 뒤에만 넣는다)
//   key        '<node_id>|<공유 폴더>/<경로>'
//
// 잇는 조건: 새로 연 받기의 SHA-256 · 크기가 저장본과 같다 — 파일이 그 사이 바뀌었으면 저장본을 버리고 처음부터 받는다.
// 0부터 빈틈없이 이어진 조각만 쓴다. 이레 넘게 손대지 않은 저장본은 지운다.
// IndexedDB 가 없거나 막혔으면(사생활 창 · 저장소 거절) openParts 는 null — 받기는 메모리로만 한다(예전과 같다).

const NAME = 'terra.gui.parts';
const KEEP_MS = 7 * 24 * 3600 * 1000;

/**
 * @typedef {{ offset: number, chunks: Uint8Array[], tid: string|null }} Kept  open 이 돌려주는 것 — 이어 받을 자리 · 그때까지의 조각 · 앞서 받던 전송 id
 * @typedef {{
 *   open(key: string, want: { sha: string, size: number, tid: string }): Promise<Kept>,
 *   add(key: string, offset: number, bytes: Uint8Array): Promise<boolean>,
 *   drop(key: string): Promise<void>
 * }} PartStore
 */

/**
 * @param {any} [g]  indexedDB · IDBKeyRange 를 가진 곳 (브라우저 = globalThis)
 * @param {() => number} [now]
 * @returns {PartStore|null}
 */
export function openParts(g = globalThis, now = () => Date.now()) {
  const idb = g && g.indexedDB, KR = g && g.IDBKeyRange;
  if (!idb || typeof idb.open !== 'function' || !KR) return null;
  let dbp = null;
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort')); });
  const range = (key) => KR.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    let q;
    try { q = idb.open(NAME, 1); } catch (e) { rej(e); return; }
    q.onupgradeneeded = () => {
      const d = q.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: ['key', 'offset'] });
    };
    q.onsuccess = () => { res(q.result); void sweep(q.result); };
    q.onerror = () => rej(q.error);
    q.onblocked = () => rej(new Error('blocked'));
  }).catch((e) => { dbp = null; throw e; }));
  // 오래된 저장본 — 받다 말고 다시 오지 않은 파일. 열 때 한 번 치운다
  const sweep = async (d) => {
    try {
      const tx = d.transaction(['meta', 'chunks'], 'readwrite'), M = tx.objectStore('meta'), C = tx.objectStore('chunks');
      const all = await req(M.getAll());
      all.filter((m) => !(m.at > now() - KEEP_MS)).forEach((m) => { M.delete(m.key); C.delete(range(m.key)); });
      await done(tx);
    } catch { /* 치우지 못해도 받기는 된다 */ }
  };
  return {
    async open(key, want) {
      const d = await db();
      const tx = d.transaction(['meta', 'chunks'], 'readwrite'), M = tx.objectStore('meta'), C = tx.objectStore('chunks');
      const m = await req(M.get(key));
      const chunks = [];
      let offset = 0;
      if (m && m.sha === want.sha && m.size === want.size) {
        const rows = (await req(C.getAll(range(key)))).sort((a, b) => a.offset - b.offset);
        for (const r of rows) {
          if (r.offset !== offset) break;
          const b = r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes);
          if (!b.length || offset + b.length > want.size) break;
          chunks.push(b); offset += b.length;
        }
      } else if (m) C.delete(range(key));   // 파일이 바뀌었다 — 받아 둔 것을 버린다
      M.put({ key, sha: want.sha, size: want.size, tid: want.tid, at: now() });
      await done(tx);
      return { offset, chunks, tid: m ? m.tid || null : null };
    },
    async add(key, offset, bytes) {
      try {
        const d = await db();
        const tx = d.transaction(['meta', 'chunks'], 'readwrite'), M = tx.objectStore('meta'), C = tx.objectStore('chunks');
        C.put({ key, offset, bytes });
        const m = await req(M.get(key));
        if (m) M.put(Object.assign(m, { at: now() }));
        await done(tx);
        return true;
      } catch { return false; }   // 저장소가 찼다 · 막혔다 — 이 받기는 메모리로만 마친다
    },
    async drop(key) {
      try {
        const d = await db();
        const tx = d.transaction(['meta', 'chunks'], 'readwrite');
        tx.objectStore('meta').delete(key);
        tx.objectStore('chunks').delete(range(key));
        await done(tx);
      } catch { /* 다음에 열 때 SHA-256 이 다르면 버린다 · 이레 뒤 치운다 */ }
    }
  };
}
