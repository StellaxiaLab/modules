// Node Talk console — M1. The layout is the requested two panes; the left
// node list doubles as the instrument's aim: selecting a node means every call
// goes to THAT node's store — the local one over L0, a remote one over the
// Gateway's remote namespace (L1) — and every roundtrip is measured and shown.
// The remote hop cannot carry the SSE stream (idea doc §11), so remote viewing
// is fetch-based and says so on screen instead of pretending.
(function () {
  'use strict';

  var LOCAL_API = '/api/modules/io.terra.nodetalk/v1';

  var state = {
    token: '',            // app scope token from the launch fragment
    selfNode: '',         // this node's id, from status.get
    viewNode: '',         // '' = local node; otherwise the remote node id
    peers: [],            // node ids to show: cluster nodes + conversation members
    nodeInfo: {},         // node id -> {displayName, status, hasModule}
    clusterError: '',     // why the cluster list is missing, when it is
    selectedMembers: {},  // node id -> true, for the create form
    reach: {},            // node id -> {rung, rttMs} | {error}
    conversations: [],
    selected: '',         // conversation_id
    measured: {},         // "author:seq" -> {rung, rttMs} client-side send measurements
    closeStream: null,
    lastEnvelope: 'no request yet'
  };

  // ---- launch handover (WebApp Host W-M6, same idiom as io.terra.fleet) ----

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

  // base(node) picks the wire: '' → this node's module (L0); a node id → the
  // §14.2 remote namespace through Gateway → Master → that node (L1).
  function base(node) {
    return node ? '/api/nodes/' + encodeURIComponent(node) + '/modules/io.terra.nodetalk/v1' : LOCAL_API;
  }

  function rungOf(node) { return node ? 'L1' : 'L0'; }

  // invokeOperation calls a published operation by id through the Gateway. It
  // is how this app reaches surfaces that are not its own module's — the node
  // list belongs to the Master, and the app's scope token already carries the
  // node.read the operation requires.
  function invokeOperation(operationId, input) {
    var init = {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(input || {})
    };
    init.headers['Content-Type'] = 'application/json';
    var url = '/api/v1/operations/' + encodeURIComponent(operationId) + '/invoke';
    var started = performance.now();
    return fetch(url, init).then(function (response) {
      var rttMs = Math.round(performance.now() - started);
      return response.json().catch(function () { return {}; }).then(function (payload) {
        state.lastEnvelope = JSON.stringify({
          request: 'POST ' + url, status: response.status, rtt_ms: rttMs, payload: payload
        }, null, 2);
        renderDiag();
        if (response.ok) return payload;
        var detail = (payload && payload.error) || {};
        var error = new Error(detail.message || String(response.status));
        error.code = detail.code || '';
        error.status = response.status;
        throw error;
      });
    });
  }

  // unwrapMaster digs the payload out of the Master's {ok, data, meta} envelope
  // and tolerates the shapes a list can arrive in.
  function unwrapMaster(payload, key) {
    var data = (payload && payload.data !== undefined) ? payload.data : payload;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data[key])) return data[key];
    if (payload && Array.isArray(payload[key])) return payload[key];
    return [];
  }

  // request resolves {payload, rttMs} and rejects with {code, message, status,
  // rttMs} — the caller always learns how long the wire took, because in this
  // module the wire is the product.
  function request(node, method, path, body) {
    var init = { method: method, headers: authHeaders() };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    var url = base(node) + path;
    var started = performance.now();
    return fetch(url, init).then(function (response) {
      var rttMs = Math.round(performance.now() - started);
      var isJSON = (response.headers.get('Content-Type') || '').indexOf('json') >= 0;
      return (isJSON ? response.json() : response.text()).then(function (payload) {
        state.lastEnvelope = JSON.stringify({
          request: method + ' ' + url,
          status: response.status,
          rtt_ms: rttMs,
          payload: payload
        }, null, 2);
        renderDiag();
        if (response.ok) return { payload: payload, rttMs: rttMs };
        var detail = (payload && payload.error) || payload || {};
        var error = new Error(detail.message || String(response.status));
        error.code = detail.code || '';
        error.status = response.status;
        error.rttMs = rttMs;
        throw error;
      });
    });
  }

  // ---- fetch-based SSE (EventSource cannot carry the Authorization header) --

  function openStream(conversationId, onEvent) {
    var controller = new AbortController();
    var headers = authHeaders();
    headers.Accept = 'text/event-stream';
    fetch(LOCAL_API + '/conversations/' + encodeURIComponent(conversationId) + '/stream',
      { headers: headers, signal: controller.signal })
      .then(function (response) {
        if (!response.ok || !response.body) throw new Error('stream ' + response.status);
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';
        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) return;
            buffer += decoder.decode(chunk.value, { stream: true });
            var boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              var frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              var data = frame.split('\n').filter(function (line) {
                return line.indexOf('data:') === 0;
              }).map(function (line) { return line.slice(5).trim(); }).join('\n');
              if (data) {
                try { onEvent(JSON.parse(data)); } catch (ignored) { /* malformed frame */ }
              }
            }
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        // Dropped stream: retry unless deliberately closed. The transcript on
        // disk is the truth; the stream is only the nudge.
        if (!controller.signal.aborted) {
          setTimeout(function () {
            if (state.selected === conversationId && !state.viewNode) {
              state.closeStream = openStream(conversationId, onEvent);
            }
          }, 3000);
        }
      });
    return function () { controller.abort(); };
  }

  // ---- rendering -----------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function replaceChildren(node, children) {
    while (node.firstChild) node.removeChild(node.firstChild);
    children.forEach(function (child) { node.appendChild(child); });
  }

  function renderDiag() {
    document.getElementById('diag-body').textContent = state.lastEnvelope;
  }

  function renderModulePill(kind, text) {
    var pill = document.getElementById('module-pill');
    pill.className = 'pill ' + kind;
    pill.textContent = text;
  }

  function renderViewPill() {
    var pill = document.getElementById('view-pill');
    if (state.viewNode) {
      pill.hidden = false;
      pill.className = 'pill warn';
      pill.textContent = '원격 보기: ' + state.viewNode + ' · L1 · 스트림 불가 — 수동 새로고침';
    } else {
      pill.hidden = true;
    }
  }

  function reachBadge(node) {
    var reach = state.reach[node];
    if (!reach) return el('span', 'badge', '미계측');
    if (reach.error) {
      var bad = el('span', 'badge bad', '도달 불가');
      bad.title = reach.error;
      return bad;
    }
    return el('span', 'badge ok', reach.rung + ' · ' + reach.rttMs + 'ms');
  }

  // labelFor prefers the operator-facing display name and keeps the id
  // visible — a node id is unmemorable, and the id is what every call and
  // every log line actually uses.
  function labelFor(nodeId) {
    var info = state.nodeInfo[nodeId];
    return (info && info.displayName) ? info.displayName : nodeId;
  }

  function renderNodes() {
    var rows = [];
    var nodes = [{ id: '', peer: state.selfNode, self: true }];
    state.peers.forEach(function (peer) { nodes.push({ id: peer, peer: peer }); });

    nodes.forEach(function (node) {
      var row = el('div', 'row selectable' + ((state.viewNode === node.id) ? ' selected' : ''));

      // Selecting members for a new conversation happens right here, on the
      // node that is already on screen — nobody should type a node id.
      if (!node.self) {
        var pick = el('input', 'pick');
        pick.type = 'checkbox';
        pick.checked = !!state.selectedMembers[node.peer];
        pick.title = '새 대화의 멤버로 선택';
        pick.addEventListener('click', function (click) { click.stopPropagation(); });
        pick.addEventListener('change', function () {
          if (pick.checked) state.selectedMembers[node.peer] = true;
          else delete state.selectedMembers[node.peer];
          renderCreateHint();
        });
        row.appendChild(pick);
      }

      var name = el('span', 'name', labelFor(node.peer) || '(이 노드)');
      name.title = node.peer || '';
      row.appendChild(name);
      if (node.self) row.appendChild(el('span', 'self', '(나)'));

      var info = state.nodeInfo[node.peer] || {};
      if (info.hasModule === false) {
        var absent = el('span', 'badge warn', '모듈 없음');
        absent.title = 'nodetalk이 이 노드에 설치되어 있지 않다 — 그래서 통신이 안 된다';
        row.appendChild(absent);
      } else {
        row.appendChild(reachBadge(node.peer || ''));
      }

      row.addEventListener('click', function () { selectNode(node.id); });
      rows.push(row);
    });

    if (state.peers.length === 0) {
      rows.push(el('p', 'empty', state.clusterError
        ? '클러스터 노드 목록 실패: ' + state.clusterError + ' — 아래에 id를 직접 넣을 수 있다.'
        : '다른 노드가 없다.'));
    }
    replaceChildren(document.getElementById('node-list'), rows);
  }

  // renderCreateHint keeps the create button honest about what it will do.
  function renderCreateHint() {
    var picked = Object.keys(state.selectedMembers);
    var hint = document.getElementById('create-hint');
    if (!hint) return;
    hint.textContent = picked.length === 0
      ? '멤버를 고르지 않으면 나 혼자인 대화가 된다 (나중에 초대 가능).'
      : '멤버 ' + picked.length + '명 — 고른 순서가 우선순위가 된다: ' +
        picked.map(labelFor).join(', ');
  }

  function renderConversations() {
    var rows = [];
    state.conversations.forEach(function (summary) {
      var conversation = summary.conversation;
      var row = el('div', 'row selectable' + ((state.selected === conversation.conversation_id) ? ' selected' : ''));
      row.appendChild(el('span', 'name', conversation.display_name));
      row.appendChild(el('span', 'badge ' + (conversation.role === 'main' ? 'ok' : ''),
        conversation.role === 'main' ? 'MAIN' : '백업'));
      row.appendChild(el('span', 'badge', 'e' + conversation.epoch));
      if (summary.behind > 0) row.appendChild(el('span', 'badge warn', '↑' + summary.behind));
      row.addEventListener('click', function () { selectConversation(conversation.conversation_id); });
      rows.push(row);
    });
    if (rows.length === 0) rows.push(el('p', 'empty', '대화 없음 — 아래에서 만들 수 있다.'));
    replaceChildren(document.getElementById('conversation-list'), rows);
  }

  function bubbleFor(entry) {
    var mine = entry.author_node_id === state.selfNode && !state.viewNode;
    var bubble = el('div', 'bubble' + (mine ? ' mine' : ''));
    bubble.dataset.key = entry.author_node_id + ':' + entry.seq;
    var meta = el('div', 'meta');
    meta.appendChild(el('span', 'author', entry.author_node_id));
    if (entry.wall_ms) {
      meta.appendChild(el('span', 'time', new Date(entry.wall_ms).toLocaleTimeString()));
    }
    // Instrumentation: the server-side transport (how the entry reached the
    // serving node — M2's replica arrivals) wins; else the client-side
    // measurement of our own send, if we made one.
    var transport = entry.transport;
    if (!transport) {
      var measured = state.measured[entry.author_node_id + ':' + entry.seq];
      if (measured) transport = { rung: measured.rung, rtt_ms: measured.rttMs };
    }
    if (transport) {
      var label = transport.rung;
      if (transport.fell_back_from) label = transport.fell_back_from + '→' + label + ' 폴백';
      if (transport.rtt_ms !== undefined) label += ' · ' + transport.rtt_ms + 'ms';
      if (transport.attempts > 1) label += ' · 재시도 ' + (transport.attempts - 1);
      meta.appendChild(el('span', 'badge ok', label));
    }
    bubble.appendChild(meta);
    var text = entry.text;
    if (entry.kind === 'member-added') text = '⊕ 멤버 초대: ' + (entry.member_node_id || '?');
    else if (entry.kind === 'member-removed') text = '⊖ 멤버 제거: ' + (entry.member_node_id || '?');
    else if (entry.kind !== 'message') text = '[' + entry.kind + ']';
    bubble.appendChild(el('div', 'text', text));
    return bubble;
  }

  function renderTranscript(entries) {
    var container = document.getElementById('transcript');
    var rows = entries.map(bubbleFor);
    if (rows.length === 0) rows.push(el('p', 'empty', '아직 메시지가 없다.'));
    replaceChildren(container, rows);
    container.scrollTop = container.scrollHeight;
  }

  function appendBubble(entry) {
    var container = document.getElementById('transcript');
    var emptyNote = container.querySelector('.empty');
    if (emptyNote) emptyNote.remove();
    container.appendChild(bubbleFor(entry));
    container.scrollTop = container.scrollHeight;
  }

  function renderStatusline(extra) {
    var selected = null;
    state.conversations.forEach(function (summary) {
      if (summary.conversation.conversation_id === state.selected) selected = summary.conversation;
    });
    var parts = ['경로 ' + rungOf(state.viewNode)];
    if (selected) {
      parts.push('main=' + selected.main_node_id);
      parts.push('epoch ' + selected.epoch);
    }
    if (extra) parts.push(extra);
    document.getElementById('statusline').textContent = parts.join(' · ');
  }

  // ---- actions -------------------------------------------------------------

  function loadStatus() {
    return request('', 'GET', '/status').then(function (result) {
      state.selfNode = result.payload.node_id;
      state.reach[state.selfNode] = { rung: 'L0', rttMs: result.rttMs };
      renderModulePill('ok', 'v' + result.payload.version + ' · ' + result.payload.status +
        ' · ' + result.payload.node_id);
      renderNodes();
    }).catch(function (error) {
      renderModulePill('bad', '모듈 도달 실패 (' + (error.code || error.status || '네트워크') + ')');
    });
  }

  // loadClusterNodes asks the Master for every node in the cluster. This is the
  // difference between "a chat you can only use if you already know a node id"
  // and a bench you can actually aim: node ids look like
  // node_1787668612823_7f1fac2b71003dfc, which nobody types.
  function loadClusterNodes() {
    return invokeOperation('terra.master.nodes.get', {}).then(function (payload) {
      state.clusterError = '';
      var listed = unwrapMaster(payload, 'nodes');
      listed.forEach(function (node) {
        var id = node.node_id || node.id;
        if (!id) return;
        state.nodeInfo[id] = state.nodeInfo[id] || {};
        state.nodeInfo[id].displayName = node.display_name || node.name || '';
        state.nodeInfo[id].status = node.status || '';
        if (id !== state.selfNode && state.peers.indexOf(id) < 0) state.peers.push(id);
      });
      state.peers.sort(function (a, b) { return labelFor(a).localeCompare(labelFor(b)); });
      renderNodes();
      renderCreateHint();
      // Reachability and module presence are per-node questions; ask them
      // after the list is on screen so the pane fills immediately.
      state.peers.forEach(function (peer) {
        checkModulePresence(peer);
        measurePeer(peer);
      });
    }).catch(function (error) {
      // The instrument says why rather than showing an empty pane: no cluster
      // (a bench with no Master) and no permission are different facts.
      state.clusterError = error.code || String(error.status || error.message);
      renderNodes();
    });
  }

  // checkModulePresence marks a node that does not carry nodetalk. For a comms
  // bench that is a first-class answer — "you cannot talk to node-c because
  // the module is not there" is exactly what this screen should tell you.
  function checkModulePresence(node) {
    return invokeOperation('terra.master.nodes.by-node-id.modules.get', { node_id: node })
      .then(function (payload) {
        var modules = unwrapMaster(payload, 'modules');
        var present = modules.some(function (module) {
          return (module.id || module.module_id) === 'io.terra.nodetalk';
        });
        state.nodeInfo[node] = state.nodeInfo[node] || {};
        state.nodeInfo[node].hasModule = present;
        renderNodes();
      })
      .catch(function () { /* unknown presence: leave the reachability badge */ });
  }

  function measurePeer(node) {
    return request(node, 'GET', '/status').then(function (result) {
      state.reach[node] = { rung: 'L1', rttMs: result.rttMs };
    }).catch(function (error) {
      state.reach[node] = { error: error.code || String(error.status || error.message) };
    }).then(renderNodes);
  }

  function loadConversations() {
    return request(state.viewNode, 'GET', '/conversations').then(function (result) {
      state.conversations = result.payload.conversations || [];
      // Every member of every conversation is a node worth measuring.
      // A member this node has never seen in the cluster list still belongs on
      // screen — it may be a node that left, or one the caller cannot list.
      state.conversations.forEach(function (summary) {
        (summary.conversation.members || []).forEach(function (member) {
          if (member.node_id !== state.selfNode && state.peers.indexOf(member.node_id) < 0) {
            state.peers.push(member.node_id);
            measurePeer(member.node_id);
          }
        });
      });
      renderConversations();
      renderNodes();
    }).catch(function (error) {
      state.conversations = [];
      replaceChildren(document.getElementById('conversation-list'),
        [el('p', 'empty', '대화 목록 실패: ' + (error.code || error.status || error.message))]);
    });
  }

  function loadTranscript() {
    if (!state.selected) return Promise.resolve();
    return request(state.viewNode, 'GET', '/conversations/' + encodeURIComponent(state.selected) + '/messages')
      .then(function (result) {
        renderTranscript(result.payload.entries || []);
        renderStatusline();
      })
      .catch(function (error) {
        replaceChildren(document.getElementById('transcript'),
          [el('p', 'empty', '전사 조회 실패: ' + (error.code || error.status || error.message))]);
      });
  }

  function stopStream() {
    if (state.closeStream) {
      state.closeStream();
      state.closeStream = null;
    }
  }

  function selectNode(node) {
    state.viewNode = node;
    state.selected = '';
    stopStream();
    document.getElementById('composer').hidden = true;
    replaceChildren(document.getElementById('transcript'), [el('p', 'empty', '대화를 선택하십시오.')]);
    renderViewPill();
    renderNodes();
    renderStatusline();
    loadConversations();
    if (node) measurePeer(node);
  }

  function selectConversation(id) {
    state.selected = id;
    stopStream();
    document.getElementById('composer').hidden = false;
    renderConversations();
    loadTranscript().then(function () {
      // Live push only on the local node — the remote hop cannot stream (§11).
      if (!state.viewNode) {
        state.closeStream = openStream(id, function (event) {
          if (state.selected !== id) return;
          if ((event.event === 'entry' || event.event === 'membership') && event.entry) {
            appendBubble(event.entry);
          }
          if (event.event === 'deleted') {
            // The conversation is gone — tombstone kept. Say so and leave.
            state.selected = '';
            stopStream();
            document.getElementById('composer').hidden = true;
            replaceChildren(document.getElementById('transcript'),
              [el('p', 'empty', '이 대화는 삭제되었다 (묘비 보존 창 안).')]);
            loadConversations();
            return;
          }
          if (event.event === 'main-changed' || event.event === 'membership') {
            // Authority moved or membership changed: the left pane's MAIN
            // badge, epoch chip and rank order are stale — refetch.
            loadConversations();
            renderStatusline(event.event === 'main-changed'
              ? '메인 변경 → ' + event.main_node_id + ' · e' + event.epoch : undefined);
          }
        });
      }
    });
  }

  // ---- forms ---------------------------------------------------------------

  document.getElementById('add-node').addEventListener('submit', function (submit) {
    submit.preventDefault();
    var input = document.getElementById('add-node-id');
    var node = input.value.trim();
    if (!node || node === state.selfNode || state.peers.indexOf(node) >= 0) return;
    state.peers.push(node);
    input.value = '';
    renderNodes();
    measurePeer(node);
  });

  document.getElementById('create-conversation').addEventListener('submit', function (submit) {
    submit.preventDefault();
    var name = document.getElementById('create-name').value.trim();
    if (!name) {
      renderStatusline('대화 이름이 필요하다');
      return;
    }
    // Members come from the checkboxes in the node list — the order they were
    // picked in becomes rank (D-2), and no id is ever typed.
    var members = Object.keys(state.selectedMembers);
    request(state.viewNode, 'POST', '/conversations', { display_name: name, members: members })
      .then(function () {
        document.getElementById('create-name').value = '';
        state.selectedMembers = {};
        renderNodes();
        renderCreateHint();
        return loadConversations();
      })
      .catch(function (error) {
        renderStatusline('생성 실패: ' + (error.code || error.message));
      });
  });

  document.getElementById('composer').addEventListener('submit', function (submit) {
    submit.preventDefault();
    var input = document.getElementById('composer-text');
    var text = input.value.trim();
    if (!text || !state.selected) return;
    var target = state.viewNode;
    request(target, 'POST', '/conversations/' + encodeURIComponent(state.selected) + '/messages', { text: text })
      .then(function (result) {
        input.value = '';
        var entry = result.payload.entry;
        // Remember what WE measured for this send; the badge on the bubble is
        // this number until a server-side transport (M2) replaces it.
        var key = entry.author_node_id + ':' + entry.seq;
        state.measured[key] = { rung: rungOf(target), rttMs: result.rttMs };
        if (target) {
          loadTranscript(); // no stream over the remote hop — refetch
        } else {
          // Local sends render through the SSE stream, which usually wins the
          // race against this response — re-dress the already-rendered bubble
          // with the measurement it could not have known yet.
          var rendered = document.querySelector('.bubble[data-key="' + key + '"]');
          if (rendered) rendered.replaceWith(bubbleFor(entry));
        }
        renderStatusline('보냄 ' + rungOf(target) + ' · ' + result.rttMs + 'ms');
      })
      .catch(function (error) {
        renderStatusline('전송 실패: ' + (error.code || error.status || error.message));
      });
  });

  document.getElementById('delete-conversation').addEventListener('click', function () {
    if (!state.selected) return;
    if (!window.confirm('이 대화를 삭제할까? 멤버 전체에 삭제 의도가 전파되고 메시지는 함께 사라진다.')) return;
    request(state.viewNode, 'DELETE', '/conversations/' + encodeURIComponent(state.selected))
      .then(function (result) {
        var receipt = result.payload;
        // §6의 요점: 삭제 전파를 숨기지 않고 화면에 띄운다.
        var pending = receipt.pending_nodes || [];
        renderStatusline('삭제 확인 ' + (receipt.acknowledged_by || []).length + '/' +
          ((receipt.acknowledged_by || []).length + pending.length) +
          (pending.length ? ' · 미도달: ' + pending.join(', ') + ' (돌아오면 스스로 알게 된다)' : ''));
        state.selected = '';
        stopStream();
        document.getElementById('composer').hidden = true;
        replaceChildren(document.getElementById('transcript'), [el('p', 'empty', '삭제되었다.')]);
        loadConversations();
      })
      .catch(function (error) {
        renderStatusline('삭제 실패: ' + (error.code || error.status || error.message));
      });
  });

  document.getElementById('refresh').addEventListener('click', function () {
    loadStatus().then(loadClusterNodes);
    loadConversations();
    loadTranscript();
  });

  readLaunchFragment();
  // Order matters: status names this node, which the cluster list needs in
  // order to leave it out of the peer rows.
  loadStatus().then(loadClusterNodes).then(loadConversations);
})();
