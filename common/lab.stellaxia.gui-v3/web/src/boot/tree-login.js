// 다른 Tree 로그인 — 실제 연결에서 TreeLogin 보드(시안 로직)를 덮는 클래스.
//   실제 연결에서는 시안(mock) 분기를 타지 않는다: 그 Tree 의 노드 id 가 없으면 '알 수 없음 · 까닭 코드'(주소를 지어내지 않는다),
//   있으면 실제 resolve op(terra.master.crossboundary.login-routes.by-node-id.resolve.post)를 부른다 (AUD-23)
export const NO_NODE_ID = 'NO_NODE_ID';
export const RESOLVE_OP = 'terra.master.crossboundary.login-routes.by-node-id.resolve.post';

export function makeTerraTreeLogin(Base, { terra, ridOf }) {
  return class TerraTreeLogin extends Base {
    login() {
      const R = this.route(), rid = ridOf(this.props.treeKey);
      if (!rid) { this.fail(null, { http: '', code: NO_NODE_ID, title: '알 수 없음 · ' + NO_NODE_ID, hint: 'Master 가 이 Tree 의 노드 id 를 알려 주지 않았다 — 로그인 주소를 지어내지 않는다', act: '' }); return; }
      if (!R.url) { this.fail(null, { http: '', code: 'NO_ROUTE', title: '로그인 주소가 없음', hint: R.needs ? '[주소 묻기] — 그 Tree 에 주소 요청' : 'Master 에 이 Tree 경로 없음 — 운영자에게 주소 받아 --url', act: '' }); return; }
      try { localStorage.setItem('terra.login.email', (this.state.email || '').trim()); } catch (e) {}
      this.setState({ phase: 'send', msg: '이동 중 : ' + R.url, bad: false, err: null });
      setTimeout(() => window.location.assign(R.url), 300);   // 그 Tree 의 GUI 에서 로그인 — 비밀번호는 그 Gateway 만 받는다
    }
    renderVals() {
      const v = super.renderVals(), rid = ridOf(this.props.treeKey);
      v.resolve = () => {
        if (!rid) { this.setState({ phase: null, resolved: false, url: null, msg: '알 수 없음 · ' + NO_NODE_ID }); return; }   // 요청도 주소도 만들지 않는다
        this.setState({ phase: 'ask' });
        terra.invoke(RESOLVE_OP, { node_id: rid })
          .then((r) => { const url = r && (r.login_url || (r.route && r.route.login_url)); this.setState({ phase: null, resolved: true, url: url || null, msg: url ? '' : '주소 없음 (이 Tree)' }); },
            (e) => this.setState({ phase: null, resolved: false, url: null, msg: '알 수 없음 · ' + ((e && (e.code || e.status)) || 'UNKNOWN') }));
      };
      return v;
    }
  };
}
