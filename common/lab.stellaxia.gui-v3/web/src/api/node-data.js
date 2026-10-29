// GUI v3 백엔드(lab.stellaxia.gui-v3) 클라이언트 — 노드에 붙는 GUI 데이터(프로필 사진 · 노드 속성).
//
// 계약: ../../../contracts/api/terra-api.json · 설계: ../../../docs/design/backend.md
// 화면은 이 파일만 부른다 — 캔버스 시안(web/design)의 localStorage 흉내('terra.fs' · 'terra.fs.f.*')가
// 실제 웹 빌드에서 이 호출로 바뀐다.
//
// request 는 frame 클라이언트가 준다: (method, path, body?) => Promise<object>. 상대 경로에만 Bearer 를
// 붙이는 frame 규칙을 그대로 쓰므로 여기서는 자격을 다루지 않는다. 오류는 { error: { code, message } }
// 응답을 NodeDataError 로 던진다.

export const MODULE_ID = 'lab.stellaxia.gui-v3';
export const DATA_PREFIX = '/데이터';

export class NodeDataError extends Error {
  constructor(code, message, status) {
    super(message || code);
    this.name = 'NodeDataError';
    this.code = code;
    this.status = status;
  }
}

/** 이 노드면 '/api/modules/<id>/v1', 다른 노드면 '/api/nodes/<노드>/modules/<id>/v1' (Master 중계). */
export function apiBase(nodeId) {
  return nodeId ? `/api/nodes/${encodeURIComponent(nodeId)}/modules/${MODULE_ID}/v1` : `/api/modules/${MODULE_ID}/v1`;
}

const q = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const t = s.toString();
  return t ? '?' + t : '';
};

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
}

/** 파일 이름 정리 — 백엔드와 같은 규칙(Windows 금지 문자 · 점 시작 · 길이). */
export function safeName(name) {
  const n = String(name || 'profile').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '_').slice(0, 120);
  return n || 'profile';
}

/**
 * @param {(method: string, path: string, body?: object) => Promise<any>} request
 * @param {{ nodeId?: string }} [opts] nodeId 를 주면 그 노드의 v3 백엔드를 부른다
 */
export function createNodeData(request, opts = {}) {
  const base = apiBase(opts.nodeId);
  const call = async (method, path, body) => {
    const out = await request(method, base + path, body);
    if (out && out.error) throw new NodeDataError(out.error.code, out.error.message, out.status);
    return out;
  };
  let limits = null;

  const api = {
    status: () => call('GET', '/status'),
    async limits() {
      if (!limits) limits = await api.status();
      return limits;
    },
    props: async () => (await call('GET', '/node/props')).props || {},
    /** set: { 키: 값 | null } — 전부 적용되거나 전부 안 된다 */
    patchProps: async (set) => (await call('PATCH', '/node/props', { set })).props || {},
    files: async (dir) => (await call('GET', '/node/files' + q({ dir }))).entries || [],
    file: (path) => call('GET', '/node/files/content' + q({ path })),
    remove: (path) => call('DELETE', '/node/files/content' + q({ path })),

    /**
     * 그림 올리기 — status 의 maxChunkBytes(원시 640 KiB) 단위로 나눠 보낸다. CHUNK_OUT_OF_ORDER 면
     * 응답의 received 부터 한 번 이어 보낸다.
     * @param {string} path  /데이터 상대 경로
     * @param {Uint8Array} bytes
     * @param {string} [mime]
     * @param {(sent: number, total: number) => void} [onProgress]
     */
    async put(path, bytes, mime, onProgress) {
      const L = await api.limits();
      if (!bytes.length) throw new NodeDataError('TYPE_DENIED', '빈 파일');
      if (bytes.length > L.maxFileBytes) throw new NodeDataError('TOO_LARGE', `파일 하나 한도 ${L.maxFileBytes} 바이트를 넘는다`);
      const step = L.maxChunkBytes || 640 * 1024, total = bytes.length;
      let offset = 0, retried = false, last = null;
      while (offset < total) {
        const chunk = bytes.subarray(offset, Math.min(total, offset + step));
        try {
          last = await call('PUT', '/node/files/content', { path, mime: mime || undefined, data: toBase64(chunk), offset, total });
        } catch (e) {
          if (e.code === 'CHUNK_OUT_OF_ORDER' && !retried) { retried = true; offset = 0; continue; }
          throw e;
        }
        offset = last.received;
        if (onProgress) onProgress(offset, total);
        if (last.done) break;
      }
      return last && last.entry;
    },

    /**
     * 프로필 바꾸기 — put → props.patch → 지난 그림 delete (backend.md §5 의 순서).
     * file 이 null 이면 프로필을 지운다(속성 먼저, 그다음 그림).
     * @param {{ name: string, type?: string, bytes: Uint8Array } | null} file
     * @returns {Promise<string>} 새 profile.image ('' = 없음)
     */
    async setProfile(file, onProgress) {
      const before = (await api.props()).profile;
      const old = before && typeof before.image === 'string' && before.image.startsWith(DATA_PREFIX + '/') ? before.image.slice(DATA_PREFIX.length + 1) : '';
      if (!file) {
        await api.patchProps({ profile: null });
        if (old) await api.remove(old).catch(() => {});
        return '';
      }
      const rel = 'profile/image/' + safeName(file.name);
      await api.put(rel, file.bytes, file.type, onProgress);
      const image = DATA_PREFIX + '/' + rel;
      await api.patchProps({ profile: { image } });
      if (old && old !== rel) await api.remove(old).catch(() => {});
      return image;
    },

    /** 프로필 그림을 data URL 로 (트리 뷰 · 설정 창 미리보기) — 없으면 '' */
    async profileDataURL() {
      const p = (await api.props()).profile;
      if (!p || typeof p.image !== 'string' || !p.image.startsWith(DATA_PREFIX + '/')) return '';
      try {
        const f = await api.file(p.image.slice(DATA_PREFIX.length + 1));
        return `data:${f.mime};base64,${f.data}`;
      } catch (e) {
        if (e.code === 'NOT_FOUND') return '';
        throw e;
      }
    },
  };
  return api;
}
