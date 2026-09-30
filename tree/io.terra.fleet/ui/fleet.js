// Fleet console — a read-first view of the Tree's fleets, served as a
// sandboxed static app under the Gateway.
//
// Every call goes through this module's own Gateway surface
// (/api/modules/io.terra.fleet/v1/...), never the Master's /api/v1/fleets
// routes: the app carries a scope token for the module namespace, and the
// module relays each call into the Master core operation after stamping the
// verified principal. That is why this console can only do what the module
// exposes — see the note under a fleet for what is missing and why.
(function () {
  'use strict';

  var API = '/api/modules/io.terra.fleet/v1';

  var state = {
    token: '',        // app scope token, handed over in the launch fragment
    fleets: [],
    selected: '',     // fleet_id
    detail: null,     // { fleet, slots }
    codes: []
  };

  // ---- launch handover -----------------------------------------------------

  // The launcher mints a scope token and passes it as
  // #terra_token=<token>&terra_gateway=<origin> (WebApp Host W-M6). Reading it
  // once and clearing the fragment keeps the credential out of the address bar
  // and out of anything that later copies location.href.
  function readLaunchFragment() {
    var hash = String(window.location.hash || '').replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    var token = params.get('terra_token');
    if (token) state.token = token;
    if (token && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  function authHeaders() {
    var headers = { Accept: 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return headers;
  }

  // ---- transport -----------------------------------------------------------

  function request(method, path, body) {
    var init = { method: method, headers: authHeaders() };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(API + path, init).then(function (response) {
      var isJSON = (response.headers.get('Content-Type') || '').indexOf('json') >= 0;
      return (isJSON ? response.json() : response.text()).then(function (payload) {
        if (response.ok) return payload;
        // The module answers errors as {code, message}; anything else is
        // reported as the bare status so the cause stays visible.
        var message = payload && payload.message ? payload.message : String(response.status);
        var code = payload && payload.code ? payload.code : '';
        var error = new Error(code ? code + ': ' + message : message);
        error.status = response.status;
        error.code = code;
        throw error;
      });
    });
  }

  // ---- rendering helpers ---------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function cell(row, text, className) {
    var empty = text === undefined || text === null || text === '';
    row.appendChild(el('td', className || null, empty ? '\u2013' : text));
  }

  function toast(message, bad) {
    var node = document.getElementById('toast');
    node.textContent = message;
    node.className = bad ? 'toast bad' : 'toast';
    node.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(function () { node.hidden = true; }, 4000);
  }

  function fail(error) {
    toast(error && error.message ? error.message : '요청이 실패했습니다', true);
  }

  function setSessionPill() {
    var pill = document.getElementById('session-pill');
    pill.textContent = state.token ? '앱 토큰 있음' : '세션 없음';
    pill.className = state.token ? 'pill ok' : 'pill bad';
  }

  // A slot's registration state is the one field worth colouring: it separates
  // a live seat from a retired one.
  function stateClass(value) {
    var text = String(value || '').toLowerCase();
    if (text === 'running' || text === 'claimed' || text === 'active') return 'state run';
    if (text === 'stopped' || text === 'pending' || text === 'unclaimed') return 'state stop';
    if (text === 'retired' || text === 'missing' || text === 'exited') return 'state gone';
    return 'state';
  }

  // ---- fleet list ----------------------------------------------------------

  function renderFleetList() {
    var host = document.getElementById('fleet-list');
    host.textContent = '';
    if (!state.fleets.length) {
      host.appendChild(el('p', 'empty', 'Fleet이 없습니다.'));
      return;
    }
    state.fleets.forEach(function (fleet) {
      var button = el('button');
      button.type = 'button';
      button.setAttribute('aria-current', fleet.fleet_id === state.selected ? 'true' : 'false');
      button.appendChild(el('span', 'slug', fleet.slug || fleet.fleet_id));
      button.appendChild(el('span', 'sub', (fleet.profile || 'node') + ' \u00b7 ' + (fleet.fleet_id || '')));
      button.addEventListener('click', function () { select(fleet.fleet_id); });
      host.appendChild(button);
    });
  }

  // Declaring a fleet needs only a slug; the image is what members run, so the
  // console asks for it up front rather than letting a fleet exist that cannot
  // start a seat (StartSlot refuses a fleet without an image).
  function createFleet() {
    var slug = window.prompt('새 Fleet의 slug (예: io-workers)', '');
    if (!slug) return;
    var image = window.prompt('멤버가 실행할 이미지 (예: terra-daemon:latest)', '');
    if (image === null) return;
    var body = { slug: slug.trim() };
    if (image.trim()) body.image_ref = image.trim();
    request('POST', '/fleets', body)
      .then(function (payload) {
        toast('Fleet을 선언했습니다');
        var made = payload && payload.fleet;
        return loadFleets().then(function () {
          if (made && made.fleet_id) select(made.fleet_id);
        });
      })
      .catch(fail);
  }

  function loadFleets() {
    return request('GET', '/fleets')
      .then(function (payload) {
        state.fleets = (payload && payload.fleets) || [];
        renderFleetList();
        if (!state.selected && state.fleets.length) select(state.fleets[0].fleet_id);
      })
      .catch(function (error) {
        var host = document.getElementById('fleet-list');
        host.textContent = '';
        host.appendChild(el('p', 'empty', '목록을 읽지 못했습니다.'));
        fail(error);
      });
  }

  // ---- fleet detail --------------------------------------------------------

  function select(fleetID) {
    state.selected = fleetID;
    renderFleetList();
    Promise.all([
      request('GET', '/fleets/' + encodeURIComponent(fleetID)),
      request('GET', '/fleets/' + encodeURIComponent(fleetID) + '/codes')
        .catch(function () { return { codes: [] }; })
    ]).then(function (results) {
      state.detail = results[0] || null;
      state.codes = (results[1] && results[1].codes) || [];
      renderDetail();
    }).catch(fail);
  }

  function renderDetail() {
    var main = document.getElementById('main');
    main.textContent = '';
    if (!state.detail || !state.detail.fleet) {
      main.appendChild(el('p', 'empty', '왼쪽에서 Fleet을 선택하십시오.'));
      return;
    }
    var fleet = state.detail.fleet;

    main.appendChild(el('h1', null, fleet.slug || fleet.fleet_id));
    var meta = [fleet.fleet_id, 'profile ' + (fleet.profile || 'node')];
    if (fleet.image_ref) meta.push(fleet.image_ref);
    if (fleet.max_nodes) meta.push('max ' + fleet.max_nodes);
    if (fleet.cell && fleet.cell.leaf_count) {
      meta.push('cell: leaf \u00d7' + fleet.cell.leaf_count +
        (fleet.cell.leaf_image_ref ? ' (' + fleet.cell.leaf_image_ref + ')' : ''));
    }
    main.appendChild(el('p', 'meta', meta.join(' \u00b7 ')));

    renderSlots(main, fleet);
    renderCodes(main, fleet);
    renderGapNote(main);
  }

  function renderSlots(main, fleet) {
    main.appendChild(el('h2', null, '슬롯'));

    var form = el('div', 'row');
    var hostInput = el('input');
    hostInput.placeholder = 'host node_id';
    var countInput = el('input');
    countInput.type = 'number';
    countInput.min = '1';
    countInput.value = '1';
    countInput.placeholder = '개수';
    var add = el('button', 'btn', '자리 추가');
    add.type = 'button';
    add.addEventListener('click', function () {
      addSlots(fleet.fleet_id, hostInput.value.trim(), countInput.value.trim());
    });
    [hostInput, countInput, add].forEach(function (node) { form.appendChild(node); });
    main.appendChild(form);
    var slots = (state.detail && state.detail.slots) || [];
    if (!slots.length) {
      main.appendChild(el('p', 'empty', '슬롯이 없습니다.'));
      return;
    }
    var card = el('div', 'card scroll');
    var table = el('table');
    var head = el('tr');
    ['#', 'slot_id', '호스트', '노드', '등록 상태', ''].forEach(function (label) {
      head.appendChild(el('th', null, label));
    });
    table.appendChild(el('thead')).appendChild(head);
    var body = el('tbody');

    slots.forEach(function (slot) {
      var row = el('tr');
      cell(row, slot.ordinal, 'num');
      cell(row, slot.slot_id, 'id');
      cell(row, slot.host_node_id, 'id');
      cell(row, slot.node_id, 'id');

      var stateCell = el('td');
      stateCell.appendChild(el('span', stateClass(slot.registration_state), slot.registration_state || '\u2013'));
      row.appendChild(stateCell);

      var actions = el('td', 'row');
      var start = el('button', 'btn', '기동');
      start.type = 'button';
      start.addEventListener('click', function () { startSlot(fleet.fleet_id, slot); });
      actions.appendChild(start);

      var stop = el('button', 'btn', '정지');
      stop.type = 'button';
      stop.addEventListener('click', function () { stopSlot(fleet.fleet_id, slot.slot_id); });
      actions.appendChild(stop);

      var remove = el('button', 'btn danger', '삭제');
      remove.type = 'button';
      remove.addEventListener('click', function () { deleteSlot(fleet.fleet_id, slot.slot_id); });
      actions.appendChild(remove);
      row.appendChild(actions);

      body.appendChild(row);
    });
    table.appendChild(body);
    card.appendChild(table);
    main.appendChild(card);
  }

  // Starting an unplaced seat needs a host: the placement is chosen once and
  // moving a seat afterwards is refused, so the prompt asks rather than guesses.
  function startSlot(fleetID, slot) {
    var host = slot.host_node_id;
    if (!host) {
      host = window.prompt('이 자리는 아직 배치되지 않았습니다. 호스트 node_id를 입력하십시오.', '');
      if (!host) return;
    }
    request('POST', '/fleets/' + encodeURIComponent(fleetID) +
      '/slots/' + encodeURIComponent(slot.slot_id) + '/start', { host_node_id: host })
      .then(function () { toast('기동을 요청했습니다 — 호스트가 곧 컨테이너를 띄웁니다'); select(fleetID); })
      .catch(fail);
  }

  // Stopping lowers the container and keeps the registration, so it needs no
  // confirmation: the seat and its identity survive.
  function stopSlot(fleetID, slotID) {
    request('POST', '/fleets/' + encodeURIComponent(fleetID) +
      '/slots/' + encodeURIComponent(slotID) + '/stop', {})
      .then(function () { toast('정지를 요청했습니다 (등록은 유지됩니다)'); select(fleetID); })
      .catch(fail);
  }

  function addSlots(fleetID, host, count) {
    request('POST', '/fleets/' + encodeURIComponent(fleetID) + '/slots',
      { host_node_id: host, count: Number(count) || 1 })
      .then(function (payload) {
        var made = (payload && payload.slots && payload.slots.length) || 0;
        toast(made + '개 자리를 만들었습니다');
        select(fleetID);
      })
      .catch(fail);
  }

  // Deleting a seat ends its registration — the one dangerous operation this
  // console can reach, so it asks first and names what is about to end.
  function deleteSlot(fleetID, slotID) {
    if (!window.confirm('슬롯 ' + slotID + '의 등록을 종료합니다. 계속할까요?')) return;
    request('DELETE', '/fleets/' + encodeURIComponent(fleetID) + '/slots/' + encodeURIComponent(slotID))
      .then(function () { toast('슬롯을 삭제했습니다'); select(fleetID); })
      .catch(fail);
  }

  function renderCodes(main, fleet) {
    main.appendChild(el('h2', null, 'Join code'));

    var form = el('div', 'row');
    var slotInput = el('input');
    slotInput.placeholder = 'slot_id (선택)';
    var usesInput = el('input');
    usesInput.type = 'number';
    usesInput.min = '1';
    usesInput.placeholder = 'max uses';
    var ttlInput = el('input');
    ttlInput.type = 'number';
    ttlInput.min = '1';
    ttlInput.placeholder = 'TTL(초)';
    var issue = el('button', 'btn primary', '발급');
    issue.type = 'button';
    issue.addEventListener('click', function () {
      issueCode(fleet.fleet_id, slotInput.value.trim(), usesInput.value.trim(), ttlInput.value.trim());
    });
    [slotInput, usesInput, ttlInput, issue].forEach(function (node) { form.appendChild(node); });
    main.appendChild(form);

    if (!state.codes.length) {
      main.appendChild(el('p', 'empty', '발급된 code가 없습니다.'));
      return;
    }
    var card = el('div', 'card scroll');
    var table = el('table');
    var head = el('tr');
    ['code_id', 'slot', '만료', 'max uses', ''].forEach(function (label) {
      head.appendChild(el('th', null, label));
    });
    table.appendChild(el('thead')).appendChild(head);
    var body = el('tbody');

    state.codes.forEach(function (code) {
      var id = code.code_id || code.id;
      var row = el('tr');
      cell(row, id, 'id');
      cell(row, code.slot_id, 'id');
      cell(row, code.expires_at, 'num');
      cell(row, code.max_uses, 'num');
      var actions = el('td');
      var revoke = el('button', 'btn danger', '무효화');
      revoke.type = 'button';
      revoke.addEventListener('click', function () { revokeCode(fleet.fleet_id, id); });
      actions.appendChild(revoke);
      row.appendChild(actions);
      body.appendChild(row);
    });
    table.appendChild(body);
    card.appendChild(table);
    main.appendChild(card);
  }

  // The plaintext code comes back exactly once — the store keeps only a hash —
  // so it is surfaced for copying and never re-fetched.
  function issueCode(fleetID, slotID, maxUses, ttl) {
    var body = {};
    if (slotID) body.slot_id = slotID;
    if (maxUses) body.max_uses = Number(maxUses);
    if (ttl) body.expires_in_sec = Number(ttl);
    request('POST', '/fleets/' + encodeURIComponent(fleetID) + '/codes', body)
      .then(function (payload) {
        if (payload && payload.code) {
          window.prompt('발급된 join code입니다. 지금 복사하십시오 — 다시 볼 수 없습니다.', payload.code);
        }
        toast('code를 발급했습니다');
        select(fleetID);
      })
      .catch(fail);
  }

  function revokeCode(fleetID, codeID) {
    if (!codeID) return;
    if (!window.confirm('code ' + codeID + '를 무효화합니다. 계속할까요?')) return;
    request('DELETE', '/fleets/' + encodeURIComponent(fleetID) + '/codes/' + encodeURIComponent(codeID))
      .then(function () { toast('code를 무효화했습니다'); select(fleetID); })
      .catch(fail);
  }

  // Naming the gap is part of the view: the module exposes six operations, so
  // creating a fleet, adding or starting or stopping a seat, and building or
  // promoting a release stay on the CLI until those core operations open too.
  function renderGapNote(main) {
    var note = el('div', 'note');
    note.appendChild(el('strong', null, '이 콘솔이 못 하는 것'));
    note.appendChild(document.createTextNode(
      ' \u2014 Fleet 삭제, orphan cleanup, 릴리스 build·promote는 이 모듈이 아직 노출하지 않습니다. '));
    note.appendChild(el('code', null, 'terra master fleet \u2026'));
    note.appendChild(document.createTextNode(' 로 수행하십시오.'));
    main.appendChild(note);
  }

  // ---- boot ----------------------------------------------------------------

  function boot() {
    readLaunchFragment();
    setSessionPill();
    document.getElementById('create-fleet').addEventListener('click', createFleet);
    document.getElementById('refresh').addEventListener('click', function () {
      loadFleets().then(function () { if (state.selected) select(state.selected); });
    });
    loadFleets();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
