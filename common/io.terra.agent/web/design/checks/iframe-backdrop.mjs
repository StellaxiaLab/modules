// 대조 실험 — 셸 iframe 안에서도 backdrop-filter가 iframe 뒤 배경을 흐리는가, 틀린 clip-path: shape()는 버려지는가 (DC-13·28 근거).
// 사용: node iframe-backdrop.mjs     (디자인 파일이 필요 없다. 측정만 한다.)
import { launch } from './lib.mjs';
const browser = await launch();
const cmp = await (await browser.newContext()).newPage();
const stripes = 'repeating-linear-gradient(90deg,#000 0 4px,#fff 4px 8px)';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
async function std(html) {
  const ctx = await browser.newContext({ viewport: { width: 520, height: 400 } });
  const page = await ctx.newPage(); await page.setContent(html); await page.waitForTimeout(500);
  const shot = await page.screenshot({ clip: { x: 140, y: 140, width: 220, height: 120 } }); await ctx.close();
  return cmp.evaluate(async (b64) => { const i = new Image(); await new Promise((r) => { i.onload = r; i.src = 'data:image/png;base64,' + b64; }); const cv = document.createElement('canvas'); cv.width = i.width; cv.height = i.height; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); const d = x.getImageData(0, 0, i.width, i.height).data; let s = 0, s2 = 0, n = 0; for (let k = 0; k < d.length; k += 4) { const l = 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]; s += l; s2 += l * l; n++; } const m = s / n; return { mean: +m.toFixed(1), std: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(1) }; }, shot.toString('base64'));
}
const win = (bf) => `.win{position:absolute;inset:0;background:rgba(13,16,22,.66);${bf}}`;
const frame = (bf) => `<body style="margin:0;background:${stripes}"><iframe sandbox="allow-scripts" style="position:absolute;left:100px;top:100px;width:300px;height:200px;border:0" srcdoc="${esc(`<style>html,body{margin:0;height:100%;background:transparent}${win(bf)}</style><div class=win></div>`)}"></iframe></body>`;
console.log('iframe, blur(30px) :', JSON.stringify(await std(frame('backdrop-filter:blur(30px) saturate(1.45)'))));
console.log('iframe, NO blur    :', JSON.stringify(await std(frame(''))));
// 틀린 shape()는 버려진다
const p = await (await browser.newContext()).newPage(); await p.setContent('<div id=a style="width:50px;height:50px;border-radius:12px;clip-path:shape(this is not valid)"></div><div id=b style="width:50px;height:50px;clip-path:shape(from 0 0, line to 10px 0, close)"></div>');
console.log('invalid shape() ->', JSON.stringify(await p.evaluate(() => ({ supports: CSS.supports('clip-path', 'shape(this is not valid)'), computedInvalid: getComputedStyle(document.getElementById('a')).clipPath, computedValid: getComputedStyle(document.getElementById('b')).clipPath.slice(0, 40), radius: getComputedStyle(document.getElementById('a')).borderRadius }))));
await browser.close();
