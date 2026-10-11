// 점검용 최소 앱 — 브리지로 status.get·sessions.list 를 불러 결과를 DOM 에 찍는다.
// window.probe.call(method, path, body) 는 시험이 같은 브리지로 아무 호출이나 하게 한다(앱 안에서 evaluate).
(function () {
  var P = '/api/modules/io.terra.agent/v1';
  var pending = {};
  var counter = 0;
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data || {};
    if (d.type === 'terra.webapp.ready') resolveReady(d.permissions || []);
    if (d.type === 'terra.webapp.response' && pending[d.id]) { pending[d.id](d); delete pending[d.id]; }
  });
  window.parent.postMessage({ type: 'terra.webapp.hello' }, '*');

  function call(method, path, body) {
    return ready.then(function () {
      return new Promise(function (resolve) {
        var id = 'probe-' + ++counter;
        pending[id] = resolve;
        window.parent.postMessage({ type: 'terra.webapp.request', id: id, method: method, path: path, body: body }, '*');
      });
    });
  }
  window.probe = { call: call, ready: ready, base: P };

  function show(id, value) { document.getElementById(id).textContent = JSON.stringify(value); }
  ready.then(function (permissions) { show('permissions', permissions); });
  Promise.all([call('GET', P + '/status'), call('GET', P + '/sessions')]).then(function (r) {
    show('status', r[0]);
    show('sessions', r[1]);
    document.body.setAttribute('data-done', '1');
  });
})();
