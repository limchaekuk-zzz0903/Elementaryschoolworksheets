// End-to-end checks for the app. Starts a static server for ../, then:
//  1. every problem generator yields valid answers (300 runs per lesson)
//  2. every lesson and boss round of every grade can be finished by answering correctly
//  3. wrong answers show a hint, then the solution
//  4. the 셈이 Q&A panel answers in offline mode; every worksheet matches its answer sheet
//  5. no horizontal overflow at phone width, no console errors
// Exit code is non-zero on any failure.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text() + ' ' + (m.location().url || ''))) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(url);

  // 1. generators
  const bad = await page.evaluate(() => {
    const out = [];
    for (const L of LESSONS) for (let k = 0; k < 300; k++) for (const q of L.quiz()) {
      const tag = `${L.id} ${q.type}`;
      if (!q.hint || !q.ex) out.push('missing hint/explanation: ' + tag);
      if (q.type === 'choice') {
        if (q.a < 0) out.push('no correct option: ' + tag);
        if (new Set(q.opts).size !== q.opts.length) out.push('duplicate options: ' + tag);
      } else if (q.type === 'dec') {
        if (typeof q.a !== 'number' || !isFinite(q.a) || q.a <= 0) out.push('bad decimal: ' + tag + ' ' + q.a);
      } else {
        const arr = Array.isArray(q.a) ? q.a : [q.a];
        if (arr.some(x => !Number.isInteger(x) || x < 0)) out.push('bad answer: ' + tag + ' ' + JSON.stringify(q.a));
        if (q.type === 'frac' && (q.a[1] < 2 || q.a[0] < 1)) out.push('bad fraction: ' + tag + ' ' + JSON.stringify(q.a));
      }
    }
    return [...new Set(out)];
  });
  check(bad.length === 0, `problem generators valid${bad.length ? ': ' + bad.slice(0, 5).join('; ') : ''}`);

  // 2. play through every lesson and boss
  await page.evaluate(() => { const orig = runQuiz; runQuiz = (root, probs, done) => { window.__probs = probs; return orig(root, probs, done); }; });
  const ids = await page.evaluate(() => LESSONS.map(l => l.id).concat(Object.keys(R).map(k => k + '-boss')));
  for (const id of ids) {
    await page.evaluate(h => { location.hash = h; }, id);
    await page.waitForSelector('#qform');
    const controls = await page.$$('#w [data-k], #w [data-act]');
    for (const c of controls.slice(0, 6)) await c.click({ timeout: 1000 }).catch(() => {});
    let ok = true;
    for (let i = 0; i < 6 && ok; i++) {
      if (!(await page.$('#qform'))) break;
      const pr = await page.evaluate(i => ({ type: window.__probs[i].type, a: window.__probs[i].a, n: (window.__probs[i].labels || []).length }), i);
      if (pr.type === 'choice') await page.click(`.opt[data-i="${pr.a}"]`);
      else {
        const fields = pr.type === 'multi' ? Array.from({ length: pr.n }, (_, k) => 'am' + k) : { num: ['ans'], dec: ['ans'], frac: ['an', 'ad'], mixed: ['aw', 'an', 'ad'], qr: ['aq', 'ar'] }[pr.type];
        const vals = Array.isArray(pr.a) ? pr.a : [pr.a];
        for (let j = 0; j < fields.length; j++) await page.fill('#' + fields[j], String(vals[j]));
        await page.click('#qform button[type=submit]');
      }
      ok = (await page.$eval('#fb', e => e.className)).includes('ok');
      if (ok) await page.click('#qnext button');
    }
    const done = await page.$('#quiz .result');
    check(ok && !!done, `${id} can be completed`);
  }

  // 3. wrong-answer path
  await page.evaluate(() => { location.hash = 'mul-1'; });
  await page.waitForSelector('#ans');
  await page.fill('#ans', '9999'); await page.click('#qform button[type=submit]');
  const first = await page.$eval('#fb', e => e.className);
  await page.fill('#ans', '9998'); await page.click('#qform button[type=submit]');
  const second = await page.$eval('#fb', e => e.className);
  check(first.includes('hint') && second.includes('bad'), 'wrong answers show hint, then solution');

  // 4. Q&A panel (offline mode)
  await page.click('[data-ask]');
  await page.fill('#askIn', '분모가 뭐야?'); await page.press('#askIn', 'Enter');
  const reply = await page.$$eval('#askLog .msg.semi .mb', els => els[els.length - 1].textContent);
  check(/분모/.test(reply), 'Q&A panel answers offline');
  await page.click('#askClose');

  // 4b. worksheets: problem sheet and answer sheet match for the same set number
  const sheetIds = await page.evaluate(() => LESSONS.map(l => l.id).concat(Object.keys(R)));
  const sheetBad = [];
  for (const id of sheetIds) {
    await page.evaluate(h => { location.hash = h; }, `ws-${id}-31337`);
    await page.waitForSelector('.sheet');
    const ws = await page.$$eval('.sq .sq-b', els => els.map(e => e.innerHTML.split('<div class="sq-a">')[0]));
    await page.evaluate(h => { location.hash = h; }, `ans-${id}-31337`);
    await page.waitForSelector('.sheet-list.keys');
    const an = await page.$$eval('.sq .sq-b', els => els.map(e => e.innerHTML.split('<div class="ans-line">')[0]));
    if (ws.length < 9 || ws.length !== an.length || ws.some((x, i) => x !== an[i])) sheetBad.push(id);
  }
  check(sheetBad.length === 0, `worksheets match their answer sheets (${sheetIds.length} sheets)${sheetBad.length ? ': ' + sheetBad.join(', ') : ''}`);

  // 5. layout
  for (const id of ['home', 'g1', 'g6', 'ws-light-5', 'ans-port-7', 'hill-3', 'port-1', 'jungle-2', 'canyon-3', 'observ-3', 'mul-3', 'frac-2']) {
    await page.evaluate(h => { location.hash = h; }, id);
    await page.waitForTimeout(150);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(ov <= 0, `no horizontal scroll at 400px on #${id}`);
  }
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
