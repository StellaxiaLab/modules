// Terra launcher (WebApp Host W-M3, 창 모드 설계 N-M2·N-M5).
//
// 화면은 세 장면이다. Terra는 Tree와 Leaf라는 두 제품이 있고 그 위에 각자의
// 모듈과 공통 모듈이 얹히는 구조인데, 지금까지 런처는 그 구조를 지우고 앱을
// 한 줄로 늘어놓았다 — 어느 것이 Tree의 것이고 어느 것이 공통인지 화면에
// 없었다. 이제 그 구조가 화면의 구조다:
//
//   ① terra   — 첫 화면. Tree · Leaf · 원격 노드 · 공통 모듈, 그리고 로그인.
//   ② product — 한 제품(tree | leaf | common)의 앱과 설치된 모듈. 모듈마다
//               "관리"가 있어 설치 위치·환경 변수·종속 모듈을 편다.
//   ③ remote  — 원격 노드의 앱.
//
// 분류의 근거는 매니페스트의 compatibility.products다(Gateway가 앱·모듈 양쪽에
// 실어 보낸다). 선언이 없으면 제약이 없다는 뜻이므로 공통으로 친다 — 모듈
// 런타임의 incompatibleReason과 같은 규칙이다.
//
// This page is itself a sandboxed app served by the Gateway, which is exactly
// why it needs no bridge for its core job: the app list route lives on the
// SAME origin the assets come from, so a plain same-origin fetch reads it —
// the bridge exists for the module namespaces, not for this.
//
// 이 페이지는 세 자리에서 열린다. CLI 환경의 terra CLI가 서는 자리에 GUI
// 환경에서는 이 런처가 서므로(N-M5), 어디서 열렸는지에 따라 할 수 있는 일이
// 다르다:
//
//   desktop  — 데스크톱 런처 창(최상위). window.chrome.webview로 셸과 직접
//              대화한다. 제품(Leaf/Tree/Studio)까지 여는 완전한 진입점.
//   embedded — 제품 셸 안 iframe. 창 열기는 부모 셸에 위임한다.
//   browser  — 그냥 브라우저. 로그인 전에는 이미 게시된 창 앱만 새 창으로
//              연다.
//
// 세션: embedded 모드는 부모 셸이 토큰을 쥔다(W-M2). desktop·browser 모드는
// 이 페이지가 스스로 Master에 로그인해 토큰을 메모리에만 둔다 — 저장하지
// 않고, 셸(C#)에도 넘기지 않는다. 토큰은 원격 조회·동기화와 창 앱 스코프
// 토큰 발급(W-D2)에만 쓰인다.

