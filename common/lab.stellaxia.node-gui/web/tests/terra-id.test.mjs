// Terra ID (Tree 외부 신원 입구 P2 · P6-gui) — 응답 → 보기 모델, 오류 코드 → 글, 없음 vs 못 봤음
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const win = { localStorage: { getItem() { return null; }, setItem() {} }, addEventListener() {}, removeEventListener() {} };
win.parent = win;
globalThis.window = win;

const { TERRA_ID_OPS, TRUST_EMPTY_TEXT, issuersView, identitiesView, externalErrorText, linkStatusTag, issuerAddBody, pinnedJwks, tokenPeek, audIsTree } = await import('../src/data/terra-id.js');
const { realSettings } = await import('../src/data/settings-live.js');

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jws = (claims) => b64u({ alg: 'EdDSA', kid: 'k1' }) + '.' + b64u(claims) + '.' + 'c2ln';

test('op 이름은 Master 경로에서 지은 것', () => {
  assert.deepEqual(TERRA_ID_OPS, {
    issuers: 'terra.master.admin.external-issuers.get',
    issuerAdd: 'terra.master.admin.external-issuers.post',
    issuerPatch: 'terra.master.admin.external-issuers.patch',
    issuerDelete: 'terra.master.admin.external-issuers.delete',
    links: 'terra.master.users.by-user-id.external-identities.get',
    link: 'terra.master.users.by-user-id.external-identities.post',
    unlink: 'terra.master.users.by-user-id.external-identities.delete'
  });
});

test('신뢰 목록 — 빈 목록은 없음(기본), 오류 · 길 없음은 못 봤음, 403은 숨김', () => {
  assert.equal(issuersView({ kind: 'ok', data: { issuers: [] } }).state, 'empty');
  assert.equal(issuersView({ kind: 'ok', data: [] }).state, 'empty');
  for (const r of [null, { kind: 'error', status: 404, reason: 'NOT_FOUND' }, { kind: 'unavailable', reason: 'not-in-catalog' }, { kind: 'unreachable' }, { kind: 'ok', data: {} }]) {
    assert.equal(issuersView(r).state, 'unseen', JSON.stringify(r));
  }
  assert.equal(issuersView({ kind: 'forbidden', status: 403, reason: 'FORBIDDEN' }).state, 'denied');
  // 위임 입구가 닫은 것은 "권한 없음"이 아니라 못 봤음 — 카드는 숨기지 않는다
  assert.equal(issuersView({ kind: 'forbidden', status: 403, reason: 'DELEGATION_NOT_OPEN' }).state, 'unseen');
  assert.match(TRUST_EMPTY_TEXT, /비밀번호 로그인만/);
});

test('신뢰 목록 — 응답 한 줄 → 보기 모델 (기본 꺼짐 · 실효 aud · 키 id)', () => {
  const v = issuersView({ kind: 'ok', data: { issuers: [
    { issuer: 'https://id.terra.example', display_name: 'Terra ID', jwks_uri: '', audience: '', effective_audience: 'tree:t1', enabled: true, require_mfa: true, cached_at: '2026-10-29T09:05:00', key_ids: ['k1', 'k2'] },
    { issuer: 'https://other.example', audience: '' }
  ] } });
  assert.equal(v.state, 'ok');
  assert.equal(v.on, 1);
  const [a, b] = v.issuers;
  assert.deepEqual([a.issuer, a.name, a.audience, a.audienceSet, a.enabled, a.mfa, a.cachedAt, a.kids], ['https://id.terra.example', 'Terra ID', 'tree:t1', true, true, true, '2026-10-29 09:05', ['k1', 'k2']]);
  assert.deepEqual([b.enabled, b.mfa, b.audienceSet, b.kids, b.cachedAt], [false, false, false, [], '']);
});

