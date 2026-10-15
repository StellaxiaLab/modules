// 바깥 origin(셸) 으로 fetch 를 시도한다 — connect-src 'self' 가 막아야 한다. ?target=<origin>
var target = new URLSearchParams(location.search).get('target');
fetch(target + '/shell-config.json')
  .then(function () { window.__fetchResult = 'allowed'; })
  .catch(function () { window.__fetchResult = 'blocked'; })
  .then(function () { document.getElementById('result').textContent = window.__fetchResult; document.body.setAttribute('data-done', '1'); });
