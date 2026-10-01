// Treebench — a test console for the Tree control plane.
//
// The console does not hard-code the Master's surface. It reads the live
// Gateway catalog, which is the set of operations this Gateway will actually
// broker, and joins it against contract-map.js for the two facts the catalog
// does not carry: the authentication channel and the input field names. What
// the join produces is the truth this UI is for — an operation the contract
// declares but the catalog does not publish is a finding, not a blank space,
// and it is rendered as one.
//
// Every call goes through the Invocation Broker's one universal entry point,
// POST /api/v1/operations/{id}/invoke, which takes a flat object: the Gateway
// fills {name} path parameters from it by name and turns the remainder into a
// body (for body methods) or a query string. One request shape covers all 107
// operations, which is why there are no hand-written forms here.
//
// Two surfaces this page deliberately cannot reach on its own:
//   - device-token and service-credential operations (15). A browser session
//     holds neither credential, so they go through the module process's relay.
//   - WebSocket operations (2). The Gateway brokers HTTP; it does not proxy a
//     socket upgrade, so these are marked out-of-channel with the reason.

(function () {
  'use strict';

  var CONTRACT_MAP = window.TREEBENCH_CONTRACT_MAP || {};
  var LEDGER_KEY = 'treebench.ledger.v1';
  var RELAY_OPERATION = 'io.terra.treebench.machine.invoke.post';
  var TOTAL_OPERATIONS = Object.keys(CONTRACT_MAP).length;

  // --- screens ------------------------------------------------------------
  //
  // Grouping follows the contract's own categories, with two overrides that
  // matter more than category: anything on a machine channel belongs to the
  // simulator screen regardless of what it does, and the login pair leads
  // rather than sitting under "auth", because nothing else works until it has
  // run.

  var SCREENS = [
    { id: 'session', group: '', name: '로그인·세션', blurb: '이 Gateway가 세션을 어디서 받는지 확인하고 토큰을 얻는다. 토큰은 메모리에만 두고 저장하지 않는다.' },
    { id: 'dashboard', group: '관찰', name: '대시보드', blurb: 'health와 조립 상태. ⚙️ 조건부 기능이 이 Master 조립에서 살아 있는지를 먼저 판정해 두면, 이후 화면의 501이 회귀인지 예상된 미조립인지 갈린다.' },
    { id: 'events', group: '관찰', name: '이벤트', blurb: '사용자 realtime 이벤트 구독.' },
    { id: 'nodes', group: '토폴로지', name: '노드', blurb: '노드 CRUD와 계층 배치. parent_node_id를 고치면 불변식(부모 유일·사이클 금지·깊이 상한)이 쓰기 경로에서 강제된다.' },
    { id: 'delegations', group: '토폴로지', name: '위임', blurb: '직속 자식 Tree로의 의도 팬아웃. 손자에게 직접 명령하면 DELEGATION_REQUIRED로 거부되는 것이 정상이다.' },
    { id: 'crossboundary', group: '토폴로지', name: '교차 경계', blurb: '기본 거부. 2단계(탐침 인가 → 세션 인가)로 열리고, 탐침 실행과 grant 갱신은 service 채널이라 머신 채널 화면에 있다.' },
    { id: 'network', group: '연결', name: '네트워크', blurb: '망·할당·상태, 프로브, WireGuard, transport, 로그.' },
    { id: 'route', group: '연결', name: '라우팅', blurb: '라우트 그래프와 후보, 정책 CRUD, 라우트 세션.' },
    { id: 'tunnels', group: '연결', name: '연결·터널', blurb: '연결 그룹과 Service Tunnel.' },
    { id: 'svi', group: '자원·적재물', name: 'SVI', blurb: '자원 → Grant → Handle → Binding 순서로 체인이 이어진다. Grant를 회수하면 그 위의 handle이 어떻게 되는지가 관찰 대상이다.' },
    { id: 'fleet', group: '자원·적재물', name: 'Fleet', blurb: 'fleet·릴리스·슬롯·클레임 코드. 디바이스 쪽 절반(빌드 결과 보고, 인스턴스 observed, 코드 교환)은 머신 채널 화면에 있다.' },
    { id: 'jobs', group: '운영', name: '작업·명령', blurb: 'Job 목록·상세·취소, 명령 발행, 파일 전송 개시.' },
    { id: 'admin', group: '운영', name: '관리자', blurb: 'master.admin 권한이 필요한 사용자·클러스터 관리.' },
    { id: 'enroll', group: '운영', name: '등록·디바이스', blurb: 'enroll 코드 발급과 디바이스 등록.' },
    { id: 'machine', group: '채널 밖', name: '머신 채널', blurb: '데몬(device-token)과 동거 Gateway(service-credential)만 부를 수 있는 표면. 브라우저 세션으로는 도달할 수 없어 모듈 프로세스가 자격을 받아 대신 호출한다.' },
    { id: 'console', group: '안전망', name: 'API 콘솔', blurb: '카탈로그의 모든 operation을 화면 배치와 무관하게 부른다. 자유 실험용이지, 배치 실패의 도피처가 아니다.' },
    { id: 'ledger', group: '안전망', name: '커버리지 원장', blurb: '계약이 선언한 107개 중 무엇을 아직 한 번도 부르지 않았는지. 미실행 항목은 담당 화면으로 바로 간다.' },
  ];

  var CATEGORY_SCREEN = {
    admin: 'admin',
    auth: 'session',
    commands: 'jobs',
    'connection-groups': 'tunnels',
    crossboundary: 'crossboundary',
    daemon: 'machine',
    delegations: 'delegations',
    devices: 'enroll',
    enroll: 'enroll',
    files: 'jobs',
    fleets: 'fleet',
    health: 'dashboard',
    jobs: 'jobs',
    modules: 'machine',
    network: 'network',
    nodes: 'nodes',
    realtime: 'events',
    route: 'route',
    'service-tunnels': 'tunnels',
    svi: 'svi',
  };

  var CHANNEL_LABEL = { s: 'session', d: 'device', v: 'service', p: 'public' };
  var CHANNEL_CLASS = { s: 'ok', d: 'warn', v: 'info', p: 'dim' };

  // --- state --------------------------------------------------------------

  var state = {
    screen: 'session',
    operations: [],          // merged catalog + contract entries
    byId: {},
    auth: { mode: 'none' },
    token: '',
    who: '',
    catalogGeneration: '',
    catalogError: '',
    ledger: readLedger(),
    credentials: { device: '', service: '' },
    relayAvailable: false,
    filter: '',
  };

  var dom = {
    nav: document.getElementById('nav'),
    main: document.getElementById('main'),
    envelope: document.getElementById('envelope'),
    ledgerSummary: document.getElementById('ledger-summary'),
    ledgerRecent: document.getElementById('ledger-recent'),
    gatewayPill: document.getElementById('gateway-pill'),
    sessionPill: document.getElementById('session-pill'),
    coveragePill: document.getElementById('coverage-pill'),
    resetLedger: document.getElementById('reset-ledger'),
  };

  // --- small helpers ------------------------------------------------------

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function pill(text, kind) {
    return element('span', 'pill ' + (kind || 'dim'), text);
  }

  function pretty(value) {
    if (typeof value === 'string') {
      try { return JSON.stringify(JSON.parse(value), null, 2); } catch (error) { return value; }
    }
    try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
  }

  // --- ledger -------------------------------------------------------------
  //
  // Outcomes are deliberately four, not two. A 501 from a conditionally
  // assembled operation and a 500 from a broken one are both "not 2xx", but
  // only one of them is a defect, and a console that scored them the same
  // would make its own coverage number meaningless.

  function readLedger() {
    try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || {}; } catch (error) { return {}; }
  }

  function saveLedger() {
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(state.ledger)); } catch (error) { /* private mode */ }
  }

  function classify(status) {
    if (status >= 200 && status < 300) return 'ok';
    if (status === 501) return 'unassembled';
    return 'fail';
  }

  function record(operationId, entry) {
    state.ledger[operationId] = {
      outcome: entry.outcome,
      status: entry.status,
      at: new Date().toISOString(),
      note: entry.note || '',
    };
    saveLedger();
    renderLedgerPanel();
    renderCoverage();
    renderNav();
  }

  function ledgerCounts() {
    var counts = { ok: 0, expected: 0, unassembled: 0, fail: 0, pending: 0 };
    Object.keys(CONTRACT_MAP).forEach(function (shortId) {
      var entry = state.ledger['terra.master.' + shortId];
      if (!entry) { counts.pending += 1; return; }
      if (entry.outcome === 'expected') counts.expected += 1;
      else if (entry.outcome === 'unassembled') counts.unassembled += 1;
      else if (entry.outcome === 'ok') counts.ok += 1;
      else counts.fail += 1;
    });
    return counts;
  }

  // --- catalog ------------------------------------------------------------

  // 파생은 공용 핵심이 한다(tools/api-console/derive.js, derive.js로 스테이징).
  // 바인딩 파싱·경로 파라미터·채널 판정·계약↔카탈로그 조인은 이 콘솔만의 것이
  // 아니었는데 여기 살고 있었다. 화면 배치(screenFor·CATEGORY_SCREEN)와 중계,
  // 원장은 treebench의 것이라 여기 남는다.
  var DERIVE = window.TerraApiDerive;

  var isBodyMethod = DERIVE.isBodyMethod;

  function screenFor(operation) {
    if (operation.channel === 'd' || operation.channel === 'v') return 'machine';
    return CATEGORY_SCREEN[operation.category] || 'console';
  }

  // 조인은 공용 핵심의 것이고, 어느 화면에 놓을지는 이 콘솔의 것이다.
  //
  // 계약이 선언한 것은 카탈로그에 없어도 자리를 갖는다 — 게시되지 않은 표면이
  // 사라지면 그것이 곧 이 콘솔이 잡으라고 있는 불일치이기 때문이다. 그 규칙은
  // 이제 derive.js가 소유하고, 여기서는 남의 provider를 console로 보내는 것만
  // 정한다(분류로 화면을 고르면 남의 것이 우리 화면에 섞인다).
  function mergeOperations(catalogOperations) {
    var merged = DERIVE.mergeOperations(CONTRACT_MAP, catalogOperations, 'terra.master.');
    merged.forEach(function (operation) {
      operation.screen = operation.foreign ? 'console' : screenFor(operation);
    });
    return merged;
  }

  function loadCatalog() {
    // no-store because the answer depends on the Authorization header and a
    // cached anonymous copy would be merged as 'this operation is not
    // published', which is the opposite of what logging in just changed.
    return fetch('/api/v1/catalog', { headers: authHeaders(), cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('카탈로그를 읽을 수 없습니다 (' + response.status + ')');
        return response.json();
      })
      .then(function (body) {
        state.catalogGeneration = body.generation || '';
        state.catalogError = '';
        state.operations = mergeOperations(body.operations || []);
        state.byId = {};
        state.operations.forEach(function (operation) { state.byId[operation.id] = operation; });
        state.relayAvailable = (body.operations || []).some(function (entry) {
          return entry.operationId === RELAY_OPERATION;
        });
      })
      .catch(function (error) {
        state.catalogError = error.message;
        state.operations = mergeOperations([]);
        state.byId = {};
        state.operations.forEach(function (operation) { state.byId[operation.id] = operation; });
      });
  }

  // --- session ------------------------------------------------------------

  function authHeaders() {
    var headers = { Accept: 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return headers;
  }

  function readHealth() {
    return fetch('/api/v1/health', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (response) { return response.json(); })
      .then(function (body) {
        state.auth = body.auth || { mode: 'none' };
        state.health = body;
        return body;
      })
      .catch(function () { state.auth = { mode: 'none' }; });
  }

  // Login goes through the Gateway's relay, the same path the launcher takes:
  // this page sits under connect-src 'self' with every other app and does not
  // get to reach the Master directly just because it is a test console.
  function login(email, password) {
    return fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var message = (body.error && body.error.message) || ('Master가 ' + response.status + '로 답했습니다');
          throw new Error(message);
        }
        var data = body.data || {};
        if (!data.access_token) throw new Error('응답에 토큰이 없습니다');
        state.token = data.access_token;
        state.who = (data.user && (data.user.display_name || data.user.email)) || email;
        record('terra.master.auth.login.post', { outcome: 'ok', status: response.status });
      });
    });
  }

  // --- invoke -------------------------------------------------------------

  var lastEnvelope = null;

  function showEnvelope(envelope) {
    lastEnvelope = envelope;
    clear(dom.envelope);
    dom.envelope.className = '';

    function line(key, value, kind) {
      var row = element('div', 'env-line');
      row.appendChild(element('span', 'k', key));
      if (kind) row.appendChild(pill(value, kind));
      else row.appendChild(element('span', null, value));
      dom.envelope.appendChild(row);
    }

    line('op', envelope.operationId);
    line('요청', envelope.method + ' ' + envelope.path);
    line('상태', envelope.statusText, envelope.pillKind);
    line('소요', envelope.durationMs + 'ms');
    if (envelope.traceId) line('trace', envelope.traceId);

    if (envelope.request !== undefined) {
      dom.envelope.appendChild(element('h2', null, '보낸 것'));
      dom.envelope.appendChild(element('pre', null, pretty(envelope.request)));
    }
    dom.envelope.appendChild(element('h2', null, '받은 것'));
    dom.envelope.appendChild(element('pre', null, pretty(envelope.response)));
  }

  function invoke(operation, input) {
    var started = Date.now();
    return fetch('/api/v1/operations/' + encodeURIComponent(operation.id) + '/invoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: state.token ? 'Bearer ' + state.token : undefined,
      },
      body: JSON.stringify(input),
    }).then(function (response) {
      return response.text().then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (error) { parsed = text; }
        return {
          status: response.status,
          body: parsed,
          durationMs: Date.now() - started,
          traceId: (parsed && parsed.meta && parsed.meta.trace_id) || '',
        };
      });
    }).catch(function (error) {
      return { status: 0, body: { error: { message: error.message } }, durationMs: Date.now() - started, traceId: '' };
    });
  }

  function relayInvoke(operation, input, channel, credential) {
    var path = operation.path;
    var remaining = {};
    Object.keys(input).forEach(function (key) {
      if (path.indexOf('{' + key + '}') >= 0 || path.indexOf('{' + key + '...}') >= 0) {
        path = path.replace('{' + key + '}', encodeURIComponent(input[key]))
                   .replace('{' + key + '...}', String(input[key]));
      } else {
        remaining[key] = input[key];
      }
    });

    var relayInput = {
      method: operation.method,
      path: path,
      channel: channel,
      credential: credential,
    };
    if (isBodyMethod(operation.method)) {
      if (Object.keys(remaining).length > 0) relayInput.body = remaining;
    } else if (Object.keys(remaining).length > 0) {
      var query = Object.keys(remaining).map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(remaining[key]);
      }).join('&');
      relayInput.path = path + '?' + query;
    }

    var started = Date.now();
    return fetch('/api/v1/operations/' + encodeURIComponent(RELAY_OPERATION) + '/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: state.token ? 'Bearer ' + state.token : undefined },
      body: JSON.stringify(relayInput),
    }).then(function (response) {
      return response.text().then(function (text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch (error) { parsed = text; }
        if (!response.ok) {
          return { status: response.status, body: parsed, durationMs: Date.now() - started, traceId: '', relayFailed: true };
        }
        // The relay answers 200 carrying the Master's own status; the Master's
        // status is the one that matters to the ledger.
        var inner;
        try { inner = JSON.parse(parsed.body); } catch (error) { inner = parsed.body; }
        return {
          status: parsed.status,
          body: inner,
          durationMs: parsed.duration_ms !== undefined ? parsed.duration_ms : Date.now() - started,
          traceId: (inner && inner.meta && inner.meta.trace_id) || '',
          relayPath: relayInput.path,
        };
      });
    }).catch(function (error) {
      return { status: 0, body: { error: { message: error.message } }, durationMs: Date.now() - started, traceId: '', relayFailed: true };
    });
  }

  // --- operation card -----------------------------------------------------

  function collectInput(card, operation) {
    var input = {};
    var inputs = card.querySelectorAll('input[data-field]');
    for (var index = 0; index < inputs.length; index += 1) {
      var field = inputs[index];
      var value = field.value.trim();
      if (value === '') continue;
      input[field.getAttribute('data-field')] = value;
    }
    var textarea = card.querySelector('textarea[data-json]');
    if (textarea && textarea.value.trim() !== '') {
      var extra;
      try {
        extra = JSON.parse(textarea.value);
      } catch (error) {
        textarea.classList.add('bad');
        throw new Error('JSON을 읽을 수 없습니다: ' + error.message);
      }
      textarea.classList.remove('bad');
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
        Object.keys(extra).forEach(function (key) { input[key] = extra[key]; });
      } else {
        throw new Error('추가 입력은 JSON object여야 합니다');
      }
    }
    // Path parameters are the one thing the Gateway will reject rather than
    // guess, so they are checked here where the message can point at the field.
    var missing = operation.pathParameters.filter(function (name) { return input[name] === undefined; });
    if (missing.length > 0) throw new Error('경로 파라미터가 필요합니다: ' + missing.join(', '));
    return input;
  }

  function blockedReason(operation) {
    if (operation.websocket) {
      return 'WebSocket 표면입니다. Gateway는 HTTP를 중개하고 소켓 업그레이드는 프록시하지 않으므로 이 콘솔에서 부를 수 없습니다 — 데몬 릴레이(/ws/daemon)는 데몬이, 사용자 이벤트(/ws/events)는 Master에 직접 붙는 클라이언트가 씁니다.';
    }
    if (!operation.published) {
      return '계약에는 있으나 이 Gateway 카탈로그에 게시되지 않았습니다. Master 계약을 provider root로 물리지 않았거나(terra-gateway … products/tree/master) 이 조립에 없는 표면입니다.';
    }
    if ((operation.channel === 'd' || operation.channel === 'v') && !state.relayAvailable) {
      return '머신 채널 표면이라 브라우저 세션으로는 부를 수 없고, 중계 모듈(io.terra.treebench)이 이 Gateway에 게시되지 않아 대신 부를 수도 없습니다.';
    }
    return '';
  }

  function renderOperation(operation) {
    var card = element('div', 'op');
    var head = element('button', 'op-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');

    head.appendChild(element('span', 'op-method ' + operation.method.toLowerCase(), operation.method));
    head.appendChild(element('span', 'op-id', operation.shortId));
    head.appendChild(element('span', 'op-path', operation.path));

    var flags = element('div', 'op-flags');
    flags.appendChild(pill(CHANNEL_LABEL[operation.channel], CHANNEL_CLASS[operation.channel]));
    if (!operation.published) flags.appendChild(pill('미게시', 'crit'));
    var ledgerEntry = state.ledger[operation.id];
    if (ledgerEntry) {
      var kinds = { ok: 'ok', expected: 'ok', unassembled: 'dim', fail: 'crit' };
      var labels = { ok: '✓ ' + ledgerEntry.status, expected: '✓ 기대된 거부', unassembled: '⚙️ 미조립', fail: '✗ ' + ledgerEntry.status };
      flags.appendChild(pill(labels[ledgerEntry.outcome] || ledgerEntry.outcome, kinds[ledgerEntry.outcome] || 'dim'));
    }
    head.appendChild(flags);
    card.appendChild(head);

    var body = element('div', 'op-body');
    body.hidden = true;

    if (operation.summary) body.appendChild(element('p', 'op-summary', operation.summary));

    var reason = blockedReason(operation);
    if (reason) {
      var note = element('div', 'op-note blocked');
      note.appendChild(element('strong', null, '이 콘솔에서 부를 수 없음 — '));
      note.appendChild(document.createTextNode(reason));
      body.appendChild(note);
    }

    if (operation.permissions.length > 0) {
      body.appendChild(element('div', 'op-note', '필요 권한: ' + operation.permissions.join(', ')));
    }

    var fields = element('div', 'field-grid');
    operation.pathParameters.forEach(function (name) {
      var wrap = element('div', 'field');
      var label = element('label', null, name + ' ');
      label.appendChild(element('span', 'req', '*'));
      var input = element('input');
      input.setAttribute('data-field', name);
      input.placeholder = '경로 파라미터';
      wrap.appendChild(label);
      wrap.appendChild(input);
      fields.appendChild(wrap);
    });
    var scalarFields = isBodyMethod(operation.method) ? [] : operation.queryFields;
    scalarFields.forEach(function (name) {
      if (operation.pathParameters.indexOf(name) >= 0) return;
      var wrap = element('div', 'field');
      var label = element('label', null, name + ' ');
      if (operation.queryRequired.indexOf(name) >= 0) label.appendChild(element('span', 'req', '*'));
      var input = element('input');
      input.setAttribute('data-field', name);
      input.placeholder = 'query';
      wrap.appendChild(label);
      wrap.appendChild(input);
      fields.appendChild(wrap);
    });
    if (fields.childNodes.length > 0) body.appendChild(fields);

    if (isBodyMethod(operation.method)) {
      var jsonWrap = element('div', 'json-field');
      var hint = operation.bodyFields.length > 0
        ? '본문 JSON — 계약 필드: ' + operation.bodyFields.map(function (name) {
            return operation.bodyRequired.indexOf(name) >= 0 ? name + '*' : name;
          }).join(', ')
        : '본문 JSON';
      jsonWrap.appendChild(element('label', null, hint));
      var textarea = element('textarea');
      textarea.setAttribute('data-json', 'true');
      textarea.spellcheck = false;
      if (operation.bodyFields.length > 0) {
        var skeleton = {};
        (operation.bodyRequired.length > 0 ? operation.bodyRequired : operation.bodyFields).forEach(function (name) {
          skeleton[name] = '';
        });
        textarea.value = JSON.stringify(skeleton, null, 2);
      }
      jsonWrap.appendChild(textarea);
      body.appendChild(jsonWrap);
    }

    var actions = element('div', 'op-actions');
    var callButton = element('button', 'btn primary', reason ? '부를 수 없음' : '호출');
    callButton.type = 'button';
    callButton.disabled = Boolean(reason);
    actions.appendChild(callButton);

    var expectButton = element('button', 'btn', '기대된 거부로 표시');
    expectButton.type = 'button';
    expectButton.hidden = true;
    actions.appendChild(expectButton);
    body.appendChild(actions);

    var result = element('div', 'op-result');
    result.hidden = true;
    body.appendChild(result);
    card.appendChild(body);

    head.addEventListener('click', function () {
      body.hidden = !body.hidden;
      card.classList.toggle('is-open', !body.hidden);
      head.setAttribute('aria-expanded', String(!body.hidden));
    });

    callButton.addEventListener('click', function () {
      var input;
      try {
        input = collectInput(card, operation);
      } catch (error) {
        result.hidden = false;
        result.textContent = '입력 오류 — ' + error.message;
        return;
      }

      callButton.disabled = true;
      callButton.textContent = '호출 중…';

      var machine = operation.channel === 'd' || operation.channel === 'v';
      var promise = machine
        ? relayInvoke(operation, input, operation.channel === 'd' ? 'device' : 'service',
            operation.channel === 'd' ? state.credentials.device : state.credentials.service)
        : invoke(operation, input);

      promise.then(function (outcome) {
        callButton.disabled = false;
        callButton.textContent = '호출';

        var kind = outcome.status >= 200 && outcome.status < 300 ? 'ok'
          : outcome.status === 501 ? 'dim'
          : 'crit';
        showEnvelope({
          operationId: operation.id,
          method: operation.method,
          path: outcome.relayPath || operation.path,
          statusText: outcome.relayFailed ? '중계 실패 ' + outcome.status : String(outcome.status),
          pillKind: kind,
          durationMs: outcome.durationMs,
          traceId: outcome.traceId,
          request: input,
          response: outcome.body,
        });

        result.hidden = false;
        result.textContent = outcome.status + ' · ' + outcome.durationMs + 'ms\n' + pretty(outcome.body);

        if (!outcome.relayFailed) {
          record(operation.id, { outcome: classify(outcome.status), status: outcome.status });
          expectButton.hidden = classify(outcome.status) !== 'fail';
        }
        renderNav();
        refreshFlags(card, operation);
      });
    });

    expectButton.addEventListener('click', function () {
      var entry = state.ledger[operation.id] || {};
      record(operation.id, { outcome: 'expected', status: entry.status, note: '기대된 거부' });
      expectButton.hidden = true;
      refreshFlags(card, operation);
    });

    return card;
  }

  function refreshFlags(card, operation) {
    var flags = card.querySelector('.op-flags');
    if (!flags) return;
    clear(flags);
    flags.appendChild(pill(CHANNEL_LABEL[operation.channel], CHANNEL_CLASS[operation.channel]));
    if (!operation.published) flags.appendChild(pill('미게시', 'crit'));
    var entry = state.ledger[operation.id];
    if (entry) {
      var kinds = { ok: 'ok', expected: 'ok', unassembled: 'dim', fail: 'crit' };
      var labels = { ok: '✓ ' + entry.status, expected: '✓ 기대된 거부', unassembled: '⚙️ 미조립', fail: '✗ ' + entry.status };
      flags.appendChild(pill(labels[entry.outcome] || entry.outcome, kinds[entry.outcome] || 'dim'));
    }
  }

  // --- screens ------------------------------------------------------------

  function operationsFor(screenId) {
    return state.operations.filter(function (operation) {
      if (screenId === 'console') return true;
      return operation.screen === screenId;
    }).filter(function (operation) {
      if (!state.filter) return true;
      var needle = state.filter.toLowerCase();
      return operation.shortId.toLowerCase().indexOf(needle) >= 0
        || operation.path.toLowerCase().indexOf(needle) >= 0;
    }).sort(function (left, right) {
      return left.shortId < right.shortId ? -1 : left.shortId > right.shortId ? 1 : 0;
    });
  }

  function renderScreenHead(screen) {
    var head = element('div', 'screen-head');
    head.appendChild(element('h1', null, screen.name));
    head.appendChild(element('p', null, screen.blurb));
    return head;
  }

  function renderSessionScreen(container) {
    var box = element('div', 'login');
    box.appendChild(element('h2', null, '세션'));

    var mode = state.auth.mode || 'none';
    var explanation = {
      master: '이 Gateway는 Master가 세션을 발급합니다. 아래로 로그인하면 토큰이 이 페이지 메모리에만 남고, 호출마다 Bearer로 실립니다.',
      open: '이 Gateway는 dev-open 모드입니다 — 로그인 없이 모든 권한을 가집니다. 다만 업스트림 Master가 인증을 요구하면 그 호출은 401로 돌아옵니다.',
      seeded: '토큰이 외부에서 배포되는 Gateway입니다. 아래에 토큰을 직접 붙여 넣으세요.',
      none: 'Master가 연결되지 않은 Gateway입니다. 세션이 필요한 호출은 실패합니다.',
    }[mode] || '';
    box.appendChild(element('p', null, explanation));

    if (mode === 'master') {
      var emailRow = element('div', 'cred-row');
      emailRow.appendChild(element('label', null, '이메일'));
      var email = element('input');
      email.type = 'email';
      email.autocomplete = 'username';
      emailRow.appendChild(email);
      box.appendChild(emailRow);

      var passwordRow = element('div', 'cred-row');
      passwordRow.appendChild(element('label', null, '비밀번호'));
      var password = element('input');
      password.type = 'password';
      password.autocomplete = 'current-password';
      passwordRow.appendChild(password);
      box.appendChild(passwordRow);
    }

    var tokenRow = element('div', 'cred-row');
    tokenRow.appendChild(element('label', null, '토큰'));
    var tokenInput = element('input');
    tokenInput.value = state.token;
    tokenInput.placeholder = '직접 붙여 넣어도 됩니다';
    tokenRow.appendChild(tokenInput);
    box.appendChild(tokenRow);

    var actions = element('div', 'op-actions');
    if (mode === 'master') {
      var loginButton = element('button', 'btn primary', '로그인');
      loginButton.type = 'button';
      actions.appendChild(loginButton);
      loginButton.addEventListener('click', function () {
        var emailValue = box.querySelector('input[type="email"]').value;
        var passwordValue = box.querySelector('input[type="password"]').value;
        loginButton.disabled = true;
        login(emailValue, passwordValue).then(function () {
          renderSession();
          // The catalog is filtered by what the caller may see, so the list
          // read before logging in was the anonymous one — an administrator
          // who did not reload it would find every admin operation sitting
          // there marked "미게시".
          return loadCatalog().then(function () {
            renderGatewayPill();
            renderNav();
            render();
          });
        }).catch(function (error) {
          loginButton.disabled = false;
          var status = element('div', 'login-state bad', '로그인 실패 — ' + error.message);
          box.appendChild(status);
        });
      });
    }
    var useToken = element('button', 'btn', '토큰 사용');
    useToken.type = 'button';
    actions.appendChild(useToken);
    useToken.addEventListener('click', function () {
      state.token = tokenInput.value.trim();
      state.who = state.token ? '토큰 직접 입력' : '';
      renderSession();
      loadCatalog().then(render);
    });

    if (state.token) {
      var logout = element('button', 'btn danger', '세션 버리기');
      logout.type = 'button';
      actions.appendChild(logout);
      logout.addEventListener('click', function () {
        state.token = '';
        state.who = '';
        renderSession();
        // Dropping the session narrows what the catalog shows, the same way
        // logging in widened it.
        loadCatalog().then(function () {
          renderGatewayPill();
          renderNav();
          render();
        });
      });
    }
    box.appendChild(actions);

    if (state.who) {
      box.appendChild(element('div', 'login-state good', state.who + ' — 세션을 쥐고 있습니다.'));
    }
    container.appendChild(box);
  }

  function renderDashboardScreen(container) {
    var health = state.health || {};
    var grid = element('div', 'field-grid');

    function stat(label, value) {
      var box = element('div', 'ledger-stat');
      box.appendChild(element('b', null, value));
      box.appendChild(element('span', null, label));
      grid.appendChild(box);
    }
    stat('Gateway 카탈로그 operation', String(health.operationCount !== undefined ? health.operationCount : '–'));
    stat('provider', String(health.providerCount !== undefined ? health.providerCount : '–'));
    stat('세션 발급자', state.auth.mode || 'none');
    stat('중계 모듈', state.relayAvailable ? '게시됨' : '없음');
    container.appendChild(grid);

    var counts = ledgerCounts();
    var note = element('div', 'op-note');
    note.appendChild(element('strong', null, '조립 판정 — '));
    note.appendChild(document.createTextNode(
      '이 원장에서 501로 돌아온 operation ' + counts.unassembled + '개는 이 Master 조립에 그 의존성이 주입되지 않았다는 뜻입니다(⚙️ 조건부 가용). ' +
      '아래 health를 부르고, 각 화면에서 한 번씩 호출해 조립 지도를 채우세요.'));
    container.appendChild(note);
  }

  function renderMachineScreen(container) {
    var box = element('div', 'cred');
    box.appendChild(element('h3', null, '자격'));
    box.appendChild(element('p', null,
      '여기 입력한 자격은 이 페이지 메모리에만 있다가 호출 한 번에 쓰이고, 모듈 프로세스는 그것을 저장하지도 기록하지도 않습니다. ' +
      '중계는 Master의 /api/v1 경로로만 나갑니다.'));

    [['device', 'device token', '데몬이 쥔 토큰 — Authorization: Bearer로 실립니다'],
     ['service', 'service cred', '동거 Gateway의 자격 — X-Terra-Service-Credential로 실립니다']].forEach(function (entry) {
      var row = element('div', 'cred-row');
      row.appendChild(element('label', null, entry[1]));
      var input = element('input');
      input.type = 'password';
      input.value = state.credentials[entry[0]];
      input.placeholder = entry[2];
      input.addEventListener('input', function () { state.credentials[entry[0]] = input.value; });
      row.appendChild(input);
      box.appendChild(row);
    });

    if (!state.relayAvailable) {
      box.appendChild(element('div', 'op-note blocked',
        '중계 operation(' + RELAY_OPERATION + ')이 이 Gateway 카탈로그에 없습니다. io.terra.treebench 모듈이 기동되어 라우트를 게시했는지 확인하세요.'));
    }
    container.appendChild(box);
  }

  function renderLedgerScreen(container) {
    var counts = ledgerCounts();
    var summary = element('div', 'field-grid');
    [['호출 성공', counts.ok], ['기대된 거부', counts.expected], ['미조립 ⚙️', counts.unassembled],
     ['실패', counts.fail], ['미실행', counts.pending]].forEach(function (entry) {
      var box = element('div', 'ledger-stat');
      box.appendChild(element('b', null, String(entry[1])));
      box.appendChild(element('span', null, entry[0]));
      summary.appendChild(box);
    });
    container.appendChild(summary);

    var actions = element('div', 'op-actions');
    var exportButton = element('button', 'btn', 'JSON 내보내기');
    exportButton.type = 'button';
    exportButton.addEventListener('click', function () {
      showEnvelope({
        operationId: '(원장 내보내기)',
        method: 'LOCAL',
        path: LEDGER_KEY,
        statusText: '원장',
        pillKind: 'ok',
        durationMs: 0,
        traceId: '',
        response: state.ledger,
      });
    });
    actions.appendChild(exportButton);

    var pendingOnly = element('button', 'btn', '미실행만 보기');
    pendingOnly.type = 'button';
    var showPendingOnly = false;
    actions.appendChild(pendingOnly);
    container.appendChild(actions);

    var wrap = element('div', 'table-wrap');
    var table = element('table', 'ledger-table');
    var thead = element('thead');
    var headRow = element('tr');
    ['Operation', '채널', '결과', '상태', '화면'].forEach(function (label) {
      headRow.appendChild(element('th', null, label));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = element('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);

    function fill() {
      clear(tbody);
      state.operations.filter(function (operation) { return !operation.foreign; })
        .sort(function (left, right) { return left.shortId < right.shortId ? -1 : 1; })
        .forEach(function (operation) {
          var entry = state.ledger[operation.id];
          if (showPendingOnly && entry) return;
          var row = element('tr');
          row.appendChild(element('td', null, operation.shortId));
          var channelCell = element('td');
          channelCell.appendChild(pill(CHANNEL_LABEL[operation.channel], CHANNEL_CLASS[operation.channel]));
          row.appendChild(channelCell);
          var outcomeCell = element('td');
          var labels = { ok: '✓ 성공', expected: '✓ 기대된 거부', unassembled: '⚙️ 미조립', fail: '✗ 실패' };
          var kinds = { ok: 'ok', expected: 'ok', unassembled: 'dim', fail: 'crit' };
          outcomeCell.appendChild(entry ? pill(labels[entry.outcome] || entry.outcome, kinds[entry.outcome] || 'dim')
                                        : pill('미실행', 'warn'));
          row.appendChild(outcomeCell);
          row.appendChild(element('td', null, entry && entry.status !== undefined ? String(entry.status) : '–'));
          var screenCell = element('td');
          var link = element('span', 'go', screenName(operation.screen));
          link.addEventListener('click', function () { show(operation.screen); });
          screenCell.appendChild(link);
          row.appendChild(screenCell);
          tbody.appendChild(row);
        });
    }
    pendingOnly.addEventListener('click', function () {
      showPendingOnly = !showPendingOnly;
      pendingOnly.textContent = showPendingOnly ? '전체 보기' : '미실행만 보기';
      fill();
    });
    fill();
  }

  function screenName(screenId) {
    for (var index = 0; index < SCREENS.length; index += 1) {
      if (SCREENS[index].id === screenId) return SCREENS[index].name;
    }
    return screenId;
  }

  function render() {
    var screen = SCREENS.filter(function (entry) { return entry.id === state.screen; })[0] || SCREENS[0];
    clear(dom.main);
    dom.main.appendChild(renderScreenHead(screen));

    if (state.catalogError) {
      dom.main.appendChild(element('div', 'op-note blocked', '카탈로그 오류 — ' + state.catalogError));
    }

    if (screen.id === 'session') { renderSessionScreen(dom.main); return; }
    if (screen.id === 'ledger') { renderLedgerScreen(dom.main); return; }
    if (screen.id === 'dashboard') renderDashboardScreen(dom.main);
    if (screen.id === 'machine') renderMachineScreen(dom.main);

    var operations = operationsFor(screen.id);

    var tools = element('div', 'screen-tools');
    tools.appendChild(element('label', null, operations.length + '개 operation'));
    var search = element('input');
    search.type = 'search';
    search.placeholder = 'id 또는 경로로 거르기';
    search.value = state.filter;
    search.addEventListener('input', function () {
      state.filter = search.value.trim();
      render();
      var refocus = dom.main.querySelector('input[type="search"]');
      if (refocus) { refocus.focus(); refocus.setSelectionRange(refocus.value.length, refocus.value.length); }
    });
    tools.appendChild(search);
    dom.main.appendChild(tools);

    if (operations.length === 0) {
      dom.main.appendChild(element('div', 'op-note', '이 조건에 맞는 operation이 없습니다.'));
      return;
    }
    operations.forEach(function (operation) {
      dom.main.appendChild(renderOperation(operation));
    });
  }

  function show(screenId) {
    state.screen = screenId;
    state.filter = '';
    renderNav();
    render();
    window.scrollTo(0, 0);
  }

  function renderNav() {
    clear(dom.nav);
    var currentGroup = null;
    SCREENS.forEach(function (screen) {
      if (screen.group !== currentGroup) {
        currentGroup = screen.group;
        if (currentGroup) dom.nav.appendChild(element('div', 'nav-group', currentGroup));
      }
      var item = element('button', 'nav-item');
      item.type = 'button';
      item.setAttribute('aria-current', String(screen.id === state.screen));
      item.appendChild(element('span', null, screen.name));

      var screenOperations = state.operations.filter(function (operation) {
        return screen.id === 'console' ? true : operation.screen === screen.id;
      });
      if (screenOperations.length > 0 && screen.id !== 'ledger') {
        var done = screenOperations.filter(function (operation) { return state.ledger[operation.id]; }).length;
        var bar = element('span', 'nav-bar');
        var fill = element('i');
        fill.style.width = Math.round((done / screenOperations.length) * 100) + '%';
        bar.appendChild(fill);
        item.appendChild(element('span', 'nav-count', done + '/' + screenOperations.length));
        item.appendChild(bar);
      }
      item.addEventListener('click', function () { show(screen.id); });
      dom.nav.appendChild(item);
    });
  }

  function renderSession() {
    if (state.token) {
      dom.sessionPill.className = 'pill ok';
      dom.sessionPill.textContent = state.who || '세션 있음';
    } else {
      dom.sessionPill.className = 'pill dim';
      dom.sessionPill.textContent = '세션 없음 · ' + (state.auth.mode || 'none');
    }
  }

  function renderCoverage() {
    var counts = ledgerCounts();
    var touched = TOTAL_OPERATIONS - counts.pending;
    dom.coveragePill.textContent = '커버리지 ' + touched + '/' + TOTAL_OPERATIONS;
    dom.coveragePill.className = 'pill ' + (touched === 0 ? 'dim' : touched === TOTAL_OPERATIONS ? 'ok' : 'warn');
  }

  function renderLedgerPanel() {
    var counts = ledgerCounts();
    clear(dom.ledgerSummary);
    [['성공', counts.ok], ['기대된 거부', counts.expected], ['미조립', counts.unassembled], ['실패', counts.fail]]
      .forEach(function (entry) {
        var box = element('div', 'ledger-stat');
        box.appendChild(element('b', null, String(entry[1])));
        box.appendChild(element('span', null, entry[0]));
        dom.ledgerSummary.appendChild(box);
      });

    clear(dom.ledgerRecent);
    Object.keys(state.ledger)
      .map(function (id) { return { id: id, entry: state.ledger[id] }; })
      .sort(function (left, right) { return left.entry.at < right.entry.at ? 1 : -1; })
      .slice(0, 8)
      .forEach(function (item) {
        var row = element('div');
        var marks = { ok: '✓', expected: '✓', unassembled: '⚙️', fail: '✗' };
        row.appendChild(element('span', null, marks[item.entry.outcome] || '·'));
        row.appendChild(element('span', null, item.id.replace('terra.master.', '')));
        row.appendChild(element('span', 'sp'));
        row.appendChild(element('span', null, String(item.entry.status === undefined ? '' : item.entry.status)));
        dom.ledgerRecent.appendChild(row);
      });
  }

  function renderGatewayPill() {
    var health = state.health;
    if (!health) {
      dom.gatewayPill.className = 'pill crit';
      dom.gatewayPill.textContent = '게이트웨이 없음';
      return;
    }
    dom.gatewayPill.className = 'pill ok';
    dom.gatewayPill.textContent = 'gateway · op ' + (health.operationCount || 0);
  }

  // --- boot ---------------------------------------------------------------

  dom.resetLedger.addEventListener('click', function () {
    state.ledger = {};
    saveLedger();
    renderLedgerPanel();
    renderCoverage();
    renderNav();
    render();
  });

  readHealth()
    .then(loadCatalog)
    .then(function () {
      renderGatewayPill();
      renderSession();
      renderCoverage();
      renderLedgerPanel();
      renderNav();
      render();
    });
}());