test('내 연결 — 없음 vs 못 봤음, 상태 linked · suspended', () => {
  assert.equal(identitiesView({ kind: 'ok', data: { identities: [] } }).state, 'empty');
  assert.equal(identitiesView({ kind: 'error', status: 404 }).state, 'unseen');
  assert.equal(identitiesView(null).state, 'unseen');
  const v = identitiesView({ kind: 'ok', data: { identities: [
    { issuer: 'https://id.terra.example', subject: 'acct_1', status: 'linked', linked_at: '2026-10-29T10:00:00' },
    { issuer: 'https://id.terra.example', subject: 'acct_2', status: 'suspended' },
    { issuer: '', subject: 'broken' }
  ] } });
  assert.equal(v.identities.length, 2);
  assert.deepEqual(v.identities.map((x) => x.status), ['linked', 'suspended']);
  assert.equal(v.identities[0].linkedAt, '2026-10-29 10:00');
  assert.deepEqual(linkStatusTag('linked'), ['연결됨', 'ok']);
  assert.deepEqual(linkStatusTag('suspended'), ['정지됨', 'warn']);
});

test('오류 코드 → 쉬운 한국어 (코드는 괄호로 남긴다)', () => {
  const t = (code, kind = 'error') => externalErrorText({ kind, reason: code });
  assert.match(t('EXTERNAL_TOKEN_INVALID', 'unauthenticated'), /토큰을 받지 않았습니다.*\(EXTERNAL_TOKEN_INVALID\)$/);
  assert.match(t('EXTERNAL_IDENTITY_CONFLICT'), /이미 이 Tree의 다른 사용자에 연결/);
  assert.match(t('EXTERNAL_MFA_REQUIRED', 'forbidden'), /2단계 인증/);
  // 봉투 안의 코드도 읽는다
  assert.match(externalErrorText({ kind: 'error', data: { error: { code: 'EXTERNAL_MFA_REQUIRED' } } }), /MFA/);
  // 모르는 코드는 공통 글
  assert.match(externalErrorText({ kind: 'error', reason: 'SOMETHING' }), /SOMETHING/);
});

test('발급자 추가 본문 — enabled 를 보내지 않는다(기본 꺼짐) · 주소 · 고정 키 검사', () => {
  assert.equal(issuerAddBody({ issuer: '' }).ok, false);
  assert.equal(issuerAddBody({ issuer: 'id.terra.example' }).ok, false);
  const b = issuerAddBody({ issuer: ' https://id.terra.example/ ', name: 'Terra ID' });
  assert.deepEqual(b, { ok: true, body: { issuer: 'https://id.terra.example', display_name: 'Terra ID' } });
  assert.ok(!('enabled' in b.body));
  assert.equal(issuerAddBody({ issuer: 'http://localhost:9000' }).ok, true);
  assert.equal(issuerAddBody({ issuer: 'http://evil.example' }).ok, false);
  assert.equal(issuerAddBody({ issuer: 'https://a.example', jwks: 'ftp://x' }).ok, false);
  const p = issuerAddBody({ issuer: 'https://a.example', pinned: '{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"k1","x":"AA"}]}' });
  assert.equal(p.ok, true);
  assert.equal(p.body.pinned_jwks.keys[0].kid, 'k1');
  assert.equal(pinnedJwks('nope').ok, false);
  assert.equal(pinnedJwks('{"keys":[]}').ok, false);
});

test('붙여 넣은 토큰 — 모양과 aud 만 본다', () => {
  assert.equal(tokenPeek('').ok, false);
  assert.equal(tokenPeek('abc').ok, false);
  const t = tokenPeek('Bearer ' + jws({ iss: 'https://id.terra.example', aud: 'tree:t1', exp: 1 }));
  assert.equal(t.ok, true);
  assert.deepEqual([t.iss, t.aud, t.exp], ['https://id.terra.example', ['tree:t1'], 1]);
  assert.ok(!t.token.startsWith('Bearer'));
  assert.equal(audIsTree(t.aud), true);
  assert.equal(audIsTree(tokenPeek(jws({ aud: ['terra-id'] })).aud), false);
});

const cardTitles = (v) => v.cards.map((c) => c.title || c.big);

