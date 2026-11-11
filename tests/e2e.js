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
// a short silent WAV, standing in for the 오늘우리집 server's read-aloud mp3
const WAV = (() => { const n = 1600, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
const ttsHits = [];
let ttsStreamFails = false; // when true, media-element (Range) requests fail like a picky WebView
const server = http.createServer((req, res) => {
  // pretend to be the 오늘우리집 server under /learn/ (page + read-aloud voice API)
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/learn/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res); return; }
  if (u.pathname === '/learn/api/tts/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"enabled":true}'); return; }
  if (u.pathname === '/learn/api/tts') { if (ttsStreamFails && req.headers.range) { res.writeHead(500); res.end(); return; } ttsHits.push(u.searchParams.get('t')); res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(WAV); return; }
  if (u.pathname.startsWith('/learn/api/')) { res.writeHead(401); res.end('{}'); return; }
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
    for (const L of LESSONS) for (let k = 0; k < 300; k++) for (const q of [...L.quiz(), ...(L.challenge && k < 100 ? L.challenge() : [])]) {
      const tag = `${L.id} ${q.type}`;
      if (!q.hint || !q.ex) out.push('missing hint/explanation: ' + tag);
      if (q.type === 'choice') {
        if (q.a < 0) out.push('no correct option: ' + tag);
        if (new Set(q.opts).size !== q.opts.length) out.push('duplicate options: ' + tag);
      } else if (q.type === 'text') {
        if (!Array.isArray(q.a) || !q.a.length || q.a.some(x => typeof x !== 'string' || !x.trim())) out.push('bad text answer: ' + tag);
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

  const answer = async (scope, i, wrong) => {
    const pr = await page.evaluate(i => ({ type: window.__probs[i].type, a: window.__probs[i].a, n: (window.__probs[i].labels || []).length, k: (window.__probs[i].opts || []).length }), i);
    if (pr.type === 'choice') await page.click(`${scope} .opt[data-i="${wrong ? (pr.a + 1) % pr.k : pr.a}"]`);
    else {
      const fields = pr.type === 'multi' ? Array.from({ length: pr.n }, (_, k) => 'am' + k) : { num: ['ans'], dec: ['ans'], text: ['ans'], frac: ['an', 'ad'], mixed: ['aw', 'an', 'ad'], qr: ['aq', 'ar'] }[pr.type];
      const vals = Array.isArray(pr.a) ? pr.a : [pr.a];
      for (let j = 0; j < fields.length; j++) await page.fill(`${scope} #${fields[j]}`, wrong ? (pr.type === 'text' ? 'zzz' : '9999') : String(vals[j]));
      await page.click(`${scope} #qform button[type=submit]`);
    }
    return (await page.$eval(`${scope} #fb`, e => e.className));
  };
  await page.evaluate(() => { const orig = runQuiz; runQuiz = (root, probs, done, ctx) => { window.__probs = probs; return orig(root, probs, done, ctx); }; });
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
        const fields = pr.type === 'multi' ? Array.from({ length: pr.n }, (_, k) => 'am' + k) : { num: ['ans'], dec: ['ans'], text: ['ans'], frac: ['an', 'ad'], mixed: ['aw', 'an', 'ad'], qr: ['aq', 'ar'] }[pr.type];
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

  // 4a. parent features: the two wrong answers above go to the notebook; review, report, profiles
  await page.evaluate(() => { location.hash = 'review'; });
  await page.waitForSelector('.ghead');
  const noteCount = await page.evaluate(() => P.wrong.length);
  check(noteCount >= 1, `wrong answers are saved to the notebook (${noteCount})`);
  await page.click('#redo');
  await page.waitForSelector('#qform');
  const rp = await page.evaluate(() => ({ type: window.__probs[0].type, a: window.__probs[0].a, n: (window.__probs[0].labels || []).length }));
  if (rp.type === 'choice') await page.click(`.opt[data-i="${rp.a}"]`);
  else { const f = rp.type === 'multi' ? Array.from({ length: rp.n }, (_, k) => 'am' + k) : { num: ['ans'], dec: ['ans'], text: ['ans'], frac: ['an', 'ad'], mixed: ['aw', 'an', 'ad'], qr: ['aq', 'ar'] }[rp.type]; const v = Array.isArray(rp.a) ? rp.a : [rp.a]; for (let j = 0; j < f.length; j++) await page.fill('#' + f[j], String(v[j])); await page.click('#qform button[type=submit]'); }
  const after = await page.evaluate(() => P.wrong.length);
  check(after === noteCount - 1, 'a notebook problem answered right on the first try leaves the notebook');
  await page.evaluate(() => { location.hash = 'report'; });
  await page.waitForSelector('.kpis');
  check(await page.$$eval('.bar-c', e => e.length) === 7, 'parent report shows the last 7 days');
  await page.evaluate(() => { location.hash = 'ws-review-1'; });
  await page.waitForSelector('.sheet, .intro');
  await page.evaluate(() => { location.hash = 'home'; });
  await page.waitForSelector('#profForm');
  const before = await page.evaluate(() => totalStars());
  await page.fill('#profName', '둘째'); await page.click('#profForm button');
  await page.waitForSelector('[data-prof]');
  const fresh = await page.evaluate(() => ({ stars: totalStars(), name: profName(), n: PROFILES.length }));
  check(fresh.stars === 0 && fresh.name === '둘째' && fresh.n === 2, 'a new profile starts with its own empty record');
  await page.click('[data-prof="p1"]');
  check(await page.evaluate(() => totalStars()) === before, 'switching back restores the first profile');


  // 4c. landing page, subject pages, achievements
  await page.evaluate(() => { location.hash = 'home'; });
  await page.waitForSelector('.subj-card');
  check(await page.$$eval('.subj-card', e => e.length) === 4, 'landing page offers 4 subject cards');
  check(/지혜섬/.test(await page.$eval('#topbar', e => e.textContent)), 'header uses the subject-neutral name');
  await page.click('.subj-card[href="#kor"]');
  await page.waitForSelector('.subj-head');
  check(await page.$$eval('.gcard', e => e.length) === 3 && await page.$$eval('.speed-card', e => e.length) === 3, 'subject page lists grades and speed challenges');
  const xp0 = await page.evaluate(() => P.xp);
  check(xp0 > 0, `finishing lessons earns XP (${xp0})`);
  check(await page.evaluate(() => Object.keys(P.badges).length) >= 3, 'badges are awarded');
  // challenge mode: locked under 2 stars, hearts drop on a wrong answer, a clean run earns the medal
  await page.evaluate(() => { delete P.stars['vocab-2']; delete P.medals['vocab-2']; save(); location.hash = 'home'; });
  await page.evaluate(() => { location.hash = 'vocab-2'; });
  await page.waitForSelector('#chSec');
  check(!!(await page.$('#chSec .lockbox')), 'challenge is locked before earning 2 stars');
  await page.evaluate(() => { P.stars['vocab-2'] = 2; save(); route(); });
  await page.waitForSelector('#chStart');
  await page.click('#chStart'); await page.waitForSelector('#chQuiz #qform');
  const fb1 = await answer('#chQuiz', 0, true);
  check(fb1.includes('bad') && (await page.$eval('#chQuiz .hearts', e => e.getAttribute('aria-label'))).includes('2'), 'a wrong challenge answer costs a heart, with no hint');
  await page.click('#chQuiz #qnext button');
  for (let i = 1; i < 5; i++) { await answer('#chQuiz', i); await page.click('#chQuiz #qnext button'); }
  check(!!(await page.$('#chQuiz .result .bigmedal')) && await page.evaluate(() => !!P.medals['vocab-2']), 'surviving the challenge earns a medal');
  // daily challenge
  await page.evaluate(() => { location.hash = 'daily'; });
  await page.waitForSelector('#quiz #qform');
  const xp1 = await page.evaluate(() => P.xp);
  for (let i = 0; i < 5; i++) { await answer('#quiz', i); await page.click('#quiz #qnext button'); }
  check(await page.evaluate(x => !!P.daily[today()] && P.xp >= x + 40, xp1), 'daily challenge completes and gives bonus XP');
  // speed challenge starts and its timer stops when leaving
  await page.evaluate(() => { location.hash = 'speed-eng-g3'; });
  await page.click('#spStart'); await page.waitForSelector('#spT');
  await page.evaluate(() => { location.hash = 'trophy'; });
  await page.waitForSelector('.badges');
  check(await page.evaluate(() => SPEED_TIMER === null), 'leaving the speed challenge stops its timer');
  check(await page.$$eval('.badge.got', e => e.length) >= 3, 'trophy room shows earned badges');

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
  for (const id of ['home', 'kor', 'sci', 'trophy', 'daily', 'speed-math-g6', 'g1', 'g6', 'kor-g1', 'eng-g4', 'sci-g5', 'hangul-1', 'talk-3', 'change-2', 'ws-words-3', 'ws-light-5', 'ans-port-7', 'hill-3', 'port-1', 'jungle-2', 'canyon-3', 'observ-3', 'mul-3', 'frac-2']) {
    await page.evaluate(h => { location.hash = h; }, id);
    await page.waitForTimeout(150);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(ov <= 0, `no horizontal scroll at 400px on #${id}`);
  }

  // 6. read-aloud fallbacks: app bridge, and no speech at all
  for (const [kind, init] of [
    ['bridge', "window.__msgs=[];window.ReactNativeWebView={postMessage:m=>window.__msgs.push(JSON.parse(m))};Object.defineProperty(window,'speechSynthesis',{value:undefined});"],
    ['none', "Object.defineProperty(window,'speechSynthesis',{value:undefined});window.SpeechSynthesisUtterance=undefined;"],
  ]) {
    const tp = await browser.newPage({ viewport: { width: 400, height: 860 } });
    await tp.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await tp.addInitScript(init);
    await tp.goto(url + '#hangul-3'); await tp.waitForSelector('#qform');
    if (kind === 'bridge') {
      await tp.click('.btn.listen');
      const m = await tp.evaluate(() => window.__msgs[0] || {});
      check(m.type === 'speak' && m.lang === 'ko-KR' && !!m.text, 'speech goes to the app TTS bridge when one exists');
    } else {
      await tp.click('.btn.reveal');
      check(/부모님이 읽어 주세요: \S/.test(await tp.$eval('.reveal-box', e => e.textContent)), 'without speech, listening questions can be read by a grown-up');
    }
    await tp.close();
  }
  {
    // an engine that drops speak() calls made while it is busy (Chrome on Android): the whole comic must still be read
    const tp = await browser.newPage({ viewport: { width: 400, height: 860 } });
    await tp.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await tp.addInitScript("(()=>{window.__said=[];let cur=null;const S={get speaking(){return !!cur},pending:false,paused:false,getVoices:()=>[{lang:'ko-KR',name:'ko',localService:true}],addEventListener(){},cancel(){if(cur){const c=cur;cur=null;c.onerror&&c.onerror({error:'interrupted'});}},resume(){},pause(){},speak(u){if(cur)return;cur=u;window.__said.push(u.text);setTimeout(()=>{u.onstart&&u.onstart();setTimeout(()=>{if(cur===u){cur=null;u.onend&&u.onend();}},100);},20);}};Object.defineProperty(window,'speechSynthesis',{value:S});window.SpeechSynthesisUtterance=function(t){this.text=t;};})()");
    await tp.goto(url + '#frac-1'); await tp.waitForSelector('#qform');
    const lastPanel = await tp.$$eval('section:has([data-say="comic"]) .pn', els => (els[els.length - 1].querySelector('.bub,p,figcaption') || {}).textContent.trim().slice(-8));
    await tp.click('[data-say="comic"]'); await tp.waitForTimeout(2500);
    const said = await tp.evaluate(() => window.__said.join(' '));
    check(said.includes(lastPanel), 'comic read-aloud plays to the last panel one piece at a time');
    await tp.close();
  }
  {
    // Android app screen (WebView) has no Web Speech: on the 오늘우리집 server the page plays the server's voice files
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-F956N; wv) AppleWebKit/537.36 Version/4.0 Chrome/130 Mobile Safari/537.36', viewport: { width: 400, height: 860 } });
    const tp = await ctx.newPage();
    await tp.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await tp.addInitScript("Object.defineProperty(window,'speechSynthesis',{value:undefined});window.SpeechSynthesisUtterance=undefined;");
    await tp.goto(url.replace('/index.html', '/learn/') + '#frac-1'); await tp.waitForSelector('#qform'); await tp.waitForTimeout(300);
    ttsHits.length = 0;
    await tp.click('[data-say="comic"]'); await tp.waitForTimeout(2500);
    const lastPanel = await tp.$$eval('section:has([data-say="comic"]) .pn', els => (els[els.length - 1].querySelector('.bub,p,figcaption') || {}).textContent.trim().slice(-8));
    check(ttsHits.some(t => t.includes(lastPanel)) && await tp.evaluate(() => AUD.started && !AUD.failed), 'app screen: comic read-aloud plays the server voice to the last panel');
    await tp.evaluate(() => { location.hash = 'hangul-3'; }); await tp.waitForSelector('.btn.listen');
    ttsHits.length = 0; await tp.click('.btn.listen'); await tp.waitForTimeout(600);
    check(ttsHits.length >= 1, 'app screen: listening questions play the server voice');
    await ctx.close();
  }
  {
    // iPhone app screen: Web Speech exists but the silent switch mutes it, so the server voice is used first
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', viewport: { width: 400, height: 860 } });
    const tp = await ctx.newPage();
    await tp.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await tp.addInitScript("window.__said=[];Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,pending:false,getVoices:()=>[],addEventListener(){},cancel(){},resume(){},speak(u){window.__said.push(u.text);}}});window.SpeechSynthesisUtterance=function(t){this.text=t;};");
    await tp.goto(url.replace('/index.html', '/learn/') + '#words-1'); await tp.waitForSelector('#qform'); await tp.waitForTimeout(300);
    ttsHits.length = 0;
    await tp.click('[data-say="comic"]'); await tp.waitForTimeout(1500);
    const r = await tp.evaluate(() => ({ started: AUD.started, said: window.__said.filter(x => x.trim()).length }));
    check(ttsHits.length >= 1 && r.started && r.said === 0, 'iPhone app screen: comic read-aloud uses the server voice, not silent-mode Web Speech');
    // when streaming the voice fails, the page downloads the mp3 and plays it from memory
    ttsStreamFails = true; ttsHits.length = 0;
    await tp.evaluate(() => { stopSpeak(); AUD.started = false; AUD.failed = false; window.__said = []; });
    await tp.click('[data-say="comic"]'); await tp.waitForTimeout(2000);
    const r2 = await tp.evaluate(() => ({ started: AUD.started, failed: AUD.failed, blob: (AUD.el.src || '').startsWith('blob:'), said: window.__said.filter(x => x.trim()).length }));
    ttsStreamFails = false;
    check(r2.started && !r2.failed && r2.blob && r2.said === 0, 'iPhone app screen: if streaming fails, the downloaded voice file plays instead');
    await ctx.close();
  }
  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