(function () {
  'use strict';

  var BRIDGE_HELLO = 'terra.webapp.hello';
  var BRIDGE_READY = 'terra.webapp.ready';
  var BRIDGE_RESPONSE = 'terra.webapp.response';
  var BRIDGE_OPEN_WINDOW = 'terra.webapp.openWindow';
  var BRIDGE_REMOTE = 'terra.webapp.remote';
  var BRIDGE_MOUNT_APP = 'terra.webapp.mountApp';

  // 창 앱 실행 요청의 응답 상관: id → 콜백 (창 모드 설계 N-M2).
  var pendingWindowOpens = {};
  var windowOpenCounter = 0;

  var sceneTerra = document.getElementById('scene-terra');
  var sceneProduct = document.getElementById('scene-product');
  var sceneRemote = document.getElementById('scene-remote');
  var entriesSection = document.getElementById('entries');
  var productTitle = document.getElementById('product-title');
  var productSub = document.getElementById('product-sub');
  var appsSection = document.getElementById('product-apps');
  var modulesSection = document.getElementById('product-modules');
  var modulesNote = document.getElementById('product-modules-note');
  var crumb = document.getElementById('crumb');
  var crumbHere = document.getElementById('crumb-here');
  var productsWrap = document.getElementById('products-wrap');
  var productsSection = document.getElementById('products');
  var remoteSection = document.getElementById('remote');
  var remoteNote = document.getElementById('remote-note');
  var diagnosticsWrap = document.getElementById('diagnostics-wrap');
  var diagnosticsBody = document.getElementById('diagnostics');
  var summary = document.getElementById('summary');
  var bridgeState = document.getElementById('bridge-state');
  var sessionWrap = document.getElementById('session-wrap');
  var loginForm = document.getElementById('login');
  var loginState = document.getElementById('login-state');
  var sessionState = document.getElementById('session-state');
  var sessionWho = document.getElementById('session-who');

  // --- 세션(desktop·browser 모드) ---------------------------------------------

  var session = { token: '', who: '', auth: null };

  function authHeaders() {
    return session.token
      ? { Authorization: 'Bearer ' + session.token, Accept: 'application/json' }
      : { Accept: 'application/json' };
  }

  // 이 Gateway의 세션을 누가 발급하는지는 Gateway가 안다(/health.auth).
  function readAuthInfo() {
    return fetch('/api/v1/health', { headers: { Accept: 'application/json' } })
      .then(function (response) { return response.json(); })
      .then(function (body) { session.auth = body.auth || { mode: 'none' }; return session.auth; })
      .catch(function () { session.auth = { mode: 'none' }; return session.auth; });
  }

  // 로그인은 Gateway의 중계 경로로 간다(auth_login.go). 이 페이지는 다른 앱과
  // 같이 connect-src 'self' 아래 있어 Master에 직접 닿을 수 없고, 그 격리를
  // 런처라고 풀지 않는다. Gateway는 본문과 응답을 그대로 넘기고 기록하지 않는다.
  function login(email, password) {
    var auth = session.auth || {};
    if (auth.mode !== 'master') {
      return Promise.reject(new Error('이 Gateway는 Master 로그인을 쓰지 않습니다 (mode ' + (auth.mode || 'none') + ')'));
    }
    return fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(failureText(body) || ('Master answered ' + response.status));
        // Master는 { ok, data: LoginResult } 봉투로 답한다(api/response.go).
        var data = body.data || {};
        var token = data.access_token || '';
        if (!token) throw new Error('Master 응답에 토큰이 없습니다');
        session.token = token;
        session.who = (data.user && (data.user.display_name || data.user.email)) || email;
      });
    });
  }

  function logout() {
    session.token = '';
    session.who = '';
  }

  function renderSession() {
    if (channel.mode === 'embedded') { sessionWrap.hidden = true; return; }
    // 첫 화면에서만 보인다 — 장면 전환은 showScene이 판정한다.
    sessionWrap.hidden = scene.name !== 'terra';
    var auth = session.auth || {};
    if (session.token) {
      loginForm.hidden = true;
      sessionState.hidden = false;
      sessionWho.textContent = session.who + ' 로그인됨';
      return;
    }
    sessionState.hidden = true;
    loginForm.hidden = auth.mode !== 'master';
    loginState.textContent = auth.mode === 'master' ? ''
      : auth.mode === 'open' ? 'Gateway가 dev-open 모드입니다 — 로그인 없이 모든 권한'
      : auth.mode === 'seeded' ? '토큰이 외부에서 배포되는 Gateway입니다'
      : 'Master가 연결되지 않은 Gateway입니다 — 원격 기능을 쓸 수 없습니다';
  }

  // 원격 조회·동기화를 이 페이지가 직접 한다. 경로는 셸의 remoteRequestPath
  // (webAppBridge.ts)와 같은 세 가지로 좁혀 둔다.
  function sessionRemote(action, target, done) {
    var method = 'GET';
    var path;
    target = target || {};
    var node = encodeURIComponent(target.nodeId || '');
    if (action === 'nodes') {
      path = '/api/v1/gui/remote/nodes';
    } else if (action === 'apps' && target.nodeId) {
      path = '/api/v1/gui/remote/' + node + '/apps';
    } else if (action === 'sync' && target.nodeId && target.moduleId && target.appId) {
      method = 'POST';
      path = '/api/v1/gui/remote/' + node + '/' + encodeURIComponent(target.moduleId) +
        '/' + encodeURIComponent(target.appId) + '/sync';
    } else {
      done({ ok: false, error: '잘못된 원격 요청' });
      return;
    }
    fetch(path, { method: method, headers: authHeaders() })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          done({ ok: response.ok, status: response.status, data: body, error: response.ok ? undefined : body });
        });
      })
      .catch(function (error) { done({ ok: false, error: String(error) }); });
  }

  // W-D2: 창 앱에 넘길 스코프 토큰. 세션이 없거나 교집합이 비면 빈 문자열 —
  // 그 앱은 토큰 없이 열린다(API 접근 없음). 실패가 아니다.
  function mintScopeToken(appId) {
    if (!session.token) return Promise.resolve('');
    return fetch('/api/v1/gui/apps/' + encodeURIComponent(appId) + '/token', { method: 'POST', headers: authHeaders() })
      .then(function (response) {
        if (!response.ok) return '';
        return response.json().then(function (body) { return (body && body.token) || ''; }).catch(function () { return ''; });
      })
      .catch(function () { return ''; });
  }

  function windowUrl(origin, scopeToken) {
    if (!scopeToken) return origin;
    return origin + '/#terra_token=' + encodeURIComponent(scopeToken) +
      '&terra_gateway=' + encodeURIComponent(window.location.origin);
  }

  // --- 장면 ------------------------------------------------------------------
  // 한 페이지 안에서 보이는 절을 바꾼다. 어느 장면인지는 한 곳(scene)에만
  // 있고, 그리는 일은 showScene이 몰아서 한다 — 절마다 hidden을 따로 만지면
  // 두 장면이 동시에 보이는 상태가 생긴다.

  var PRODUCTS = {
    tree: { title: 'Tree', sub: '클러스터를 관리하는 제품 — Master와 그 위의 모듈' },
    leaf: { title: 'Leaf', sub: '노드에서 실행되는 제품 — Daemon과 그 위의 모듈' },
    common: { title: '공통 모듈', sub: 'Tree와 Leaf 양쪽에서 쓰이는 모듈' }
  };

  var scene = { name: 'terra', product: '' };
  // 마지막으로 읽은 앱·모듈 목록. 장면을 옮길 때마다 다시 부르지 않는다.
  var catalog = { apps: [], modules: [], diagnostics: [] };

  function showScene(name, product) {
    scene = { name: name, product: product || '' };
    sceneTerra.hidden = name !== 'terra';
    sceneProduct.hidden = name !== 'product';
    sceneRemote.hidden = name !== 'remote';
    // 로그인은 첫 화면의 것이다 — 하위 장면에서 폼이 따라다닐 이유가 없다.
    sessionWrap.hidden = name !== 'terra' || channel.mode === 'embedded';
    crumb.hidden = name === 'terra';
    if (name === 'product') {
      var definition = PRODUCTS[product] || { title: product, sub: '' };
      crumbHere.textContent = definition.title;
      productTitle.textContent = definition.title;
      productSub.textContent = definition.sub;
      renderProductScene(product);
    } else if (name === 'remote') {
      crumbHere.textContent = '원격 노드';
      refreshRemote();
    } else {
      renderEntries();
    }
  }

  // 앱·모듈이 어느 제품 것인지. 선언이 없으면 제약이 없다는 뜻이고, 둘 다
  // 선언했으면 공통이다.
  function ownerOf(products) {
    var list = products || [];
    if (list.length === 0) return 'common';
    var tree = list.indexOf('tree') >= 0;
    var leaf = list.indexOf('leaf') >= 0;
    if (tree && leaf) return 'common';
    if (tree) return 'tree';
    if (leaf) return 'leaf';
    return 'common';
  }

  function countFor(product) {
    var apps = 0;
    var modules = 0;
    catalog.apps.forEach(function (app) { if (ownerOf(app.products) === product) apps += 1; });
    catalog.modules.forEach(function (module) { if (ownerOf(module.products) === product) modules += 1; });
    return { apps: apps, modules: modules };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function badge(text, kind) {
    return el('span', 'badge badge-' + kind, text);
  }

  // --- 셸 채널 ---------------------------------------------------------------
  // 창을 여는 능력은 이 페이지에 없다. 어느 쪽이든 요청을 보낼 뿐이고, 여는
  // 쪽이 origin을 재검증하고 헬스를 확인한 뒤 연다.

  var webviewHost = window.chrome && window.chrome.webview;
  var parentShell = window.parent && window.parent !== window ? window.parent : null;
  var channel = webviewHost ? desktopChannel() : parentShell ? embeddedChannel() : browserChannel();

  function newRequestId() {
    return 'req-' + (++windowOpenCounter) + '-' + Date.now().toString(16);
  }

  // 데스크톱 런처 창: 셸과 직접 대화한다(N-M3의 terra.window.request 채널).
  // 제품 목록·제품 실행이 이 모드에서만 가능한 이유는, 무엇을 실행할 수
  // 있는지 아는 주체가 셸이기 때문이다.
  function desktopChannel() {
    var pending = {};
    function receive(event) {
      var payload = event.data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (ignored) { return; }
      }
      if (!payload || typeof payload.requestId !== 'string') return;
      // 진행 상황은 상관을 소비하지 않는다 — 최종 응답이 따로 온다.
      if (payload.type === 'terra.window.progress') {
        var watcher = pending[payload.requestId];
        if (watcher && watcher.progress && payload.data) watcher.progress(payload.data.message || '');
        return;
      }
      var settle = pending[payload.requestId];
      if (!settle) return;
      delete pending[payload.requestId];
      settle.done(payload);
    }
    webviewHost.addEventListener('message', receive);

    function send(message, done, progress) {
      var id = newRequestId();
      pending[id] = { done: done, progress: progress };
      message.requestId = id;
      webviewHost.postMessage(message);
    }
    return {
      mode: 'desktop',
      supportsProducts: true,
      describe: '데스크톱 런처 — 제품과 확장 모듈을 모두 실행할 수 있습니다',
      openApp: function (app, done, progress) {
        var origin = (app.window && app.window.origin) || '';
        // 스코프 토큰은 url에만 실린다 — origin은 셸이 정책·단일 인스턴스
        // 판정에 쓰고, url이 origin 안인지도 셸이 다시 검증한다.
        mintScopeToken(app.id).then(function (scopeToken) {
          send({
            type: 'terra.window.request',
            appId: app.id,
            origin: origin,
            url: windowUrl(origin, scopeToken),
            health: (app.window && app.window.health) || '',
            singleInstance: !!(app.window && app.window.singleInstance)
          }, done, progress);
        });
      },
      // 원격은 이 페이지의 세션으로 직접 한다 — C# 셸은 토큰을 모른다.
      supportsRemote: true,
      remote: sessionRemote,
      // 제품은 id만 말한다 — origin은 셸이 자기 프로필에서 정한다.
      openProduct: function (product, done, progress) {
        send({ type: 'terra.window.request', productId: product.id }, done, progress);
      },
      listProducts: function (done) {
        send({ type: 'terra.products.request' }, done);
      }
    };
  }

  // 제품 셸 안 iframe: 부모 셸이 기동·게시 대기·헬스·창 오픈을 대신한다.
  function embeddedChannel() {
    return {
      mode: 'embedded',
      supportsProducts: false,
      describe: '셸 안에서 열림',
      openApp: function (app, done) {
        var id = 'win-' + (++windowOpenCounter);
        pendingWindowOpens[id] = done;
        parentShell.postMessage({ type: BRIDGE_OPEN_WINDOW, id: id, appId: app.id }, '*');
      },
      // 정적 앱은 셸의 프레임 안에서 산다. 이 런처도 그 프레임 중 하나라
      // 형제 앱을 자기 손으로 띄울 수 없다 — 띄울 수 있으면 그게 프레임
      // 탈출이다. 그래서 프레임을 쥔 셸에 청한다.
      supportsMount: true,
      mountApp: function (app, done) {
        var id = 'mount-' + (++windowOpenCounter);
        pendingWindowOpens[id] = done;
        parentShell.postMessage({ type: BRIDGE_MOUNT_APP, id: id, appId: app.id }, '*');
      },
      // 원격 조회·동기화는 사용자 토큰이 필요하고 그 토큰은 셸에만 있다(W-M5).
      supportsRemote: true,
      remote: function (action, target, done) {
        var id = 'rem-' + (++windowOpenCounter);
        pendingWindowOpens[id] = done;
        var message = { type: BRIDGE_REMOTE, id: id, action: action };
        if (target) {
          message.nodeId = target.nodeId;
          message.moduleId = target.moduleId;
          message.appId = target.appId;
        }
        parentShell.postMessage(message, '*');
      }
    };
  }

  // 브라우저 직접 열람: 기동은 요청할 수 없고(셸의 일), 로그인하면 원격과
  // 스코프 토큰은 된다.
  function browserChannel() {
    return {
      mode: 'browser',
      supportsProducts: false,
      describe: '직접 열람 모드',
      // 셸이 없으니 프레임도 없다. 정적 앱은 그냥 자기 자산 주소로 열면 되고,
      // 그 주소는 이 페이지와 같은 origin이다.
      supportsMount: true,
      mountApp: function (app, done) {
        var opened = window.open(appEntryUrl(app), '_blank', 'noopener');
        done(opened ? { ok: true, data: { state: 'opened' } } : {
          ok: false,
          error: { code: 'POPUP_BLOCKED', message: '브라우저가 새 창을 막았습니다' }
        });
      },
      openApp: function (app, done) {
        if (app.window && app.window.status === 'published' && app.window.origin) {
          mintScopeToken(app.id).then(function (scopeToken) {
            // noopener 원칙(설계 §6): 창 앱은 opener로 이 페이지에 닿을 수 없다.
            window.open(windowUrl(app.window.origin, scopeToken), '_blank', 'noopener');
            done({ ok: true, data: { state: 'opened' } });
          });
          return;
        }
        done({ ok: false, error: '셸 안에서만 기동을 요청할 수 있습니다' });
      },
      supportsRemote: true,
      remote: sessionRemote
    };
  }

  function failureText(response) {
    if (!response) return '알 수 없는 오류';
    if (typeof response.error === 'string') return response.error;
    if (response.error && response.error.message) return response.error.message;
    return '알 수 없는 오류';
  }

  // --- 첫 화면의 진입 카드 ----------------------------------------------------

  function entryCard(title, description, detail, onOpen, disabledReason) {
    var card = el('article', 'card entry');
    card.appendChild(el('h3', 'card-title', title));
    card.appendChild(el('p', 'card-line', description));
    if (detail) card.appendChild(el('p', 'card-line sub', detail));
    var wrap = el('p', 'card-line');
    var button = el('button', 'window-open', '열기');
    if (disabledReason) {
      button.disabled = true;
      wrap.appendChild(button);
      wrap.appendChild(el('span', 'window-open-status', ' ' + disabledReason));
    } else {
      button.addEventListener('click', onOpen);
      wrap.appendChild(button);
    }
    card.appendChild(wrap);
    return card;
  }

  function renderEntries() {
    entriesSection.textContent = '';
    ['tree', 'leaf', 'common'].forEach(function (product) {
      var counts = countFor(product);
      entriesSection.appendChild(entryCard(
        PRODUCTS[product].title,
        PRODUCTS[product].sub,
        counts.apps + '개 앱 · ' + counts.modules + '개 모듈',
        function () { showScene('product', product); }
      ));
    });
    var remoteReason = '';
    if (!channel.supportsRemote) {
      remoteReason = '이 자리에서는 조회할 수 없습니다';
    } else if (channel.mode !== 'embedded' && !session.token) {
      remoteReason = '로그인이 필요합니다';
    }
    entriesSection.appendChild(entryCard(
      '원격 노드',
      '다른 노드에 설치된 앱을 가져와 엽니다',
      '',
      function () { showScene('remote'); },
      remoteReason
    ));
  }

  // --- 제품 장면 --------------------------------------------------------------

  function renderProductScene(product) {
    appsSection.textContent = '';
    modulesSection.textContent = '';
    var apps = catalog.apps.filter(function (app) { return ownerOf(app.products) === product; });
    var modules = catalog.modules.filter(function (module) { return ownerOf(module.products) === product; });

    if (apps.length === 0) {
      appsSection.appendChild(el('p', 'sub', '이 제품이 제공하는 앱이 없습니다.'));
    } else {
      apps.forEach(function (app) { appsSection.appendChild(appCard(app)); });
    }
    modulesNote.textContent = modules.length + '개';
    if (modules.length === 0) {
      modulesSection.appendChild(el('p', 'sub', '설치된 모듈이 없습니다.'));
    } else {
      modules.forEach(function (module) { modulesSection.appendChild(moduleCard(module)); });
    }
  }

  // 모듈 카드와 "관리". 앱은 모듈이 기여한 것 중 하나일 뿐이라, 앱을 내지 않는
  // 모듈은 지금까지 런처에 아예 나타나지 않았다 — 무엇이 깔려 있는지 물을
  // 자리가 없었다.
  function moduleCard(module) {
    var card = el('article', 'card');
    card.appendChild(el('h3', 'card-title', module.name || module.id));
    var meta = el('p', 'card-meta');
    if (module.kind) meta.appendChild(badge(module.kind, 'mode'));
    (module.products || []).forEach(function (product) { meta.appendChild(badge(product, 'perm')); });
    card.appendChild(meta);
    card.appendChild(el('p', 'card-line', module.id + (module.version ? ' v' + module.version : '')));
    if (module.description) card.appendChild(el('p', 'card-line sub', module.description));

    var panel = el('div', 'manage-panel');
    panel.hidden = true;
    var wrap = el('p', 'card-line');
    var button = el('button', 'manage', '관리');
    button.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      button.textContent = panel.hidden ? '관리' : '닫기';
      if (!panel.hidden && panel.childNodes.length === 0) {
        renderManagePanel(panel, module);
      }
    });
    wrap.appendChild(button);
    card.appendChild(wrap);
    card.appendChild(panel);
    return card;
  }

  function propertyRow(table, label, value) {
    var row = el('tr');
    row.appendChild(el('th', '', label));
    var cell = el('td');
    if (typeof value === 'string') {
      cell.appendChild(el('span', 'mono', value));
    } else {
      cell.appendChild(value);
    }
    row.appendChild(cell);
    table.appendChild(row);
  }

  function renderManagePanel(panel, module) {
    var table = el('table', 'properties');
    propertyRow(table, '설치 위치', module.directory || '(알 수 없음)');
    propertyRow(table, '소유 제품', (module.products || []).join(', ') || '제약 없음 (공통)');

    var entrypoints = module.entrypoints || {};
    var targets = Object.keys(entrypoints).sort();
    if (targets.length === 0) {
      propertyRow(table, '실행 파일', '없음 — 데이터 모듈');
    } else {
      var list = el('div');
      targets.forEach(function (target) {
        list.appendChild(el('p', 'mono', target + ' → ' + entrypoints[target]));
      });
      propertyRow(table, '실행 파일', list);
    }

    var environment = module.environment || {};
    var keys = Object.keys(environment).sort();
    if (keys.length === 0) {
      propertyRow(table, '환경 변수', '없음 — 실행되지 않는 모듈');
    } else {
      var envList = el('div');
      keys.forEach(function (key) {
        envList.appendChild(el('p', 'mono', key + '=' + environment[key]));
      });
      propertyRow(table, '환경 변수', envList);
    }

    var dependencies = module.dependencies || [];
    if (dependencies.length === 0) {
      propertyRow(table, '종속 확장 모듈', '없음');
    } else {
      var depList = el('div');
      dependencies.forEach(function (dependency) {
        var text = dependency.id || dependency.capability || '(이름 없음)';
        if (dependency.versionRange) text += ' ' + dependency.versionRange;
        if (!dependency.id && dependency.capability) text += ' (capability)';
        depList.appendChild(el('p', 'mono', text));
      });
      propertyRow(table, '종속 확장 모듈', depList);
    }

    var contributes = module.contributes || {};
    var contributed = []
      .concat(contributes.apps || [])
      .concat(contributes.scenes || [])
      .concat(contributes.renderers || []);
    propertyRow(table, '기여', contributed.length ? contributed.join(', ') : '없음');
    panel.appendChild(table);
  }

  // --- 제품 셸 카드 -----------------------------------------------------------

  function renderProducts(products) {
    productsSection.textContent = '';
    products.forEach(function (product) {
      var card = el('article', 'card');
      card.appendChild(el('h3', 'card-title', product.name || product.id));
      var meta = el('p', 'card-meta');
      meta.appendChild(badge('product', 'mode'));
      if (product.current) meta.appendChild(badge('this node', 'self'));
      // 사용자가 알고 싶은 것은 설치 여부가 아니라 "지금 열 수 있는가"다.
      if (product.state === 'running') {
        meta.appendChild(badge('실행 중', 'self'));
      } else if (product.state === 'not-installed') {
        meta.appendChild(badge('미설치', 'none'));
      } else {
        meta.appendChild(badge('중지됨', 'none'));
      }
      card.appendChild(meta);

      var wrap = el('p', 'card-line');
      // 떠 있으면 여는 것이고, 아니면 기동부터 하는 것이다 — 버튼이 그 차이를 말한다.
      var button = el('button', 'window-open', product.state === 'running' ? '열기' : '실행');
      var status = el('span', 'window-open-status', '');
      button.disabled = product.state === 'not-installed';
      button.addEventListener('click', function () {
        button.disabled = true;
        status.textContent = product.state === 'running' ? ' 여는 중…' : ' 준비 중…';
        channel.openProduct(product, function (response) {
          button.disabled = false;
          status.textContent = response.ok
            ? (response.data && response.data.state === 'focused' ? ' 이미 열린 창으로 이동' : ' 열림')
            : ' 실패: ' + failureText(response);
        }, function (message) {
          if (message) status.textContent = ' ' + message;
        });
      });
      wrap.appendChild(button);
      wrap.appendChild(status);
      card.appendChild(wrap);
      productsSection.appendChild(card);
    });
    productsWrap.hidden = products.length === 0;
  }

  // --- 원격 노드 앱 -----------------------------------------------------------
  // 자산은 인증 없이 서빙되지만, 어떤 노드를 볼 수 있는지와 그 패키지를
  // 당겨와도 되는지는 사용자마다 다르다. 그래서 조회·동기화만 셸을 거치고,
  // 열기는 이 페이지가 직접 한다(같은 origin이다).

  function remoteAssetUrl(node, app) {
    return '/api/v1/gui/remote/' + encodeURIComponent(node) +
      '/' + encodeURIComponent(app.moduleId) +
      '/' + encodeURIComponent(app.id) + '/files/';
  }

  function renderRemoteApps(node, apps) {
    apps.forEach(function (app) {
      var card = el('article', 'card');
      card.appendChild(el('h3', 'card-title', app.name || app.id));
      var meta = el('p', 'card-meta');
      meta.appendChild(badge(app.mode, 'mode'));
      meta.appendChild(badge(node, 'self'));
      card.appendChild(meta);
      card.appendChild(el('p', 'card-line', app.moduleId));

      var wrap = el('p', 'card-line');
      var status = el('span', 'window-open-status', '');
      // static 앱만 자산을 갖는다 — proxied/window는 원격으로 나를 패키지가 없다.
      if (app.mode !== 'static') {
        wrap.appendChild(el('span', 'window-open-status', '원격으로 열 수 없는 모드입니다'));
        card.appendChild(wrap);
        remoteSection.appendChild(card);
        return;
      }
      var button = el('button', 'window-open', app.assetsAvailable ? '열기' : '가져와서 열기');
      button.addEventListener('click', function () {
        button.disabled = true;
        status.textContent = ' 가져오는 중…';
        channel.remote('sync', { nodeId: node, moduleId: app.moduleId, appId: app.id }, function (response) {
          button.disabled = false;
          if (!response.ok) {
            status.textContent = ' 실패: ' + failureText(response);
            return;
          }
          var fetched = response.data && response.data.fetched;
          status.textContent = fetched ? ' 받아옴 — 여는 중' : ' 최신 — 여는 중';
          // 자산은 같은 origin에 있으므로 셸을 거치지 않는다.
          window.open(remoteAssetUrl(node, app), '_blank', 'noopener');
        });
      });
      wrap.appendChild(button);
      wrap.appendChild(status);
      card.appendChild(wrap);
      remoteSection.appendChild(card);
    });
  }

  function refreshRemote() {
    remoteSection.textContent = '';
    if (!channel.supportsRemote) {
      remoteNote.textContent = '이 자리에서는 원격 노드를 조회할 수 없습니다.';
      return;
    }
    if (channel.mode !== 'embedded' && !session.token) {
      remoteNote.textContent = '원격 노드를 보려면 로그인하세요.';
      return;
    }
    remoteNote.textContent = '노드를 조회하는 중…';
    channel.remote('nodes', null, function (response) {
      if (!response.ok) {
        remoteNote.textContent = '원격 노드를 조회하지 못했습니다: ' + failureText(response);
        return;
      }
      var nodes = (response.data && response.data.nodes) || [];
      if (nodes.length === 0) {
        remoteNote.textContent = '볼 수 있는 원격 노드가 없습니다.';
        return;
      }
      remoteNote.textContent = nodes.length + '개 노드';
      nodes.forEach(function (node) {
        channel.remote('apps', { nodeId: node.id }, function (appsResponse) {
          if (!appsResponse.ok) return;
          var apps = (appsResponse.data && appsResponse.data.apps) || [];
          renderRemoteApps(node.id, apps);
        });
      });
    });
  }

  // 정적 앱의 진입 문서 주소. Gateway는 앱 파일 네임스페이스를 entry의
  // 디렉터리 기준으로 잡으므로, 여기서 붙일 것은 entry의 파일 이름뿐이다.
  function appEntryUrl(app) {
    return '/api/v1/gui/apps/' + encodeURIComponent(app.id) + '/files/' + (app.entry || 'index.html');
  }

  // 정적 앱을 여는 컨트롤.
  //
  // 창 앱의 것과 나란히 두는 이유가 있다. 지금까지 런처는 정적 앱 카드에
  // route를 적어 놓고 열 방법을 주지 않았다 — 주소가 보이는데 누를 것이 없으니
  // "왜 이건 못 열지"가 된다. 여는 방식이 다를 뿐 열 수 있다는 사실은 같다.
  function mountOpenControl(app) {
    var wrap = el('p', 'card-line');
    var button = el('button', 'window-open', '열기');
    var status = el('span', 'window-open-status', '');
    button.addEventListener('click', function () {
      button.disabled = true;
      status.textContent = ' 여는 중…';
      channel.mountApp(app, function (response) {
        button.disabled = false;
        status.textContent = response.ok ? ' 열림' : ' 실패: ' + failureText(response);
      });
    });
    wrap.appendChild(button);
    wrap.appendChild(status);
    return wrap;
  }

  function appCard(app) {
    var card = el('article', 'card');
    card.appendChild(el('h3', 'card-title', app.name || app.id));
    var meta = el('p', 'card-meta');
    meta.appendChild(badge(app.mode, 'mode'));
    // window apps have no isolation/route — a top-level window is not embedded.
    if (app.isolation) {
      meta.appendChild(badge(app.isolation, 'isolation'));
    }
    if (app.id === 'io.terra.webapp-host') {
      meta.appendChild(badge('this app', 'self'));
    }
    card.appendChild(meta);
    card.appendChild(el('p', 'card-line', app.moduleId + (app.moduleVersion ? ' v' + app.moduleVersion : '')));
    if (app.route) {
      card.appendChild(el('p', 'card-line mono', app.route));
    }
    if (app.window) {
      card.appendChild(el('p', 'card-line', '창 앱 — ' + (app.window.status === 'published' ? app.window.origin : '게시 대기 (미기동)')));
      card.appendChild(windowOpenControl(app));
    } else if (app.id !== 'io.terra.webapp-host' && app.entry) {
      // 자기 자신은 빼둔다 — 지금 보고 있는 것을 여는 단추는 혼란만 준다.
      if (channel.supportsMount) {
        card.appendChild(mountOpenControl(app));
      } else {
        card.appendChild(el('p', 'card-line', '제품 셸의 Apps 목록에서 열립니다'));
      }
    }
    var permissions = app.permissions || [];
    var permissionLine = el('p', 'card-perms');
    if (permissions.length === 0) {
      permissionLine.appendChild(badge('no API access', 'none'));
    } else {
      permissions.forEach(function (permission) {
        permissionLine.appendChild(badge(permission, 'perm'));
      });
    }
    card.appendChild(permissionLine);
    return card;
  }

  function renderDiagnostics(diagnostics) {
    diagnosticsBody.textContent = '';
    diagnosticsWrap.hidden = diagnostics.length === 0;
    diagnostics.forEach(function (diagnostic) {
      var row = el('tr');
      row.appendChild(el('td', '', diagnostic.moduleId || ''));
      row.appendChild(el('td', '', diagnostic.sceneId || ''));
      row.appendChild(el('td', 'mono', diagnostic.code || ''));
      row.appendChild(el('td', '', diagnostic.message || ''));
      diagnosticsBody.appendChild(row);
    });
  }

  // 창 앱 실행 컨트롤 (창 모드 설계 N-M2, §7): 기동·게시 대기·헬스·창 오픈은
  // 전부 여는 쪽의 일이다. 이 버튼은 요청만 보내고 결과를 표시한다.
  function windowOpenControl(app) {
    var wrap = el('p', 'card-line');
    var button = el('button', 'window-open', '창에서 열기');
    var status = el('span', 'window-open-status', '');
    button.addEventListener('click', function () {
      button.disabled = true;
      status.textContent = ' 여는 중…';
      channel.openApp(app, function (response) {
        button.disabled = false;
        status.textContent = response.ok
          ? (response.data && response.data.state === 'focused' ? ' 이미 열린 창으로 이동' : ' 열림')
          : ' 실패: ' + failureText(response);
        // 성공했으면 게시 상태가 바뀌었을 수 있으니 목록을 갱신한다.
        // 실패 메시지는 카드에 남아야 하니 그대로 둔다.
        if (response.ok) refresh();
      }, function (message) {
        if (message) status.textContent = ' ' + message;
      });
    });
    wrap.appendChild(button);
    wrap.appendChild(status);
    return wrap;
  }

  // 앱과 모듈을 함께 읽는다. 두 목록이 한 화면의 두 절이므로 따로 새로고침되면
  // 개수가 어긋난 채로 보인다.
  function refresh() {
    summary.textContent = '불러오는 중…';
    var readJSON = function (path) {
      return fetch(path, { headers: { Accept: 'application/json' } }).then(function (response) {
        if (!response.ok) throw new Error(path + ' → ' + response.status);
        return response.json();
      });
    };
    return Promise.all([readJSON('/api/v1/gui/apps'), readJSON('/api/v1/gui/modules')])
      .then(function (results) {
        catalog.apps = results[0].apps || [];
        catalog.modules = results[1].modules || [];
        catalog.diagnostics = results[0].diagnostics || [];
        summary.textContent = catalog.apps.length + ' app(s) · ' + catalog.modules.length + ' module(s)';
        renderDiagnostics(catalog.diagnostics);
        // 지금 보고 있는 장면을 그대로 다시 그린다.
        showScene(scene.name, scene.product);
      })
      .catch(function (cause) {
        summary.textContent = '목록을 읽지 못했습니다: ' + cause.message;
      });
  }

  function refreshProducts() {
    if (!channel.supportsProducts) return;
    channel.listProducts(function (response) {
      if (response.ok && response.data && response.data.products) {
        renderProducts(response.data.products);
      }
    });
  }

  document.getElementById('refresh').addEventListener('click', function () {
    refresh();
    refreshProducts();
    if (scene.name === 'remote') refreshRemote();
  });
  document.getElementById('crumb-home').addEventListener('click', function () {
    showScene('terra');
  });
  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var submit = document.getElementById('login-submit');
    var passwordField = document.getElementById('login-password');
    submit.disabled = true;
    loginState.textContent = '로그인 중…';
    login(document.getElementById('login-email').value.trim(), passwordField.value)
      .then(function () {
        passwordField.value = '';
        loginState.textContent = '';
        renderSession();
        showScene(scene.name, scene.product);
      })
      .catch(function (error) { loginState.textContent = '실패: ' + error.message; })
      .then(function () { submit.disabled = false; });
  });
  document.getElementById('logout').addEventListener('click', function () {
    logout();
    renderSession();
    showScene('terra');
  });
  showScene('terra');
  refresh();
  refreshProducts();
  readAuthInfo().then(function () {
    renderSession();
    renderEntries();
  });

  if (channel.mode === 'desktop') {
    // 데스크톱 런처 창: 브리지 handshake가 필요 없다. 부모 셸이 없고, 셸과의
    // 대화는 WebView2 채널로 직접 이뤄진다.
    bridgeState.dataset.state = 'ready';
    bridgeState.textContent = channel.describe;
  } else if (parentShell) {
    // Bridge handshake. The request carries no secret, so '*' is fine outbound;
    // the answer is only trusted when it came from our own parent window.
    window.addEventListener('message', function (event) {
      if (event.source !== window.parent) return;
      var payload = event.data;
      if (!payload) return;
      if (payload.type === BRIDGE_RESPONSE && pendingWindowOpens[payload.id]) {
        var settle = pendingWindowOpens[payload.id];
        delete pendingWindowOpens[payload.id];
        settle(payload);
        return;
      }
      if (payload.type !== BRIDGE_READY) return;
      var permissions = payload.permissions || [];
      bridgeState.dataset.state = 'ready';
      bridgeState.textContent = permissions.length
        ? '셸 브리지 연결됨 — 부여 권한: ' + permissions.join(', ')
        : '셸 브리지 연결됨 — 이 앱은 API 권한을 선언하지 않았습니다';
    });
    window.parent.postMessage({ type: BRIDGE_HELLO }, '*');
    window.setTimeout(function () {
      if (bridgeState.dataset.state === 'probing') {
        bridgeState.dataset.state = 'absent';
        bridgeState.textContent = '셸 브리지 없음 (직접 열람 모드)';
      }
    }, 1500);
  } else {
    bridgeState.dataset.state = 'absent';
    bridgeState.textContent = '셸 밖에서 열림 (직접 열람 모드)';
  }
})();