test('설정 보드 — 클러스터 탭: 신뢰 없음 문장 · 못 봤음 카드 · master_admin 아니면 숨김', async () => {
  const { default: Set_ } = await import('../src/screens/settings.js');
  const s = new (realSettings(Set_))({});
  Object.assign(s.state, { live: true, loading: false, role: 'tree', tab: 'cluster' });
  s.state.tidIss = issuersView({ kind: 'ok', data: { issuers: [] } });
  let v = s.renderVals();
  const trust = v.cards.find((c) => c.title === 'Terra ID 신뢰');
  assert.ok(trust, cardTitles(v).join(' | '));
  assert.equal(trust.rows[0].d, TRUST_EMPTY_TEXT);
  s.state.tidIss = issuersView({ kind: 'error', status: 404 });
  v = s.renderVals();
  assert.ok(v.cards.some((c) => c.big === 'Terra ID 신뢰 목록을 받지 못했습니다'), cardTitles(v).join(' | '));
  s.state.tidIss = issuersView({ kind: 'forbidden', reason: 'FORBIDDEN' });
  v = s.renderVals();
  assert.ok(!v.cards.some((c) => /Terra ID 신뢰/.test(c.title || c.big)), cardTitles(v).join(' | '));
  // 켜기는 확인 창을 거친다 — 교환 문이 열린다고 말한다
  s.state.tidIss = issuersView({ kind: 'ok', data: { issuers: [{ issuer: 'https://id.terra.example', effective_audience: 'tree:t1' }] } });
  v = s.renderVals();
  const row = v.cards.find((c) => c.title === 'Terra ID 신뢰').rows[0];
  row.btns.find((b) => b.label === '켜기').run();
  assert.ok(s.state.dlg);
  assert.match(s.state.dlg.warn, /\/api\/v1\/auth\/external\/exchange/);
  assert.match(s.state.dlg.warn, /연결한 Terra ID 계정뿐/);
});

test('설정 보드 — 계정 탭: Terra ID로 연결 카드 · 붙여 넣기 폼', async () => {
  const { default: Set_ } = await import('../src/screens/settings.js');
  const s = new (realSettings(Set_))({});
  Object.assign(s.state, { live: true, loading: false, role: 'leaf', tab: 'account' });
  s.state.tidLinks = identitiesView({ kind: 'ok', data: { identities: [] } });
  let v = s.renderVals();
  let card = v.cards.find((c) => c.title === 'Terra ID로 연결');
  assert.ok(card);
  assert.equal(card.rows[0].t, '연결 없음');
  s.state.tidLinks = identitiesView({ kind: 'unreachable' });
  card = s.renderVals().cards.find((c) => c.title === 'Terra ID로 연결');
  assert.equal(card.rows[0].t, '읽지 못함');
  card.acts[0].run();
  card = s.renderVals().cards.find((c) => c.title === 'Terra ID로 연결');
  assert.equal(card.hasForm, true);
  assert.equal(card.fields[0].key, 'token');
});

test('읽기 — 신뢰 목록은 tree 게이트웨이에서만, 내 연결은 whoami principal 의 user_id 로', async () => {
  const { default: Set_ } = await import('../src/screens/settings.js');
  const calls = [];
  const client = { async invoke(op, input) { calls.push([op, input]); return { kind: 'ok', data: op === TERRA_ID_OPS.issuers ? { issuers: [] } : { identities: [] } }; } };
  const s = new (realSettings(Set_))({});
  s.__live = { client, principal: '' };
  s.state.role = 'leaf';
  await s.loadTerraId({ principal: 'u_1 via lab.stellaxia.node-gui' });
  assert.deepEqual(calls, [[TERRA_ID_OPS.links, { user_id: 'u_1' }]]);
  assert.equal(s.state.tidIss, null);
  assert.equal(s.state.tidLinks.state, 'empty');
  calls.length = 0;
  s.state.role = 'tree';
  await s.loadTerraId({ principal: 'u_1' });
  assert.deepEqual(calls.map((c) => c[0]).sort(), [TERRA_ID_OPS.issuers, TERRA_ID_OPS.links].sort());
  assert.equal(s.state.tidIss.state, 'empty');
  // 신원을 모르면 부르지 않고 못 봤음
  calls.length = 0;
  s.state.role = 'leaf';
  await s.loadTerraId({ principal: '' });
  assert.deepEqual(calls, []);
  assert.equal(s.state.tidLinks.state, 'unseen');
});
